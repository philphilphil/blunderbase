from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from mcp.server import MCPServer
from mcp.types import TextContent
from sqlalchemy.orm import Session, sessionmaker

from backend.config import Settings, get_settings
from backend.db.enums import Platform, Result, Tier
from backend.db.session import get_sessionmaker
from backend.mcp import arguments as args
from backend.mcp import payloads
from backend.mcp.errors import (
    BAD_ARGUMENT,
    NOT_IMPLEMENTED,
    QUEUE_FULL,
    UNKNOWN_GAME,
    CoachError,
    guarded,
)
from backend.services import accounts as accounts_service
from backend.services import analysis as analysis_service
from backend.services import explorer as explorer_service
from backend.services import games as games_service
from backend.services import live as live_service
from backend.services import notes as notes_service
from backend.services import stats as stats_service
from backend.services.games import GameFilters

SERVER_NAME = "blunderbase"

# Defaults and caps. A coach tool answers into a chat turn, so every list has a ceiling
# and the default is the smallest answer that is still an answer; the drill-down is
# always another call with a bigger number or a narrower filter.
DEFAULT_GAMES = 5
MAX_GAMES = 25
DEFAULT_WORST_MOMENTS = 3
MAX_WORST_MOMENTS = 8
DEFAULT_MOMENTS = 5
MAX_MOMENTS = 25
DEFAULT_SEARCH = 20
MAX_SEARCH = 100
DEFAULT_POSITIONS = 10
MAX_POSITIONS = 50
DEFAULT_CONTINUATIONS = 12
MAX_CONTINUATIONS = 40
DEFAULT_NOTES = 20
MAX_NOTES = 100
DEFAULT_RATING_POINTS = 24
MAX_RATING_POINTS = 200

# Points kept from a game's eval curve. Enough to see the shape of the game; the moves
# themselves are what `get_game` is for.
CURVE_POINTS = 16

# `analyze_position` blocks the caller's turn, so its budget is bounded no matter what
# was asked for.
DEFAULT_BUDGET_NODES = 500_000
MAX_BUDGET_NODES = 5_000_000

# Refuse to enqueue past this many waiting runs: a queue nobody will reach the end of is
# worse than a "not now", and the coach can say so.
MAX_QUEUED_RUNS = 200

# How much of a failed run's error text a status answer carries.
ERROR_TAIL = 400

INSTRUCTIONS = """Blunderbase is the owner's personal chess database: every game they
have played, with pre-computed Stockfish and Maia analysis.

Answer chess questions from these tools rather than from the board — the engine numbers
here are the truth, and your job is to read them, plan training and remember.
Evaluations are in win percentage (0-100) from the mover's side; `win_loss` is how much
of it a move gave away, and a classification only appears on an inaccuracy, mistake or
blunder. Start wide (get_last_games, get_worst_recent_moments, get_stats) and drill down
(get_game, opening_explorer, find_positions) rather than pulling whole games first.
Deep analysis is queued, not immediate: request_analysis returns a run id to poll.
Write what you learn down with save_note, and open a session with search_notes.
The owner may have Blunderbase open beside this chat: show_game, show_position, make_move
and annotate drive the board they are looking at, so show a position rather than spelling
one out. Those moves are an analysis board — they never change a stored game."""

STATS_DESCRIPTION = (
    "One aggregation over the owner's games. `dimension` is one of: "
    + ", ".join(stats_service.DIMENSIONS)
    + ". Windows accept an ISO date or a relative window like '90d'. Each answer carries "
    "its buckets and their totals: counts, scores and average win% given away."
)


class Coach:
    """The session-owning half of the coach surface: one Session per tool call.

    Tools are sync functions, which the SDK runs on a worker thread, so each call takes
    its own Session out of the same pool the API and the workers use. Nothing here
    touches the database itself — every statement below this line is a service call.
    """

    def __init__(
        self, settings: Settings | None = None, sessions: sessionmaker[Session] | None = None
    ) -> None:
        self._settings = settings
        self._sessions = sessions

    @property
    def settings(self) -> Settings:
        return self._settings or get_settings()

    @contextmanager
    def session(self) -> Iterator[Session]:
        factory = self._sessions or get_sessionmaker(self._settings)
        with factory() as session:
            try:
                yield session
                session.commit()
            except Exception:
                session.rollback()
                raise


def build_server(
    settings: Settings | None = None,
    sessions: sessionmaker[Session] | None = None,
    *,
    name: str = SERVER_NAME,
) -> MCPServer:
    """The MCP coach surface, ready for either transport.

    `sessions` is the injection seam: a test hands in its own in-memory sessionmaker, and
    everything else lets the shared one be resolved on first use so building a server
    never opens a database.
    """
    coach = Coach(settings, sessions)
    server: MCPServer = MCPServer(name=name, instructions=INSTRUCTIONS)
    _register_convenience(server, coach)
    _register_query(server, coach)
    _register_accounts(server, coach)
    _register_insight(server, coach)
    _register_analysis(server, coach)
    _register_memory(server, coach)
    _register_live(server, coach)
    return server


# --- convenience -----------------------------------------------------------


def _register_convenience(server: MCPServer, coach: Coach) -> None:
    @server.tool()
    @guarded
    def get_last_games(
        amount: int = DEFAULT_GAMES,
        platform: str | None = None,
        time_control: str | None = None,
        worst_moments: int = DEFAULT_WORST_MOMENTS,
    ) -> TextContent:
        """The owner's newest games as compact cards: result, colour, opponent and
        rating, opening, the eval curve as [ply, win%] pairs, and the worst moments with
        their classifications. `platform` is lichess, chesscom, pgn, manual or otb;
        `time_control` is either a speed (blitz) or a literal clock (300+3)."""
        count = args.capped(amount, DEFAULT_GAMES, MAX_GAMES)
        speed, literal = args.time_control(time_control)
        filters = GameFilters(
            source=args.platform(platform), speed=speed, time_control=literal
        )
        worst = max(0, min(int(worst_moments), MAX_WORST_MOMENTS))
        with coach.session() as session:
            found = games_service.search_games(session, filters, limit=count)
            cards = games_service.game_cards(session, found, worst=worst)
        return payloads.result(
            {
                "games": [payloads.game_card(card, curve_points=CURVE_POINTS) for card in cards],
                "count": len(cards),
            }
        )

    @server.tool()
    @guarded
    def get_worst_recent_moments(
        days: int | None = None, amount: int = DEFAULT_MOMENTS
    ) -> TextContent:
        """The owner's recent blunders, ranked by the win% they gave away — "what should
        I train?". Each carries the position, what was played, what was better, the phase
        and the piece, and the game it happened in. `days` narrows to games played that
        recently; `amount` caps the list. Smaller mistakes live on the game's own card."""
        count = args.capped(amount, DEFAULT_MOMENTS, MAX_MOMENTS)
        window = max(1, int(days)) if days is not None else None
        with coach.session() as session:
            moments = stats_service.get_worst_recent_moments(
                session, days=window, amount=count
            )
        return payloads.result(
            {
                "moments": [payloads.worst_moment(entry) for entry in moments],
                "count": len(moments),
                "days": window,
            }
        )

    @server.tool()
    @guarded
    def compare_periods(
        dimension: str,
        then_start: str,
        then_end: str,
        now_start: str,
        now_end: str | None = None,
    ) -> TextContent:
        """The same stats dimension across two windows — "am I getting better at X?".
        Each bound is an ISO date or a relative window like '90d'; `now_end` defaults to
        now. The answer carries both periods and the delta between them."""
        then = args.period(then_start, then_end, "then")
        now = args.period(now_start, now_end, "now")
        with coach.session() as session:
            comparison = stats_service.compare_periods(session, dimension.strip(), then, now)
        return payloads.result(comparison)


# --- query -----------------------------------------------------------------


def _register_query(server: MCPServer, coach: Coach) -> None:
    @server.tool()
    @guarded
    def search_games(
        since: str | None = None,
        until: str | None = None,
        platform: str | None = None,
        color: str | None = None,
        eco: str | None = None,
        result: str | None = None,
        outcome: str | None = None,
        time_control: str | None = None,
        opponent: str | None = None,
        variant: str | None = None,
        has_blunders: bool | None = None,
        deep_analyzed: bool | None = None,
        text: str | None = None,
        limit: int = DEFAULT_SEARCH,
        offset: int = 0,
    ) -> TextContent:
        """Games matching any combination of filters, newest first, as compact rows.
        `outcome` is win/loss/draw from the owner's side; `result` is the PGN result
        (1-0, 0-1, 1/2-1/2). `eco` matches a code or a prefix (C6 for all of C60-C69),
        `text` searches names, openings and terminations. Dates accept an ISO date or a
        relative window like '30d'. Follow up with get_game for the moves."""
        speed, literal = args.time_control(time_control)
        filters = GameFilters(
            since=args.when(since, "since"),
            until=args.when(until, "until"),
            source=args.platform(platform),
            color=args.color(color),
            eco=eco,
            result=args.member(Result, result, "result"),
            outcome=outcome,
            speed=speed,
            time_control=literal,
            opponent=opponent,
            variant=variant,
            has_blunders=has_blunders,
            deep_analyzed=deep_analyzed,
            text=text,
        )
        count = args.capped(limit, DEFAULT_SEARCH, MAX_SEARCH)
        start = args.offset(offset)
        with coach.session() as session:
            found = games_service.search_games(session, filters, limit=count, offset=start)
            rows = [payloads.game_row(games_service.game_summary(game)) for game in found]
            total = games_service.count_games(session, filters)
        return payloads.result(
            {"games": rows, "count": len(rows), "total": total, "offset": start}
        )

    @server.tool()
    @guarded
    def get_game(
        game_id: int,
        ply_start: int | None = None,
        ply_end: int | None = None,
        include_notes: bool = True,
        include_lines: bool = False,
    ) -> TextContent:
        """One game move by move, with the eval after each ply, the classification and
        better move on every inaccuracy, mistake and blunder, Maia's human predictions
        where a Maia pass has run, and any notes. Narrow a long game with a ply range
        (half-moves, end exclusive); `include_lines` adds the engine's multi-PV lines,
        which are large."""
        window = args.ply_range(ply_start, ply_end)
        detail_range = None if window is None else (window[0], window[1] - 1)
        with coach.session() as session:
            detail = games_service.get_game_detail(
                session, int(game_id), ply_range=detail_range, include_notes=include_notes
            )
        if detail is None:
            raise CoachError(UNKNOWN_GAME, f"no game with id {game_id}", game_id=int(game_id))

        payload = {
            "game": payloads.game_row(detail["game"]),
            "ply_range": list(window) if window is not None else None,
            "moves": [
                payloads.move_row(move, include_lines=include_lines) for move in detail["moves"]
            ],
            "runs": [payloads.run_row(run) for run in detail["runs"]],
        }
        if include_notes:
            payload["notes"] = [payloads.note_row(note) for note in detail.get("notes", ())]
        return payloads.result(payload)

    @server.tool()
    @guarded
    def find_positions(
        fen: str,
        color: str | None = None,
        limit: int = DEFAULT_POSITIONS,
        motif: str | None = None,
    ) -> TextContent:
        """"Have I been here before?" — the owner's games that reached a position, with
        the move they played there, what it cost, and how the game ended. Accepts a full
        FEN or an EPD; move counters are ignored."""
        if motif:
            raise CoachError(
                NOT_IMPLEMENTED,
                "motif filters need tactical motif detection, which no analysis pass "
                "produces yet; search by FEN, or use get_stats for what is aggregated",
                motif=motif,
            )
        position = args.fen(fen)
        count = args.capped(limit, DEFAULT_POSITIONS, MAX_POSITIONS)
        with coach.session() as session:
            rows = explorer_service.find_positions(
                session, str(position), color=args.color(color), limit=count
            )
            found = [
                {**row, "game": payloads.game_row(row["game"])}
                for row in rows
            ]
        return payloads.result({"games": found, "count": len(found)})

    @server.tool()
    @guarded
    def get_player_profile(rating_points: int = DEFAULT_RATING_POINTS) -> TextContent:
        """Who the owner is, by the numbers: their accounts, ratings over time per
        platform and speed, and volume by source, speed and year. `rating_points` caps
        how many points each rating series carries."""
        points = args.capped(rating_points, DEFAULT_RATING_POINTS, MAX_RATING_POINTS)
        with coach.session() as session:
            profile = games_service.get_player_profile(session, max_points=points)
        return payloads.result(profile)


# --- accounts --------------------------------------------------------------


def _register_accounts(server: MCPServer, coach: Coach) -> None:
    @server.tool()
    @guarded
    def register_account(platform: str, username: str) -> TextContent:
        """Tell the database that a username on `lichess` or `chesscom` is one the owner
        plays under, and claim the games already stored under it. This is the fix when
        games come back with no colour, opponent or rating: they were imported before any
        account named their owner. Safe to repeat — a game whose side is already known
        keeps it."""
        kind = args.member(Platform, platform, "platform")
        if kind is None:
            raise CoachError(BAD_ARGUMENT, "a platform is required")
        with coach.session() as session:
            account, filled = accounts_service.register_and_reconcile(session, kind, username)
            payload = accounts_service.account_payload(
                account, accounts_service.attributed_counts(session).get(account.id, 0)
            )
            unclaimed = accounts_service.unclaimed_games(session)
        return payloads.result(
            {
                "account": payload,
                "linked": filled.linked,
                "colored": filled.colored,
                "unclaimed": unclaimed,
            }
        )


# --- stats and explorer ----------------------------------------------------


def _register_insight(server: MCPServer, coach: Coach) -> None:
    @server.tool()
    @guarded
    def opening_explorer(
        fen: str | None = None,
        eco: str | None = None,
        color: str | None = None,
        limit: int = DEFAULT_CONTINUATIONS,
        min_games: int = 1,
    ) -> TextContent:
        """The owner's personal opening tree from a position: how often they played each
        continuation, how they scored, the average win% it gave away, and where they
        leave their own book. Enter by FEN, by ECO code, or by neither for the starting
        position. There is no reference database here — this is their games only."""
        start = args.fen(fen, required=False)
        with coach.session() as session:
            tree = explorer_service.opening_explorer(
                session,
                fen=start,
                eco=eco,
                color=args.color(color),
                limit=args.capped(limit, DEFAULT_CONTINUATIONS, MAX_CONTINUATIONS),
                min_games=max(1, int(min_games)),
            )
        return payloads.result(tree)

    @server.tool(description=STATS_DESCRIPTION)
    @guarded
    def get_stats(
        dimension: str,
        since: str | None = None,
        until: str | None = None,
        platform: str | None = None,
        color: str | None = None,
        time_control: str | None = None,
    ) -> TextContent:
        speed, literal = args.time_control(time_control)
        filters = GameFilters(
            source=args.platform(platform), color=args.color(color), speed=speed,
            time_control=literal,
        )
        with coach.session() as session:
            payload = stats_service.get_stats(
                session,
                dimension.strip(),
                since=args.when(since, "since"),
                until=args.when(until, "until"),
                filters=filters,
            )
        return payloads.result(payload)


# --- analysis --------------------------------------------------------------


def _register_analysis(server: MCPServer, coach: Coach) -> None:
    @server.tool()
    @guarded
    def request_analysis(
        game_id: int | None = None,
        fen: str | None = None,
        tier: str = str(Tier.DEEP),
        ply_start: int | None = None,
        ply_end: int | None = None,
        multipv: int | None = None,
        nodes: int | None = None,
    ) -> TextContent:
        """Queue an engine pass over one game or one position and get a run id back.
        Deep analysis takes minutes, so this never blocks: poll get_analysis_status, and
        read the result with get_game once it is done. A ply range (half-moves, end
        exclusive) analyses one phase deeply. Re-analysis never overwrites an old run."""
        window = args.ply_range(ply_start, ply_end)
        wanted = args.tier(tier)
        position = args.fen(fen, required=False)
        with coach.session() as session:
            depth = analysis_service.queue_depth(session)
            if depth["queued"] >= MAX_QUEUED_RUNS:
                raise CoachError(
                    QUEUE_FULL,
                    f"{depth['queued']} runs are already waiting; try again once the "
                    "queue has drained",
                    **depth,
                )
            if game_id is not None and games_service.get_game(session, int(game_id)) is None:
                raise CoachError(
                    UNKNOWN_GAME, f"no game with id {game_id}", game_id=int(game_id)
                )
            run = analysis_service.request_analysis(
                session,
                game_id=int(game_id) if game_id is not None else None,
                fen=position,
                tier=wanted,
                ply_range=window,
                multipv=multipv,
                nodes=nodes,
            )
            payload = {
                "run_id": run.id,
                "status": str(run.status),
                "tier": str(run.tier),
                "game_id": run.game_id,
                "fen": run.fen,
                "nodes": run.nodes,
                "multipv": run.multipv,
                "ply_start": run.ply_start,
                "ply_end": run.ply_end,
                "queue": analysis_service.queue_depth(session),
            }
        return payloads.result(payload)

    @server.tool()
    @guarded
    def get_analysis_status(run_id: int) -> TextContent:
        """Where a queued analysis pass has got to: queued, running, done or failed,
        with how many plies it has written and what is still ahead of it. A failed run
        carries the engine's own last words."""
        with coach.session() as session:
            run = analysis_service.require_run(session, int(run_id))
            evals = len(analysis_service.get_move_evals(session, run.id))
            engine = run.engine
            payload = {
                "run_id": run.id,
                "status": str(run.status),
                "tier": str(run.tier),
                "game_id": run.game_id,
                "fen": run.fen,
                "engine": engine.name if engine is not None else None,
                "nodes": run.nodes,
                "multipv": run.multipv,
                "ply_start": run.ply_start,
                "ply_end": run.ply_end,
                "attempts": run.attempts,
                "created_at": payloads.stamp(run.created_at),
                "started_at": payloads.stamp(run.started_at),
                "finished_at": payloads.stamp(run.finished_at),
                "evals": evals,
                "error": _tail(run.error),
                "queue": analysis_service.queue_depth(session),
            }
        return payloads.result(payload)

    @server.tool()
    @guarded
    def analyze_position(fen: str, budget: int = DEFAULT_BUDGET_NODES) -> TextContent:
        """A synchronous engine eval of one position, for a "what if" line mid-
        conversation. `budget` is a node count, capped so the answer arrives inside the
        turn; a whole game belongs in request_analysis. Returns an error with code
        engine_unavailable when no engine is enabled."""
        position = args.fen(fen)
        nodes = args.capped(budget, DEFAULT_BUDGET_NODES, MAX_BUDGET_NODES)
        with coach.session() as session:
            payload = analysis_service.analyze_position(session, str(position), nodes)
        return payloads.result(payload)


# --- memory ----------------------------------------------------------------


def _register_memory(server: MCPServer, coach: Coach) -> None:
    @server.tool()
    @guarded
    def save_note(
        text: str,
        tags: list[str] | None = None,
        game_id: int | None = None,
        fen: str | None = None,
    ) -> TextContent:
        """Write something down: what you worked on, a plan, a weakness, a session
        summary. Tags are how you find it again, so use consistent ones. A note can hang
        off a game, off a position, or off neither."""
        position = args.fen(fen, required=False)
        with coach.session() as session:
            if game_id is not None and games_service.get_game(session, int(game_id)) is None:
                raise CoachError(
                    UNKNOWN_GAME, f"no game with id {game_id}", game_id=int(game_id)
                )
            note = notes_service.save_note(
                session,
                text,
                args.tags(tags),
                game_id=int(game_id) if game_id is not None else None,
                fen=position,
            )
            payload = notes_service.note_payload(note)
        return payloads.result(payloads.note_row(payload))

    @server.tool()
    @guarded
    def search_notes(
        query: str | None = None,
        tags: list[str] | None = None,
        since: str | None = None,
        until: str | None = None,
        game_id: int | None = None,
        fen: str | None = None,
        limit: int = DEFAULT_NOTES,
    ) -> TextContent:
        """What was written down before — start a session with this. Free text, tags
        (all of them must match), a date window ('30d' works), a game or a position;
        newest first. With no arguments it returns the most recent notes and every tag
        in use."""
        position = args.fen(fen, required=False)
        count = args.capped(limit, DEFAULT_NOTES, MAX_NOTES)
        with coach.session() as session:
            found = notes_service.search_notes(
                session,
                query=query,
                tags=args.tags(tags),
                since=args.when(since, "since"),
                until=args.when(until, "until"),
                game_id=int(game_id) if game_id is not None else None,
                fen=position,
                limit=count,
            )
            rows = [payloads.note_row(notes_service.note_payload(note)) for note in found]
            payload = {"notes": rows, "count": len(rows)}
            if not any((query, tags, since, until, game_id, fen)):
                payload["tags"] = notes_service.list_tags(session)
        return payloads.result(payload)


# --- live session ----------------------------------------------------------


def _register_live(server: MCPServer, coach: Coach) -> None:
    @server.tool()
    @guarded
    def show_game(game_id: int, ply: int = 0) -> TextContent:
        """Put one of the owner's games on the board they are watching, `ply` half-moves
        in (0 is the starting position). Use this instead of describing a position in
        words. The answer is the live state, which also says whether a browser is
        actually following along."""
        with coach.session() as session:
            state = live_service.show_game(session, int(game_id), int(ply))
        return payloads.result(state)

    @server.tool()
    @guarded
    def show_position(fen: str) -> TextContent:
        """Put an ad-hoc position on the board they are watching. Takes a FEN or an EPD.
        This leaves whatever game was showing: it is an analysis board from here, and
        nothing done on it changes a stored game."""
        position = args.fen(fen)
        state = live_service.show_position(str(position))
        return payloads.result(state)

    @server.tool()
    @guarded
    def make_move(uci: str) -> TextContent:
        """Play one move on the live board, in UCI (e2e4, e7e8q for a promotion), and let
        the browser animate it. Walk a line one call at a time. An illegal move is
        refused with code illegal_move rather than being shown; playing the followed
        game's own next move keeps the board on that game."""
        state = live_service.make_move(str(uci))
        return payloads.result(state)

    @server.tool()
    @guarded
    def annotate(
        arrows: list[str] | None = None,
        squares: list[str] | None = None,
        text: str | None = None,
    ) -> TextContent:
        """Draw on the live board. An arrow is "e2e4" or "e2e4:blue"; a highlighted square
        is "e4" or "e4:red"; colours are green, red, blue and yellow. `text` is the comment
        shown under the board. Each argument replaces what was there and an empty list
        clears it; the marks are wiped whenever the position changes."""
        state = live_service.annotate(arrows=arrows, squares=squares, text=text)
        return payloads.result(state)

    @server.tool()
    @guarded
    def get_live_state() -> TextContent:
        """What the owner's board is showing right now, and whether anyone is looking:
        `viewer_count` is how many browsers are subscribed. Read this before driving the
        board in a new session, or after being told the page was reloaded."""
        return payloads.result(live_service.get_state())


def _tail(text: str | None) -> str | None:
    if not text:
        return None
    return text if len(text) <= ERROR_TAIL else "..." + text[-ERROR_TAIL:]


def run_stdio(settings: Settings | None = None) -> None:
    """Serve the coach surface on stdin/stdout, which is how a local client speaks."""
    build_server(settings).run("stdio")

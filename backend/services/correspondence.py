"""Correspondence play: the games the owner is in the middle of, and the tree behind them.

Everything else in the library is a record of a game that has been played. A correspondence
game is one that is *being* played — a move every few days, for months — and the work is
not the move list but the tree of candidate moves behind it: which of three or four moves
survives a week of looking at the opponent's best replies. This module owns both halves.

The shapes worth knowing before reading the code:

* **A correspondence game is a `Game`.** Created through `import_service.import_one` with
  `Source.ICCF` (its `source_id` the ICCF game number) or `Source.MANUAL`,
  `Speed.CORRESPONDENCE`, `Result.UNKNOWN` and an explicit `owner_color`, so it has
  positions, a job row and the same events as any other game, and is a library game like
  any other the moment it finishes. It is imported with the quick pass **off**: the tree is
  its analysis while it runs, and a pass over an ongoing game would be redone after every
  move.
* **`Game` is mutated here and nowhere else.** `games.append_move` / `pop_move` are the one
  exception to the library's immutability, and this module is their only caller.
* **The played nodes are the game.** They form one path from the root and their moves are
  `Game.moves_uci`; `verify_played_path` says so after every mutation that could break it.
* **A node is legal because it was played.** The replay from the parent's board is the
  validation and is where the SAN comes from — the repertoire's rule — so a stored SAN can
  never disagree with the position it was written in.
* **Evaluations are keyed by position, not by node.** A transposition inside one tree, the
  same opening in two games and a node deleted and added again all read the same verdict.
* **Two numbers per node, neither stored.** *own* is the node's chosen verdict (the pinned
  engine's, else the deepest); *backed* is the minimax over the children that have a value.
  The gap between them is the whole point: a root that disagrees with the minimax of its
  children is an engine's first choice refuted further down.
* **Nothing here touches an engine process.** Searches are rows and events: starting,
  pausing, resuming and stopping one writes a row and emits `correspondence.search`, and
  `workers/correspondence_searches.py` is what reacts — takes a slot, drives the engine,
  and comes back here to `checkpoint` and to the `mark_*` writers. The same split as
  `analysis.py` and `workers/analysis_queue.py`, and the reason the browser and an MCP
  client can never disagree about what is running.
"""

from __future__ import annotations

import io
import logging
from collections.abc import Callable, Iterable, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any, NamedTuple

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from backend.db.enums import (
    Color,
    CorrespondenceMark,
    EngineKind,
    Result,
    SearchKind,
    SearchStatus,
    Source,
    Speed,
    Tier,
)
from backend.db.models import (
    CorrespondenceEval,
    CorrespondenceGame,
    CorrespondenceNode,
    CorrespondenceSearch,
    Engine,
    Game,
)
from backend.db.types import utcnow
from backend.services import analysis as analysis_service
from backend.services import app_settings as app_settings_service
from backend.services import events as events_service
from backend.services import games as games_service
from backend.services import import_service
from backend.services.explorer import normalize_fen

logger = logging.getLogger(__name__)

EVENT_UPDATED = "correspondence.updated"
# One event per transition of a search row: started, running, parked, resumed, ended. The
# page draws from it and the worker acts on it — which is what keeps the service from ever
# touching a process. `correspondence.snapshot` is the worker's own, and is never written
# to the database; its name lives here so that the two halves cannot drift apart.
EVENT_SEARCH = "correspondence.search"
EVENT_SNAPSHOT = "correspondence.snapshot"

# How many points an eval's history keeps. Eighty is deeper than any engine reaches on a
# position a person is waiting for, so in practice nothing is ever dropped — the cap is
# there so that a row cannot grow without bound over a month of resumes.
HISTORY_LIMIT = 80
# How much the node count has to grow before a picture at a depth already in the history
# becomes a second point rather than replacing the first. The history keys on depth *and*
# nodes (`docs/correspondence.md`, decision 5), because a Leela sits at depth 19 for a day
# while its node count goes from one million to four hundred: keyed on depth alone that
# search would end with a single point, and the trajectory — the whole reason the history
# is kept — would be a flat line. A quarter more nodes is a stretch of real work, and a
# search that only ever climbs in depth writes exactly one entry per depth as before.
# The test is against the last point kept rather than a fixed step, so the points thin out
# as the search goes: a million nodes to four hundred million is about thirty of them,
# which is a trajectory rather than a log of the last hour under `HISTORY_LIMIT`.
HISTORY_NODE_GROWTH = 1.25
# As much of a failed engine's dying words as is worth keeping on the row, as `AnalysisRun`
# keeps them.
STDERR_LIMIT = 4000

# What "the caller said nothing about this field" looks like, the repertoire's rule: `None`
# cannot be it, because `None` already means "clear it".
UNCHANGED: Any = object()

# The glyph each mark shows, and the NAG it exports as. PGN has no glyph for "do not
# consider this move", so `excluded` exports as `??` — the nearest thing a reader of the
# exported game can act on — while the tree keeps the distinction that steers the engines.
MARK_GLYPHS: dict[CorrespondenceMark, str] = {
    CorrespondenceMark.GOOD: "!",
    CorrespondenceMark.INTERESTING: "!?",
    CorrespondenceMark.DUBIOUS: "?!",
    CorrespondenceMark.BAD: "?",
    CorrespondenceMark.EXCLUDED: "✕",
}
MARK_NAGS: dict[CorrespondenceMark, int] = {
    CorrespondenceMark.GOOD: 1,
    CorrespondenceMark.INTERESTING: 5,
    CorrespondenceMark.DUBIOUS: 6,
    CorrespondenceMark.BAD: 2,
    CorrespondenceMark.EXCLUDED: 4,
}

# How far apart two engines' verdicts on one position have to be before the node is marked
# as one they disagree about. Half a pawn: below that two strong engines routinely differ
# on a position neither is wrong about, and above it one of them has seen something.
DISAGREEMENT_CP = 50

# What a mate is worth when scores are compared. Far beyond any centipawn evaluation, and
# the distance to mate is subtracted so that mate in two outranks mate in nine.
MATE_SCORE = 1_000_000

# The states in which a search still owns its node: it is queued for a slot, running in
# one, or parked with its process warm. A subtree holding one of these cannot be deleted.
LIVE_SEARCH_STATES = (SearchStatus.QUEUED, SearchStatus.RUNNING, SearchStatus.PAUSED)
# And the states it is over in. A row in one of these is history: nothing restarts it, and
# a second `stop` or a late answer from a worker leaves it exactly as it is.
TERMINAL_SEARCH_STATES = (SearchStatus.DONE, SearchStatus.STOPPED, SearchStatus.FAILED)

# The worker's last picture of each search it is running, if a worker is running at all.
# Set by `register_snapshots`; see there for why this is not a row.
_SNAPSHOT_SOURCE: Callable[[], dict[int, dict[str, Any]]] | None = None
# What the worker in this process actually sized itself to. Set by `register_capacity`;
# see `_running_slots` for why the setting is not the answer.
_CAPACITY_SOURCE: Callable[[], dict[str, Any]] | None = None

# A score in White's frame as the tree passes it around: `(cp, mate)`, exactly one of them
# set, and None where nothing has evaluated the node at all.
type Value = tuple[int | None, int | None] | None

STATE_ONGOING = "ongoing"
STATE_FINISHED = "finished"
STATES = (STATE_ONGOING, STATE_FINISHED)


class _Start(NamedTuple):
    """Where a game's first position stands, which everything counted in plies starts from.

    A correspondence game may begin anywhere: the New game dialog takes a FEN for a thematic
    tournament, and a PGN with a `SetUp` header brings its own. Ply parity alone would then
    be a lie — whose move it is, when the reply is due, whose point of view a node's numbers
    are from and what number a move is written with all follow from *this* game's first
    position rather than from the ordinary array.

    `offset` is 0 when White moves first there and 1 when Black does; `move_number` is that
    position's full-move number.
    """

    offset: int
    move_number: int


# --- failures --------------------------------------------------------------


class CorrespondenceError(ValueError):
    """A request the tree or the game cannot take."""


class UnknownCorrespondenceGameError(LookupError):
    """No correspondence game with that id."""


class UnknownNodeError(LookupError):
    """No node with that id."""


class CorrespondenceConflict(RuntimeError):
    """A request that is refused by the state something is in, not by its content."""


class GameAlreadyStoredError(CorrespondenceConflict):
    """The library already holds this game — the same ICCF number, or the same moves."""


class TreeLockedError(CorrespondenceConflict):
    """The game has a result, so its tree is read-only."""


class NodeBusyError(CorrespondenceConflict):
    """A search is queued, running or parked inside the subtree that was to be deleted."""


class UnknownSearchError(LookupError):
    """No search with that id."""


class SearchBusyError(CorrespondenceConflict):
    """That engine is already queued, running or parked on that node."""


# --- games -----------------------------------------------------------------


def create_game(
    session: Session,
    *,
    white: str,
    black: str,
    owner_color: Color | str,
    event: str | None = None,
    url: str | None = None,
    iccf_id: str | None = None,
    time_control: str | None = None,
    start_fen: str | None = None,
    days_per_move: int | None = None,
    reply_due: datetime | None = None,
    white_rating: int | None = None,
    black_rating: int | None = None,
) -> dict[str, Any]:
    """Start a correspondence game the owner is about to play.

    The game goes in through the ordinary import path so that nothing downstream has to
    know it is special: it gets its `positions`, its `import_jobs` row and the same events
    every other game gets, and the only differences are the ones that matter —
    `Speed.CORRESPONDENCE`, `Result.UNKNOWN`, an explicit `owner_color`, and no automatic
    quick pass.

    An ICCF game number makes it a `Source.ICCF` game with that id, so a later importer can
    reconcile the finished game by number rather than by hash; without one it is
    `Source.MANUAL`, which is what a correspondence game played anywhere else is.

    A game the library already holds is refused rather than stored twice, on the importer's
    own terms: the ICCF number where there is one, and otherwise the two names, the day and
    the moves. Two games with no number, the same two players on the same side and no moves
    yet, started on the same day, are that hash — so the second is refused until it has a
    number or a move, which is the price of being identified the way every other game is.
    """
    import chess

    names = _names(white, black)
    color = _color(owner_color)
    board = _start_board(start_fen)
    number = (iccf_id or "").strip() or None
    source = Source.ICCF if number else Source.MANUAL
    started = utcnow()

    parsed = import_service.ParsedGame(
        source=source,
        source_id=number,
        white_name=names[0],
        black_name=names[1],
        result=Result.UNKNOWN,
        pgn=_fresh_pgn(
            white=names[0],
            black=names[1],
            event=event,
            url=url,
            time_control=time_control,
            played_at=started,
            start_fen=board.fen() if start_fen else None,
            white_rating=white_rating,
            black_rating=black_rating,
        ),
        moves_uci=[],
        moves_san=[],
        white_rating=white_rating,
        black_rating=black_rating,
        speed=Speed.CORRESPONDENCE,
        time_control=time_control,
        played_at=started,
        initial_fen=board.fen() if start_fen else None,
        ref=f"correspondence: {names[0]} vs {names[1]}",
    )
    game = _store(session, parsed, color)
    row = _new_row(
        session,
        game,
        event=event,
        url=url,
        days_per_move=days_per_move,
        reply_due=reply_due,
    )
    _seed_tree(session, game, chess.Board(board.fen()))
    # A game that starts on the owner's move is already owed a reply, the same way an
    # imported one is; a date the owner typed outranks the one the window would compute.
    if reply_due is None:
        _settle_due(row, game)
    session.commit()
    _announce(game.id)
    return get_game(session, row.game_id)


def import_game(
    session: Session,
    pgn: str,
    *,
    owner_color: Color | str,
    event: str | None = None,
    url: str | None = None,
    iccf_id: str | None = None,
    days_per_move: int | None = None,
    reply_due: datetime | None = None,
) -> dict[str, Any]:
    """Start a correspondence game from the PGN the server it is played on exports.

    The headers and the moves so far, read by the same adapter every other PGN goes
    through, so an ICCF export and a file upload agree about what a game is. The moves are
    played onto the tree as they are read, so the game arrives with its spine already
    there, and `Result` is whatever the PGN says — a PGN of a finished game imports a
    finished game, tree and all.
    """
    import chess.pgn

    from backend.adapters import pgn_import

    text = (pgn or "").strip()
    if not text:
        raise CorrespondenceError("a PGN is needed to import a game from one")
    try:
        read = chess.pgn.read_game(io.StringIO(text))
    except Exception as exc:  # pragma: no cover - the reader recovers from almost anything
        raise CorrespondenceError(f"that PGN could not be read: {exc}") from None
    if read is None:
        raise CorrespondenceError("that PGN holds no game")
    if read.errors:
        raise CorrespondenceError(
            "that PGN could not be read: " + "; ".join(str(error) for error in read.errors)
        )
    # python-chess answers text that is not a PGN at all with an empty game rather than
    # with None — default headers, no moves — so "is this a game" is a question about what
    # came back. Neither player named and not a move in it is somebody's paste going wrong,
    # and storing it would put a game between "?" and "?" in the library.
    named = _given(read.headers.get("White")) or _given(read.headers.get("Black"))
    if not named and not any(read.mainline_moves()):
        raise CorrespondenceError("that PGN holds no game: no players in it, and no moves")
    if event:
        read.headers["Event"] = event
    if url:
        read.headers["Site"] = url

    color = _color(owner_color)
    number = (iccf_id or "").strip() or None
    try:
        parsed = pgn_import.parse_game(read)
    except Exception as exc:
        raise CorrespondenceError(f"that PGN could not be replayed: {exc}") from None
    parsed.source = Source.ICCF if number else Source.MANUAL
    parsed.source_id = number
    parsed.speed = Speed.CORRESPONDENCE
    parsed.played_at = parsed.played_at or utcnow()
    parsed.ref = f"correspondence: {parsed.white_name} vs {parsed.black_name}"

    game = _store(session, parsed, color)
    row = _new_row(
        session,
        game,
        event=event or read.headers.get("Event") or None,
        url=url or _given(read.headers.get("Site")),
        days_per_move=days_per_move,
        reply_due=reply_due,
    )
    if game.ply_count:
        row.last_move_at = game.played_at or utcnow()
    _seed_tree(session, game, read.board())
    # A date the owner typed outranks the one the window would compute: the server the game
    # is played on is the authority on the clock, and they are copying it off that page.
    if reply_due is None and game.result is Result.UNKNOWN:
        _settle_due(row, game)
    session.commit()
    _announce(game.id)
    return get_game(session, row.game_id)


def update_game(
    session: Session,
    game_id: int,
    *,
    event: str | None = UNCHANGED,
    url: str | None = UNCHANGED,
    reply_due: datetime | None = UNCHANGED,
    days_per_move: int | None = UNCHANGED,
) -> dict[str, Any]:
    """Change what the owner keeps about a game: the tournament, the link, the deadlines.

    A field left out is left alone and a field given as null is cleared, which is why the
    caller has to spell the difference rather than send a None for both.
    """
    row, game = _load(session, game_id)
    if event is not UNCHANGED:
        row.event = _text(event, limit=128)
    if url is not UNCHANGED:
        row.url = _text(url, limit=512)
    if reply_due is not UNCHANGED:
        row.reply_due = _moment(reply_due)
    if days_per_move is not UNCHANGED and days_per_move is not None:
        row.days_per_move = _days(session, days_per_move)
    if event is not UNCHANGED or url is not UNCHANGED:
        # The PGN carries both, and it is what an export hands over.
        game.pgn = _with_given(games_service.rebuild_pgn(game), row)
    row.updated_at = utcnow()
    session.commit()
    _announce(game_id)
    return get_game(session, game_id)


def play_move(session: Session, game_id: int, uci: str) -> dict[str, Any]:
    """Add one move to the game — either side's — and mark it on the tree.

    The two halves are one transaction on purpose: the game's move list and the played path
    through the tree are two spellings of the same fact, and a reader that could catch them
    disagreeing would be a reader that cannot trust either.

    The move joins the tree as a child of the current tip, reusing the node if the owner had
    already analysed it — which is the ordinary case, and the point of the tree — and is
    promoted to the front of its siblings, because the game's own line is the main line.

    When the move leaves it as the owner's turn, the reply is due `days_per_move` from now;
    when it does not, there is nothing to be due.
    """
    row, game = _load(session, game_id)
    _require_open(game)
    games_service.append_move(session, game, uci)
    played = game.moves_uci[-1]

    nodes = _nodes(session, game_id)
    tip = _tip(nodes)
    board = _board_at(game, tip, nodes)
    move = board.parse_uci(played)
    san = board.san(move)
    board.push(move)
    node = _child(session, tip, played)
    if node is None:
        node = _add(session, game_id, tip, played, san, normalize_fen(board.fen())[0])
    node.played = True
    node.updated_at = utcnow()
    _promote(session, node)

    row.last_move_at = utcnow()
    _settle_due(row, game)
    row.updated_at = utcnow()
    session.flush()
    verify_played_path(session, game_id)
    session.commit()
    _announce(game_id)
    return get_game(session, game_id)


def undo_move(session: Session, game_id: int) -> dict[str, Any]:
    """Take the last move back off the game. The node stays, unplayed.

    A move entered wrongly is the reason this exists, and the analysis under the node the
    game had walked into is worth exactly as much as it was a minute ago — so the node keeps
    its subtree, its comments and its evaluations, and only stops being part of the game.
    """
    row, game = _load(session, game_id)
    _require_open(game)
    nodes = _nodes(session, game_id)
    tip = _tip(nodes)
    games_service.pop_move(session, game)
    if tip.parent_id is not None:
        tip.played = False
        tip.updated_at = utcnow()

    _settle_due(row, game)
    row.updated_at = utcnow()
    session.flush()
    verify_played_path(session, game_id)
    session.commit()
    _announce(game_id)
    return get_game(session, game_id)


def finish_game(
    session: Session, game_id: int, *, result: Result | str, termination: str | None = None
) -> dict[str, Any]:
    """Record how the game ended, and hand it to the library.

    Which is the whole ceremony: a result is what makes a `Game` immutable again, so the
    tree becomes read-only in the same breath, and the two ordinary passes — quick and deep
    — are queued through `services.analysis` exactly as they would be for any other game.
    From here it is a game like any other: on the eval graph, in the stats under the
    correspondence chip, with its tree still attached.

    A deployment with no engine assigned to a tier queues nothing for that tier and says so
    rather than refusing the finish: the game did end, and the pass can be asked for later.
    """
    row, game = _load(session, game_id)
    _require_open(game)
    ended = Result(result)
    if ended is Result.UNKNOWN:
        raise CorrespondenceError("a game finishes with a result, and `*` is not one")

    game.result = ended
    game.termination = _text(termination, limit=64)
    game.pgn = _with_given(games_service.rebuild_pgn(game), row)
    row.reply_due = None
    row.updated_at = utcnow()
    session.flush()
    session.commit()

    queued = [run.id for run in _queue_passes(session, game)]
    _announce(game_id)
    payload = get_game(session, game_id)
    payload["queued_runs"] = queued
    return payload


def list_games(session: Session, *, state: str | None = None) -> dict[str, Any]:
    """Every correspondence game, newest work first, with what the list page shows.

    `state` is `ongoing` or `finished`; anything else is every game. The three sections the
    page draws — your move, waiting for the opponent, finished — are a client-side split of
    this, because they are one ordering with two cuts in it and a caller that wants all
    three should not pay for three requests.
    """
    wanted = _state(state)
    rows = list(
        session.execute(
            select(CorrespondenceGame, Game)
            .join(Game, Game.id == CorrespondenceGame.game_id)
            .order_by(CorrespondenceGame.updated_at.desc(), CorrespondenceGame.id.desc())
        ).all()
    )
    kept = [(row, game) for row, game in rows if wanted is None or _state_of(game) == wanted]
    ids = [game.id for _row, game in kept]

    tips = _tips(session, ids)
    evals = _evals_for(session, {node.epd for node in tips.values()})
    running = _running(session, ids)
    games = [
        _game_row(row, game, tips.get(game.id), evals, running.get(game.id, []))
        for row, game in kept
    ]
    games.sort(key=_list_order)
    return {
        "games": games,
        "counts": {
            "ongoing": sum(1 for _row, game in rows if _state_of(game) == STATE_ONGOING),
            "finished": sum(1 for _row, game in rows if _state_of(game) == STATE_FINISHED),
            "your_move": sum(
                1
                for _row, game in rows
                if _state_of(game) == STATE_ONGOING and _owner_to_move(game)
            ),
        },
    }


def get_game(session: Session, game_id: int) -> dict[str, Any]:
    """One game, its whole tree, every evaluation the tree's positions have and every
    search over them, in one payload.

    One SELECT per table and the assembly in Python, the way the repertoire's tree is done:
    a correspondence tree is hundreds of nodes at most, the page wants all of it, and a
    recursive walk would be a round trip per ply for a payload that is going out whole.
    """
    row, game = _load(session, game_id)
    nodes = _nodes(session, game_id)
    evals = _evals_for(session, {node.epd for node in nodes})
    searches = _searches_for(session, [node.id for node in nodes])
    names = _engine_names(session, evals, searches)

    tree, by_id = _assemble(game, nodes, evals, searches, names)
    tip = _tip(nodes)
    return {
        "game": _game_payload(row, game, by_id.get(tip.id)),
        "tree": tree,
        "searches": [
            _search_payload(search, names) for rows in searches.values() for search in rows
        ],
    }


def verify_played_path(session: Session, game_id: int) -> list[CorrespondenceNode]:
    """The played nodes, checked to be one path from the root spelling `Game.moves_uci`.

    The invariant the whole mode rests on, asserted rather than assumed: the tree is the
    analysis of *this* game, and a played path that had branched, skipped a ply or drifted
    from the move list would make every reading of it — the tip, the candidates, the
    export, the next move — quietly wrong.
    """
    _row, game = _load(session, game_id)
    nodes = _nodes(session, game_id)
    played = sorted((node for node in nodes if node.played), key=lambda node: node.ply)
    if not played or played[0].parent_id is not None:
        raise CorrespondenceError(f"game {game_id}: the tree has no played root")
    walked: list[CorrespondenceNode] = [played[0]]
    for node in played[1:]:
        if node.parent_id != walked[-1].id or node.ply != walked[-1].ply + 1:
            raise CorrespondenceError(
                f"game {game_id}: the played nodes are not one path (node {node.id})"
            )
        walked.append(node)
    moves = [node.move_uci for node in walked[1:]]
    if moves != list(game.moves_uci):
        raise CorrespondenceError(
            f"game {game_id}: the played path {moves} is not the game's moves "
            f"{list(game.moves_uci)}"
        )
    return walked


# --- the tree --------------------------------------------------------------


def add_node(session: Session, *, parent_id: int, ucis: Sequence[str] | str) -> dict[str, Any]:
    """Put a move, or a whole line, into the tree under one node.

    This is "send to tree" from the board: one move is a drag, a list of them is the line
    the owner walked or an engine's PV they want to keep. The line is replayed before any of
    it is written, so a line whose fourth move is illegal leaves the first three unwritten,
    and a move already stored under the walked parent is reused rather than duplicated —
    adding a line that is already there creates nothing.
    """
    parent = _node(session, parent_id)
    _row, game = _load(session, parent.game_id)
    _require_open(game, tree=True)

    wanted = [ucis] if isinstance(ucis, str) else [str(uci).strip() for uci in ucis or ()]
    wanted = [uci for uci in wanted if uci]
    if not wanted:
        raise CorrespondenceError("a line needs at least one move in UCI")

    nodes = _nodes(session, parent.game_id)
    board = _board_at(game, parent, nodes)
    steps: list[tuple[str, str, str]] = []
    for uci in wanted:
        try:
            move = board.parse_uci(uci)
        except ValueError as exc:
            raise CorrespondenceError(f"{uci!r} cannot be played here: {exc}") from None
        if not move:
            raise CorrespondenceError(f"{uci!r} is not a move")
        spelled, san = board.uci(move), board.san(move)
        board.push(move)
        steps.append((spelled, san, normalize_fen(board.fen())[0]))

    node = parent
    created = 0
    for uci, san, epd in steps:
        found = _child(session, node, uci)
        if found is None:
            found = _add(session, parent.game_id, node, uci, san, epd)
            created += 1
        node = found
    session.commit()
    _announce(parent.game_id)
    return {
        "game_id": parent.game_id,
        "created": created,
        "tip": _node_payload(node, _start_of(game)),
    }


def update_node(
    session: Session,
    node_id: int,
    *,
    comment: str | None = UNCHANGED,
    mark: str | None = UNCHANGED,
    pinned_engine_id: int | None = UNCHANGED,
    conditional: bool = UNCHANGED,
    promote: bool = False,
) -> dict[str, Any]:
    """Comment on a move, mark it, pin an engine to it, or make it the first of its siblings.

    A mark is the player's word against the engine's and steers the machine as well as the
    eye (`db.enums.CorrespondenceMark`); a pin is which engine's verdict this node reads,
    and no pin is "the deepest one there is". Promoting renumbers the whole sibling set, so
    two moves can never both claim to be first.
    """
    node = _node(session, node_id)
    _row, game = _load(session, node.game_id)
    _require_open(game, tree=True)

    if comment is not UNCHANGED:
        node.comment = (comment or "").strip()
    if mark is not UNCHANGED:
        node.mark = None if mark is None else _mark(mark)
    if pinned_engine_id is not UNCHANGED:
        node.pinned_engine_id = _engine(session, pinned_engine_id)
    if conditional is not UNCHANGED:
        node.conditional = bool(conditional)
    if promote:
        _promote(session, node)
    node.updated_at = utcnow()
    session.commit()
    _announce(node.game_id)
    return _node_payload(node, _start_of(game))


def delete_node(session: Session, node_id: int) -> None:
    """Forget a move and everything the tree holds after it.

    Refused for the root — the game's first position is not a choice — and for a move the
    game has actually played, which is taken back rather than deleted. Refused too while a
    search is queued, running or parked anywhere inside the subtree: a process would go on
    checkpointing into a node that is not there.

    The descendants are collected in Python and deleted by id, the repertoire's rule, and
    the surviving siblings close ranks so the set still has a first move.
    """
    node = _node(session, node_id)
    _row, game = _load(session, node.game_id)
    _require_open(game, tree=True)
    if node.parent_id is None:
        raise CorrespondenceError("the root is the game's first position and cannot be deleted")
    if node.played:
        raise CorrespondenceError(
            "that move is part of the game; take it back with an undo rather than deleting it"
        )

    doomed = _descendants(session, node)
    busy = session.scalars(
        select(CorrespondenceSearch.id).where(
            CorrespondenceSearch.node_id.in_(doomed),
            CorrespondenceSearch.status.in_(LIVE_SEARCH_STATES),
        )
    ).first()
    if busy is not None:
        raise NodeBusyError(
            "a search is still running or parked inside that subtree; stop it first"
        )

    game_id, parent_id = node.game_id, node.parent_id
    session.execute(delete(CorrespondenceSearch).where(CorrespondenceSearch.node_id.in_(doomed)))
    session.execute(delete(CorrespondenceNode).where(CorrespondenceNode.id.in_(doomed)))
    session.flush()
    _renumber(session, game_id, parent_id)
    session.commit()
    _announce(game_id)


def export_pgn(session: Session, game_id: int) -> str:
    """The game with its tree as variations: comments, marks as NAGs, evals as comments.

    What a correspondence player hands to somebody else, or keeps: the played line is the
    mainline, every analysed alternative is a variation under the move it answers, a node's
    comment is a PGN comment and its mark is the NAG the glyph stands for, and each node's
    chosen evaluation goes in as `{[%eval ...]}` in the same spelling Lichess uses — so the
    file opens with the numbers visible in any reader that knows the convention.
    """
    import chess.pgn

    row, game = _load(session, game_id)
    nodes = _nodes(session, game_id)
    evals = _evals_for(session, {node.epd for node in nodes})
    children = _by_parent(nodes)
    root = _root(nodes)

    out = chess.pgn.Game()
    out.headers.update(games_service.pgn_headers(game))
    out.headers["White"] = game.white_name
    out.headers["Black"] = game.black_name
    out.headers["Result"] = str(game.result)
    _write_given(out.headers, row)

    board = games_service.start_board(game)
    _export_children(out, board, root, children, evals)
    exporter = chess.pgn.StringExporter(headers=True, variations=True, comments=True)
    return str(out.accept(exporter))


# --- searches --------------------------------------------------------------


def eligible_engines(session: Session) -> list[Engine]:
    """The engines a search may run on: enabled, UCI, able to drive a board, on this host.

    "Able to drive a board" is `Engine.streams`, the host's own word about whether it
    answers a `stream_open` — a runner that does queue work and no analysis boards says so
    in its `hello`, and offering the owner a search it will never serve is worse than not
    offering it. Maia is excluded by kind: a policy model answers a position rather than a
    search, so there is nothing for it to do for three days.

    Local only, for now: a search on a runner's engine needs the sink refactor that step 4
    of `docs/correspondence.md` brings, so `start_search` refuses one by name.
    """
    return list(
        session.scalars(
            select(Engine)
            .where(
                Engine.enabled.is_(True),
                Engine.kind == EngineKind.UCI,
                Engine.streams.is_(True),
                Engine.runner_id.is_(None),
            )
            .order_by(Engine.id)
        )
    )


def search_engines(session: Session) -> list[Engine]:
    """The engines the picker offers, in the owner's order; the first is its default.

    The setting is a list of ids the owner arranged on the Correspondence page, filtered to
    the ones that are still eligible — an engine deleted or switched off since simply stops
    being offered, and nothing has to be cleaned up when it is. An empty setting is not an
    empty picker: it is an install that has never opened the page, and then every eligible
    engine is offered.
    """
    engines = {engine.id: engine for engine in eligible_engines(session)}
    wanted = app_settings_service.get_correspondence_search_engine_ids(session)
    if not wanted:
        return list(engines.values())
    return [engines[engine_id] for engine_id in wanted if engine_id in engines]


def start_search(
    session: Session,
    *,
    node_id: int,
    engine_id: int,
    multipv: int | None = None,
    limit_depth: int | None = None,
    limit_nodes: int | None = None,
    limit_seconds: int | None = None,
    root_moves: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Put one engine on one node. The row is the request; the worker does the rest.

    Everything that can be refused is refused here, while there is a person to tell: the
    engine has to be one a search can run on, the moves a search is restricted to have to
    be legal in the position, and the node may not already have this engine on it — one
    verdict per engine per position is the whole point of the eval table, and two processes
    writing one row would be two searches paying for each other's depth.

    All three limits left out is a search with no end but the owner's, which is the
    ordinary case: a correspondence search runs until the move is sent.
    """
    node = _node(session, node_id)
    _row, game = _load(session, node.game_id)
    _require_open(game, tree=True)

    engine = _search_engine(session, engine_id)
    live = session.scalars(
        select(CorrespondenceSearch).where(
            CorrespondenceSearch.node_id == node.id,
            CorrespondenceSearch.engine_id == engine.id,
            CorrespondenceSearch.status.in_(LIVE_SEARCH_STATES),
        )
    ).first()
    if live is not None:
        raise SearchBusyError(
            f"{engine.name!r} is already on that position ({live.status}); "
            f"pause or stop that search before starting another"
        )

    row = CorrespondenceSearch(
        node_id=node.id,
        engine_id=engine.id,
        multipv=_multipv(session, multipv),
        kind=SearchKind.SEARCH,
        limit_depth=_limit(limit_depth, "depth"),
        limit_nodes=_limit(limit_nodes, "nodes"),
        limit_seconds=_limit(limit_seconds, "seconds"),
        root_moves=_root_moves(session, node, game, root_moves),
        status=SearchStatus.QUEUED,
    )
    session.add(row)
    session.commit()
    return _announce_search(session, row, {engine.id: engine.name})


def pause_search(session: Session, search_id: int) -> dict[str, Any]:
    """Stop searching but keep what the process holds: the hash is what resuming buys.

    Whether the process really is parked is the worker's answer, which arrives as a second
    event once it has let go of its slot — `warm` on the row is written there and never
    here, because this module is not allowed to know whether a process exists.
    """
    row = _search(session, search_id)
    if row.status is SearchStatus.PAUSED:
        return _search_payload(row, _names_for(session, [row]))
    _require_live(row, "paused")
    row.status = SearchStatus.PAUSED
    row.paused_at = utcnow()
    session.commit()
    return _announce_search(session, row)


def resume_search(session: Session, search_id: int) -> dict[str, Any]:
    """Queue a paused search again. Warm if its process survived, cold if it did not."""
    row = _search(session, search_id)
    if row.status is SearchStatus.QUEUED:
        return _search_payload(row, _names_for(session, [row]))
    if row.status is not SearchStatus.PAUSED:
        raise CorrespondenceError(
            f"that search is {row.status} and cannot be resumed; start a new one"
        )
    _search_engine(session, row.engine_id)
    row.status = SearchStatus.QUEUED
    row.paused_at = None
    row.error = None
    session.commit()
    return _announce_search(session, row)


def stop_search(session: Session, search_id: int) -> dict[str, Any]:
    """End a search for good. A parked process is quit; a running one goes back warm.

    `warm` goes false here rather than when the worker has answered, because it is what the
    page prints about memory this deployment is holding, and a row that still claimed a
    process after the owner stopped it would be a strip the owner cannot act on.
    """
    row = _search(session, search_id)
    if row.status in TERMINAL_SEARCH_STATES:
        return _search_payload(row, _names_for(session, [row]))
    row.status = SearchStatus.STOPPED
    row.warm = False
    row.finished_at = utcnow()
    session.commit()
    return _announce_search(session, row)


def pause_all(session: Session) -> dict[str, Any]:
    """The laptop is closing: every search parks, and the slots go back."""
    rows = _live_searches(session, (SearchStatus.QUEUED, SearchStatus.RUNNING))
    moment = utcnow()
    for row in rows:
        row.status = SearchStatus.PAUSED
        row.paused_at = moment
    session.commit()
    return {"searches": [_announce_search(session, row) for row in rows]}


def resume_all(session: Session) -> dict[str, Any]:
    """Every parked search queued again, warm where its process is still there.

    A search whose engine has been switched off or taken away since it was paused stays
    paused — and says why. Resuming one search raises, and the sentence lands in the
    dialog; a bulk resume has nobody to raise at, so the reason goes on the row and the row
    is announced like any other transition. Without that, a pane would sit at *paused,
    cold* with nothing on it to explain why the button the owner just pressed did nothing
    to it.
    """
    rows = _live_searches(session, (SearchStatus.PAUSED,))
    for row in rows:
        trouble = _engine_trouble(session, row.engine_id)
        if trouble is not None:
            row.error = trouble
            continue
        row.status = SearchStatus.QUEUED
        row.paused_at = None
        row.error = None
    session.commit()
    return {"searches": [_announce_search(session, row) for row in rows]}


def list_searches(
    session: Session,
    *,
    active: bool = True,
    game_id: int | None = None,
    node_id: int | None = None,
) -> dict[str, Any]:
    """The searches, newest first, with the last picture the worker has of each.

    `active` is the queued, running and parked ones — what the "Running now" strip is —
    and everything else is history. The snapshot is merged in from the worker's memory
    rather than from a row: a picture every half second is not a thing to write to SQLite,
    and a page that has just been opened would otherwise show nothing until the next one
    arrives over `/events`.
    """
    statement = select(CorrespondenceSearch, CorrespondenceNode.game_id).join(
        CorrespondenceNode, CorrespondenceNode.id == CorrespondenceSearch.node_id
    )
    if active:
        statement = statement.where(CorrespondenceSearch.status.in_(LIVE_SEARCH_STATES))
    if game_id is not None:
        statement = statement.where(CorrespondenceNode.game_id == int(game_id))
    if node_id is not None:
        statement = statement.where(CorrespondenceSearch.node_id == int(node_id))
    found = list(session.execute(statement.order_by(CorrespondenceSearch.id.desc())).all())
    rows = [row for row, _game_id in found]
    names = _names_for(session, rows)
    searches = []
    for row, owner in found:
        payload = _search_payload(row, names)
        payload["game_id"] = owner
        searches.append(payload)
    return {"searches": searches}


def status(session: Session) -> dict[str, Any]:
    """What the capacity strip shows: slots, what is in them, and what is parked.

    Per host, even though every search is on this one until step 4 puts them on runners —
    the shape is what the strip draws, and a version of it that had to change when runners
    arrive would be a second thing to get right later.
    """
    rows = _live_searches(session, LIVE_SEARCH_STATES)
    names = _names_for(session, rows)
    options = _engine_options(session, rows)
    slots = _running_slots(session)
    running = [row for row in rows if row.status is SearchStatus.RUNNING]
    parked = [row for row in rows if row.status is SearchStatus.PAUSED and row.warm]
    return {
        "slots": slots,
        "in_use": len(running),
        "queued": sum(1 for row in rows if row.status is SearchStatus.QUEUED),
        "paused": sum(1 for row in rows if row.status is SearchStatus.PAUSED),
        "parked": [
            {
                "search_id": row.id,
                "node_id": row.node_id,
                "engine_id": row.engine_id,
                "engine_name": names.get(row.engine_id or -1),
                # What the parked process is actually holding on to, which is the number
                # the owner needs in order to decide it is too much.
                "hash_mb": _hash_mb(options.get(row.engine_id or -1)),
            }
            for row in parked
        ],
        "hosts": [
            {
                "runner_id": None,
                "host": "this host",
                "slots": slots,
                "in_use": len(running),
                "parked": len(parked),
            }
        ],
        # Two lists, because the two readers want different things. The picker wants what
        # the owner chose, in order, with a default; the settings page wants everything a
        # search *could* run on, or choosing one engine would be a one-way door — the
        # picker list is the chosen list, so the page could never offer the engines that
        # were left out, nor name one it holds that has since been switched off.
        "engines": [
            _engine_entry(engine, default=index == 0)
            for index, engine in enumerate(search_engines(session))
        ],
        "eligible_engines": [_engine_entry(engine) for engine in eligible_engines(session)],
    }


def _running_slots(session: Session) -> int:
    """How many searches this process can actually run at once.

    The worker's number, not the setting's: `correspondence_slots` is read once, when the
    pool and the semaphore are sized, so raising it and saving changes what the settings
    page holds and nothing about what the machine will do until a restart — which the page
    says. The strip is the readout the owner acts on ("is there a slot free?"), and one
    reading "2 of 6 in use" with four slots that do not exist would be worse than no strip
    at all. With no worker in this process — a test, the CLI, a read-only deployment — the
    setting is the best answer there is.
    """
    source = _CAPACITY_SOURCE
    if source is not None:
        try:
            running = source().get("slots")
        except Exception:  # pragma: no cover - a reader must never fail a payload
            running = None
        if isinstance(running, int) and running > 0:
            return running
    return app_settings_service.get_correspondence_slots(session)


def _engine_entry(engine: Engine, *, default: bool = False) -> dict[str, Any]:
    """One engine as the picker and the settings page draw it."""
    return {
        "engine_id": engine.id,
        "name": engine.name,
        "version": engine.version,
        "hash_mb": _hash_mb(engine.options),
        "default": default,
    }


# --- searches: what the worker calls ---------------------------------------


def search_context(session: Session, search_id: int) -> dict[str, Any] | None:
    """Everything the worker needs in order to start one search, read off the rows once.

    The worker owns processes and nothing else — no query, no model, no session of its
    own — so this is where a row becomes a position, a pool key and a set of limits. None
    means the row is no longer one to start: it was stopped, or it is already running,
    and the worker simply lets go.

    A search whose engine cannot run it raises, and the worker fails the row with the
    sentence this gives it.
    """
    from backend.services import engines as engines_service

    row = session.get(CorrespondenceSearch, int(search_id))
    if row is None or row.status is not SearchStatus.QUEUED:
        return None
    node = _node(session, row.node_id)
    _row, game = _load(session, node.game_id)
    trouble = _engine_trouble(session, row.engine_id)
    if trouble is not None:
        raise CorrespondenceError(trouble)
    engine = session.get(Engine, row.engine_id)
    board = _board_at(game, node, _nodes(session, node.game_id))
    return {
        "search_id": row.id,
        "node_id": node.id,
        "game_id": node.game_id,
        "engine_id": row.engine_id,
        "engine_name": engine.name if engine else None,
        "spec": engines_service.spec_for(engine),  # type: ignore[arg-type]
        "fen": board.fen(),
        "multipv": row.multipv,
        "root_moves": list(row.root_moves) if row.root_moves else None,
        "limit_depth": row.limit_depth,
        "limit_nodes": row.limit_nodes,
        "limit_seconds": row.limit_seconds,
    }


def search_state(session: Session, search_id: int) -> str | None:
    """The row's status as it stands, or None when the row is gone.

    The one question the worker asks about a row it is not driving: whether a process it is
    holding is still one a resume would want. Spelled apart from `search_context`, which
    answers "not one to start" for a stopped row and a running one alike — and the two
    deserve opposite treatment of the warm process in the worker's hand.
    """
    row = session.get(CorrespondenceSearch, int(search_id))
    return None if row is None else row.status.value


def mark_running(session: Session, search_id: int) -> dict[str, Any] | None:
    """The worker has a process and the search is going. None if the row moved on.

    `started_at` is the start of *this* stretch, not of the search: it is what the page's
    clock counts up from, and a search paused on Monday and resumed on Friday did not spend
    those four days searching. What the engine really spent is accumulated on the eval row
    by `checkpoint`, which is where a total belongs.
    """
    row = session.get(CorrespondenceSearch, int(search_id))
    if row is None or row.status in TERMINAL_SEARCH_STATES:
        return None
    row.status = SearchStatus.RUNNING
    row.warm = False
    row.error = None
    row.started_at = utcnow()
    row.heartbeat_at = utcnow()
    session.commit()
    return _announce_search(session, row)


def mark_parked(session: Session, search_id: int, *, warm: bool) -> dict[str, Any] | None:
    """The search has let go of its slot; `warm` says whether its process is still there.

    A row that has gone back to `queued` while the engine was stopping is left queued: the
    owner pressed Resume in the second it took to park, and writing `paused` over that
    would leave a search nobody restarts. The worker reads the status back and relaunches.
    """
    row = session.get(CorrespondenceSearch, int(search_id))
    if row is None or row.status in TERMINAL_SEARCH_STATES:
        return None
    if row.status is not SearchStatus.QUEUED:
        row.status = SearchStatus.PAUSED
        row.paused_at = row.paused_at or utcnow()
    row.warm = bool(warm)
    session.commit()
    return _announce_search(session, row)


def mark_finished(
    session: Session,
    search_id: int,
    *,
    status: SearchStatus | str = SearchStatus.DONE,
    error: str | None = None,
    stderr: str | None = None,
) -> dict[str, Any] | None:
    """The search is over: it reached its limit, was stopped, or the engine failed.

    A row somebody has already stopped keeps that word — `stopped` is the owner's account
    of why a search ended and `done` is the engine's, and the owner's is the one worth
    keeping when both are true.
    """
    row = session.get(CorrespondenceSearch, int(search_id))
    if row is None:
        return None
    wanted = SearchStatus(status)
    if row.status not in TERMINAL_SEARCH_STATES:
        row.status = wanted
    row.warm = False
    row.finished_at = row.finished_at or utcnow()
    if error:
        row.error = error
    if stderr:
        row.stderr = stderr[-STDERR_LIMIT:]
    session.commit()
    return _announce_search(session, row)


def checkpoint(
    session: Session,
    search_id: int,
    snapshot: dict[str, Any] | None = None,
    *,
    time_delta_ms: int = 0,
    final: bool = False,
) -> dict[str, Any] | None:
    """Write what the engine has reached into the (position, engine) eval row.

    Four rules, and they are the whole of why a three-day search is worth anything:

    * **Forward only.** A picture shallower than what the row already holds changes none of
      its numbers, so a thirty-second task landing on a position this search has settled —
      or the first seconds after a resume, before the process is back at its depth — cannot
      undo it.
    * **Full width only.** A search restricted to a few moves has not judged the position;
      it has judged a shortlist. Its number is the best of the moves it was allowed, which
      is a *lower* bound on the position and usually far below it, and the row it would be
      written into is shared by every node, every game and every transposition that reaches
      this position. Forward-only would then make that number permanent: no later
      full-width search under its depth could correct it. So a restricted search
      checkpoints nothing but its heartbeat; its numbers live on the screen, as
      `correspondence.snapshot`, and end with it.
    * **One history entry per completed depth**, capped: the trajectory is how a player
      judges whether a number has settled, and the last `HISTORY_LIMIT` depths are all of
      it anybody reads.
    * **Time accumulates.** `time_delta_ms` is what this stretch has spent since the last
      checkpoint, so an eval's time is every second every process ever spent on that
      position with that engine, across pauses and restarts.

    `heartbeat_at` is touched whatever the picture said, because a search that is alive and
    has learned nothing new is still alive.
    """
    row = session.get(CorrespondenceSearch, int(search_id))
    if row is None:
        return None
    node = session.get(CorrespondenceNode, row.node_id)
    if node is None:  # pragma: no cover - the foreign key cascades
        return None
    row.heartbeat_at = utcnow()
    if row.root_moves:
        # Nothing written, so nothing for the tree to refetch either: the row's own
        # transition is announced by whoever ended the search.
        session.commit()
        return None

    engine = session.get(Engine, row.engine_id) if row.engine_id else None
    picture = _picture(snapshot)
    stored = session.scalars(
        select(CorrespondenceEval).where(
            CorrespondenceEval.epd == node.epd,
            CorrespondenceEval.engine_id == row.engine_id,
        )
    ).first()
    if stored is None:
        if picture is None:
            # No row for a search that has not said anything yet. A checkmate, a stop
            # inside the first snapshot interval: the engine has judged nothing, and a row
            # written here would be a permanent all-NULL verdict keyed by (position,
            # engine) — a pane with no number on it in every game that ever reaches this
            # position, and an empty answer for `chosen_eval` if the owner pinned it.
            session.commit()
            return None
        stored = CorrespondenceEval(
            epd=node.epd,
            engine_id=row.engine_id,
            engine_name=engine.name if engine else "engine",
            engine_version=engine.version if engine else None,
            history=[],
        )
        session.add(stored)
    if engine is not None:
        # An engine that has been upgraded under a running search: the verdict is the new
        # binary's from here on, and the row says which one wrote it.
        stored.engine_name = engine.name
        stored.engine_version = engine.version
    stored.time_ms = (stored.time_ms or 0) + max(0, int(time_delta_ms))

    if picture is not None and picture["depth"] >= (stored.depth or 0):
        stored.cp = picture["cp"]
        stored.mate = picture["mate"]
        stored.depth = picture["depth"]
        stored.nodes = picture["nodes"]
        stored.best_lines = picture["lines"]
        _append_history(stored, picture)
    stored.updated_at = utcnow()
    session.commit()
    if final:
        # The tree reads the eval table, so the page has to refetch once the search has
        # stopped writing to it. Not on every checkpoint: the live numbers travel as
        # `correspondence.snapshot`, and a tree refetch every few seconds for three days
        # would be the one thing this mode must not cost.
        _announce(node.game_id)
    return _eval_payload(stored, {stored.engine_id or -1: stored.engine_name})


def recover_at_boot(session: Session) -> dict[str, Any]:
    """What a restart makes of the searches the last process was running.

    The tree lost nothing and the rows say what the engines lost: a search whose engine is
    still here is queued again and starts cold at the depth its last checkpoint reached,
    and one whose engine is gone is parked with the reason where the owner will read it.
    `warm` is cleared on every row, because no process survives a restart and a row
    claiming one would have the capacity strip lying about this deployment's memory.
    """
    rows = _live_searches(session, LIVE_SEARCH_STATES)
    relaunch: list[int] = []
    parked: list[int] = []
    for row in rows:
        row.warm = False
        trouble = _engine_trouble(session, row.engine_id)
        if row.status is SearchStatus.PAUSED:
            parked.append(row.id)
            continue
        if trouble is None:
            row.status = SearchStatus.QUEUED
            relaunch.append(row.id)
        else:
            row.status = SearchStatus.PAUSED
            row.paused_at = utcnow()
            row.error = trouble
            parked.append(row.id)
    session.commit()
    for row in rows:
        _announce_search(session, row)
    if relaunch:
        logger.info("correspondence: relaunching %s search(es) after a restart", len(relaunch))
    return {"relaunch": relaunch, "paused": parked}


def register_snapshots(source: Callable[[], dict[int, dict[str, Any]]]) -> None:
    """Let the worker offer its last picture of every search it is running.

    The one thing this module reads that is not a row. A search's numbers change twice a
    second and belong in no database; a page that has just been opened still has to show
    them, so the worker registers a reader and `list_searches` merges what it finds. The
    dependency points the right way — the worker knows the service, not the other way
    round — and with no worker registered (a test, the CLI) every payload simply has no
    snapshot in it.
    """
    global _SNAPSHOT_SOURCE
    _SNAPSHOT_SOURCE = source


def clear_snapshots() -> None:
    global _SNAPSHOT_SOURCE
    _SNAPSHOT_SOURCE = None


def register_capacity(source: Callable[[], dict[str, Any]]) -> None:
    """Let the worker say what it sized itself to, for the capacity strip to read.

    `register_snapshots`' reason again, for a different number: the setting is what the
    owner has asked for and the pool is what this process is running, and between a save
    and a restart those are two different numbers. The strip wants the second one. The
    dependency points the same way — the worker knows the service — and with no worker
    registered `status` falls back to the setting.
    """
    global _CAPACITY_SOURCE
    _CAPACITY_SOURCE = source


def clear_capacity() -> None:
    global _CAPACITY_SOURCE
    _CAPACITY_SOURCE = None


# --- the read model --------------------------------------------------------


def chosen_eval(
    rows: Sequence[CorrespondenceEval], pinned_engine_id: int | None
) -> CorrespondenceEval | None:
    """The verdict a node reads: the pinned engine's, else the deepest there is.

    Deepest rather than newest, because depth is what a correspondence player is buying —
    and between two rows at the same depth the one written last wins, since that is the one
    whose engine has been looking at the position most recently.
    """
    if not rows:
        return None
    if pinned_engine_id is not None:
        pinned = [row for row in rows if row.engine_id == pinned_engine_id]
        if pinned:
            return pinned[0]
    return max(rows, key=lambda row: (row.depth or 0, row.nodes or 0, row.updated_at))


def disagreement(rows: Sequence[CorrespondenceEval]) -> bool:
    """Whether two engines are further apart on this position than `DISAGREEMENT_CP`."""
    scores = [
        _score(row.cp, row.mate) for row in rows if row.cp is not None or row.mate is not None
    ]
    return len(scores) > 1 and max(scores) - min(scores) > DISAGREEMENT_CP


# --- internals: games ------------------------------------------------------


def _store(session: Session, parsed: import_service.ParsedGame, color: Color) -> Game:
    """The parsed game through the ordinary import, with no quick pass and a known side."""
    try:
        outcome = import_service.import_one(session, parsed, analyze=False)
    except Exception as exc:
        raise CorrespondenceError(f"that game could not be stored: {exc}") from None
    if outcome.game is None or not outcome.created:
        raise GameAlreadyStoredError(
            "the library already holds that game; open it rather than adding it again"
        )
    game = outcome.game
    # The owner said which side is theirs, and that outranks whatever the account index
    # made of the names: a correspondence handle need not be an account here at all.
    game.owner_color = color
    game.is_owner_game = True
    session.flush()
    return game


def _new_row(
    session: Session,
    game: Game,
    *,
    event: str | None,
    url: str | None,
    days_per_move: int | None,
    reply_due: datetime | None,
) -> CorrespondenceGame:
    """The live state of a game that is starting, with the deployment's defaults in it."""
    row = CorrespondenceGame(
        game_id=game.id,
        event=_text(event, limit=128),
        url=_text(url, limit=512),
        days_per_move=_days(session, days_per_move),
        reply_due=_moment(reply_due),
    )
    session.add(row)
    session.flush()
    return row


def _seed_tree(session: Session, game: Game, board: Any) -> CorrespondenceNode:
    """The root on the game's first position, and a played node per move it already has."""
    root = CorrespondenceNode(
        game_id=game.id,
        parent_id=None,
        move_uci=None,
        move_san=None,
        epd=normalize_fen(board.fen())[0],
        ply=0,
        rank=0,
        played=True,
    )
    session.add(root)
    session.flush()
    node = root
    for ply, uci in enumerate(game.moves_uci, start=1):
        move = board.parse_uci(uci)
        san = board.san(move)
        board.push(move)
        node = CorrespondenceNode(
            game_id=game.id,
            parent_id=node.id,
            move_uci=uci,
            move_san=san,
            epd=normalize_fen(board.fen())[0],
            ply=ply,
            rank=0,
            played=True,
        )
        session.add(node)
        session.flush()
    return node


def _queue_passes(session: Session, game: Game) -> list[Any]:
    """The quick and the deep pass over a game that has just finished.

    Failures are logged and not raised: the game is over whatever the engine list says, and
    an owner who wants the pass can ask for it from the game page like anyone else.
    """
    queued = []
    for tier in (Tier.QUICK, Tier.DEEP):
        try:
            queued.append(analysis_service.request_analysis(session, game_id=game.id, tier=tier))
        except Exception as exc:
            logger.warning("game %s finished without a %s pass: %s", game.id, tier, exc)
    return queued


def _settle_due(row: CorrespondenceGame, game: Game) -> None:
    """The reply date after the move list changed: a deadline while it is the owner's turn.

    Nothing is due while the opponent is thinking, which is why the other branch clears it
    rather than leaving yesterday's date on the row for the list page to colour red.
    """
    if _owner_to_move(game):
        row.reply_due = utcnow() + timedelta(days=row.days_per_move)
    else:
        row.reply_due = None


def _owner_to_move(game: Game, start: _Start | None = None) -> bool:
    """Whether it is the owner's move: the ply count counted from the game's first position.

    Not the ply count's bare parity, which is only the same thing when the game starts with
    White to move — a game set up from a FEN where Black moves first would have every
    deadline, every turn indicator and every score's point of view inverted for its whole
    length. `start` is passed in where the caller has already worked the board out.
    """
    if game.owner_color is None:
        return False
    where = start if start is not None else _start_of(game)
    turn = Color.WHITE if (game.ply_count + where.offset) % 2 == 0 else Color.BLACK
    return turn == game.owner_color


def _start_of(game: Game) -> _Start:
    """A game's first position, as the two numbers everything else here is counted from."""
    return _start_from(games_service.start_board(game))


def _start_from(board: Any) -> _Start:
    return _Start(0 if board.turn else 1, board.fullmove_number)


def _state_of(game: Game) -> str:
    return STATE_ONGOING if game.result is Result.UNKNOWN else STATE_FINISHED


def _require_open(game: Game, *, tree: bool = False) -> None:
    """Refuse a change to a game that has a result. The tree freezes with the game."""
    if game.result is not Result.UNKNOWN:
        what = "tree" if tree else "game"
        raise TreeLockedError(f"game {game.id} finished as {game.result}; its {what} is read-only")


def _load(session: Session, game_id: int) -> tuple[CorrespondenceGame, Game]:
    row = session.scalars(
        select(CorrespondenceGame).where(CorrespondenceGame.game_id == int(game_id))
    ).first()
    if row is None:
        raise UnknownCorrespondenceGameError(f"no correspondence game with id {game_id}")
    game = session.get(Game, row.game_id)
    if game is None:  # pragma: no cover - the foreign key cascades, so this cannot happen
        raise UnknownCorrespondenceGameError(f"no game with id {game_id}")
    return row, game


# --- internals: the tree ---------------------------------------------------


def _nodes(session: Session, game_id: int) -> list[CorrespondenceNode]:
    """Every node of one game's tree, siblings already in the order they are shown in."""
    return list(
        session.scalars(
            select(CorrespondenceNode)
            .where(CorrespondenceNode.game_id == int(game_id))
            .order_by(CorrespondenceNode.ply, CorrespondenceNode.rank, CorrespondenceNode.id)
        )
    )


def _node(session: Session, node_id: int) -> CorrespondenceNode:
    node = session.get(CorrespondenceNode, int(node_id))
    if node is None:
        raise UnknownNodeError(f"no correspondence node with id {node_id}")
    return node


def _root(nodes: Sequence[CorrespondenceNode]) -> CorrespondenceNode:
    for node in nodes:
        if node.parent_id is None:
            return node
    raise CorrespondenceError("that game's tree has no root")


def _tip(nodes: Sequence[CorrespondenceNode]) -> CorrespondenceNode:
    """The node the game currently stands on: the deepest played one."""
    played = [node for node in nodes if node.played]
    if not played:
        raise CorrespondenceError("that game's tree has no played path")
    return max(played, key=lambda node: node.ply)


def _tips(session: Session, game_ids: Sequence[int]) -> dict[int, CorrespondenceNode]:
    """The node each game stands on, for a listing — one query over the played nodes.

    Ordered by ply so the last row seen per game is the deepest, which is the position the
    list page's evaluation is about.
    """
    found: dict[int, CorrespondenceNode] = {}
    if not game_ids:
        return found
    rows = session.scalars(
        select(CorrespondenceNode)
        .where(
            CorrespondenceNode.game_id.in_(list(game_ids)),
            CorrespondenceNode.played.is_(True),
        )
        .order_by(CorrespondenceNode.game_id, CorrespondenceNode.ply)
    )
    for row in rows:
        found[row.game_id] = row
    return found


def _by_parent(
    nodes: Sequence[CorrespondenceNode],
) -> dict[int | None, list[CorrespondenceNode]]:
    children: dict[int | None, list[CorrespondenceNode]] = {}
    for node in nodes:
        children.setdefault(node.parent_id, []).append(node)
    for siblings in children.values():
        siblings.sort(key=lambda node: (node.rank, node.id))
    return children


def _board_at(game: Game, node: CorrespondenceNode, nodes: Sequence[CorrespondenceNode]) -> Any:
    """The board a node stands on, replayed from the game's first position."""
    by_id = {row.id: row for row in nodes}
    walked: list[CorrespondenceNode] = []
    current: CorrespondenceNode | None = node
    while current is not None:
        walked.append(current)
        current = by_id.get(current.parent_id) if current.parent_id is not None else None
    board = games_service.start_board(game)
    for step in reversed(walked):
        if step.move_uci:
            board.push(board.parse_uci(step.move_uci))
    return board


def _child(session: Session, parent: CorrespondenceNode, uci: str) -> CorrespondenceNode | None:
    return session.scalars(
        select(CorrespondenceNode)
        .where(
            CorrespondenceNode.parent_id == parent.id,
            CorrespondenceNode.move_uci == uci,
        )
        .order_by(CorrespondenceNode.id)
    ).first()


def _add(
    session: Session,
    game_id: int,
    parent: CorrespondenceNode,
    uci: str,
    san: str,
    epd: str,
) -> CorrespondenceNode:
    node = CorrespondenceNode(
        game_id=game_id,
        parent_id=parent.id,
        move_uci=uci,
        move_san=san,
        epd=epd,
        ply=parent.ply + 1,
        rank=_next_rank(session, game_id, parent.id),
        played=False,
    )
    session.add(node)
    session.flush()
    return node


def _siblings(session: Session, game_id: int, parent_id: int | None) -> list[CorrespondenceNode]:
    """One node's sibling set, in the order it is shown in.

    The game is part of the question and not only the parent: a root has no parent, so a
    query that asked for "the nodes with no parent" would answer with every game's root and
    a promote on one game's first position would renumber every other game's.
    """
    return list(
        session.scalars(
            select(CorrespondenceNode)
            .where(
                CorrespondenceNode.game_id == int(game_id),
                CorrespondenceNode.parent_id.is_(None)
                if parent_id is None
                else CorrespondenceNode.parent_id == parent_id,
            )
            .order_by(CorrespondenceNode.rank, CorrespondenceNode.id)
        )
    )


def _next_rank(session: Session, game_id: int, parent_id: int | None) -> int:
    """One past the highest rank in the set, so a new move lands below its siblings."""
    return max((row.rank for row in _siblings(session, game_id, parent_id)), default=-1) + 1


def _promote(session: Session, node: CorrespondenceNode) -> None:
    rest = [row for row in _siblings(session, node.game_id, node.parent_id) if row.id != node.id]
    _apply_ranks([node, *rest])


def _renumber(session: Session, game_id: int, parent_id: int | None) -> None:
    _apply_ranks(_siblings(session, game_id, parent_id))


def _apply_ranks(order: Sequence[CorrespondenceNode]) -> None:
    for rank, row in enumerate(order):
        if row.rank != rank:
            row.rank = rank
            row.updated_at = utcnow()


def _descendants(session: Session, node: CorrespondenceNode) -> list[int]:
    collected = [node.id]
    frontier = [node.id]
    while frontier:
        children = list(
            session.scalars(
                select(CorrespondenceNode.id).where(CorrespondenceNode.parent_id.in_(frontier))
            )
        )
        collected.extend(children)
        frontier = children
    return collected


# --- internals: evaluations and searches -----------------------------------


def _evals_for(session: Session, epds: Iterable[str]) -> dict[str, list[CorrespondenceEval]]:
    """Every engine's verdict on every position in the tree, in one query, keyed by EPD."""
    wanted = sorted({epd for epd in epds if epd})
    found: dict[str, list[CorrespondenceEval]] = {}
    if not wanted:
        return found
    rows = session.scalars(
        select(CorrespondenceEval)
        .where(CorrespondenceEval.epd.in_(wanted))
        .order_by(CorrespondenceEval.engine_name, CorrespondenceEval.id)
    )
    for row in rows:
        found.setdefault(row.epd, []).append(row)
    return found


def _searches_for(
    session: Session, node_ids: Sequence[int]
) -> dict[int, list[CorrespondenceSearch]]:
    found: dict[int, list[CorrespondenceSearch]] = {}
    if not node_ids:
        return found
    rows = session.scalars(
        select(CorrespondenceSearch)
        .where(CorrespondenceSearch.node_id.in_(list(node_ids)))
        .order_by(CorrespondenceSearch.id)
    )
    for row in rows:
        found.setdefault(row.node_id, []).append(row)
    return found


def _engine_names(
    session: Session,
    evals: dict[str, list[CorrespondenceEval]],
    searches: dict[int, list[CorrespondenceSearch]],
) -> dict[int, str]:
    """The name of every engine the payload mentions, in one query.

    An eval row carries its own engine's name so a deleted engine still reads; a search row
    does not, because a search only exists while its engine does.
    """
    ids = {row.engine_id for rows in evals.values() for row in rows if row.engine_id}
    ids |= {row.engine_id for rows in searches.values() for row in rows if row.engine_id}
    if not ids:
        return {}
    return {
        engine.id: engine.name
        for engine in session.scalars(select(Engine).where(Engine.id.in_(sorted(ids))))
    }


def _running(session: Session, game_ids: Sequence[int]) -> dict[int, list[dict[str, Any]]]:
    """The searches that are live right now, per game, for the list page's engine chips."""
    found: dict[int, list[dict[str, Any]]] = {}
    if not game_ids:
        return found
    rows = session.execute(
        select(CorrespondenceSearch, CorrespondenceNode.game_id, Engine.name)
        .join(CorrespondenceNode, CorrespondenceNode.id == CorrespondenceSearch.node_id)
        .join(Engine, Engine.id == CorrespondenceSearch.engine_id, isouter=True)
        .where(
            CorrespondenceNode.game_id.in_(list(game_ids)),
            CorrespondenceSearch.status.in_(LIVE_SEARCH_STATES),
        )
        .order_by(CorrespondenceSearch.id)
    ).all()
    for search, game_id, name in rows:
        names = {} if search.engine_id is None or name is None else {search.engine_id: name}
        found.setdefault(game_id, []).append(_search_payload(search, names))
    return found


# --- internals: searches ---------------------------------------------------


def _search(session: Session, search_id: int) -> CorrespondenceSearch:
    row = session.get(CorrespondenceSearch, int(search_id))
    if row is None:
        raise UnknownSearchError(f"no correspondence search with id {search_id}")
    return row


def _require_live(row: CorrespondenceSearch, verb: str) -> None:
    if row.status in TERMINAL_SEARCH_STATES:
        raise CorrespondenceError(f"that search is {row.status} and cannot be {verb}")


def _live_searches(
    session: Session, statuses: Sequence[SearchStatus]
) -> list[CorrespondenceSearch]:
    """Every infinite search in one of these states. Tasks are the analysis queue's."""
    return list(
        session.scalars(
            select(CorrespondenceSearch)
            .where(
                CorrespondenceSearch.kind == SearchKind.SEARCH,
                CorrespondenceSearch.status.in_(list(statuses)),
            )
            .order_by(CorrespondenceSearch.id)
        )
    )


def _search_engine(session: Session, engine_id: int | None) -> Engine:
    """The engine a search is being started on, or the reason it cannot be."""
    if engine_id is None:
        raise CorrespondenceError("a search needs an engine to run on")
    engine = session.get(Engine, int(engine_id))
    if engine is None:
        raise CorrespondenceError(f"no engine with id {engine_id}")
    trouble = _engine_trouble(session, engine.id, engine=engine)
    if trouble is not None:
        raise CorrespondenceError(trouble)
    return engine


def _engine_trouble(
    session: Session, engine_id: int | None, *, engine: Engine | None = None
) -> str | None:
    """Why this engine cannot run a search here, phrased for somebody who has to act on it.

    None means it can. Every caller that starts or relaunches a search asks this and
    nothing else, so "which engines a search may run on" is decided once — and a runner's
    engine is refused by name rather than silently, because the answer for it is "not yet":
    step 4 of `docs/correspondence.md` is what puts searches on other hosts.
    """
    from backend.services import engines as engines_service

    if engine is None:
        if engine_id is None:
            return "that search has no engine any more"
        engine = session.get(Engine, int(engine_id))
    if engine is None:
        return f"the engine that search was started on (id {engine_id}) is gone"
    if engine.runner_id is not None:
        host = engines_service.engine_host(session, engine)
        return (
            f"{engine.name!r} lives on {host}, and correspondence searches run on this host "
            f"only for now; give this deployment an engine of its own to search with"
        )
    if not engine.enabled:
        return f"{engine.name!r} is switched off"
    if engine.kind is not EngineKind.UCI:
        return f"{engine.name!r} is a human-move model, and a search needs a UCI engine"
    if not engine.streams:
        return f"{engine.name!r} does not drive a board, so it cannot run a search"
    if not engines_service.binary_present(engine.path):
        return f"the binary for {engine.name!r} is no longer at {engine.path}"
    return None


def _names_for(session: Session, rows: Sequence[CorrespondenceSearch]) -> dict[int, str]:
    ids = sorted({row.engine_id for row in rows if row.engine_id})
    if not ids:
        return {}
    return {
        engine.id: engine.name
        for engine in session.scalars(select(Engine).where(Engine.id.in_(ids)))
    }


def _engine_options(
    session: Session, rows: Sequence[CorrespondenceSearch]
) -> dict[int, dict[str, Any]]:
    ids = sorted({row.engine_id for row in rows if row.engine_id})
    if not ids:
        return {}
    return {
        engine.id: engine.options or {}
        for engine in session.scalars(select(Engine).where(Engine.id.in_(ids)))
    }


def _hash_mb(options: dict[str, Any] | None) -> int | None:
    """What one parked process is holding, as its `Hash` option says. None if it does not."""
    value = (options or {}).get("Hash")
    if isinstance(value, bool) or not isinstance(value, int | float | str):
        return None
    try:
        return int(float(value))
    except ValueError:
        return None


def _multipv(session: Session, value: int | None) -> int:
    """How many lines this search keeps: what was asked for, or the deployment's default."""
    if value is None:
        return app_settings_service.get_correspondence_multipv(session)
    setting = app_settings_service.BY_KEY[app_settings_service.CORRESPONDENCE_MULTIPV]
    return int(setting.clamp(int(value)))


def _limit(value: int | None, what: str) -> int | None:
    """One of a search's three stopping points. None is "no limit of this kind"."""
    if value is None:
        return None
    number = int(value)
    if number <= 0:
        raise CorrespondenceError(f"a limit of {number} {what} is not a limit; leave it out")
    return number


def _root_moves(
    session: Session, node: CorrespondenceNode, game: Game, ucis: Sequence[str] | None
) -> list[str] | None:
    """`searchmoves`, checked against the node's own board and spelled as the engine takes them.

    Checked here rather than by the driver because this is where there is somebody to tell:
    a search restricted to a move that is not legal in the position would start, find
    nothing to search and end as a failure three seconds later.
    """
    wanted = [str(uci).strip() for uci in ucis or ()]
    wanted = [uci for uci in wanted if uci]
    if not wanted:
        return None
    board = _board_at(game, node, _nodes(session, node.game_id))
    spelled: list[str] = []
    for uci in wanted:
        try:
            move = board.parse_uci(uci)
        except ValueError as exc:
            raise CorrespondenceError(f"{uci!r} cannot be searched here: {exc}") from None
        if board.uci(move) not in spelled:
            spelled.append(board.uci(move))
    return spelled


def _picture(snapshot: dict[str, Any] | None) -> dict[str, Any] | None:
    """One snapshot as the numbers an eval row holds, or None if it said nothing yet.

    A search's first pictures carry a depth and no line, and a terminal position carries
    nothing at all; neither is a verdict, and writing one would give the tree a node with a
    depth and no evaluation.
    """
    if not snapshot:
        return None
    lines = [dict(entry) for entry in snapshot.get("lines") or ()]
    if not lines:
        return None
    first = min(lines, key=lambda entry: entry.get("multipv") or 1)
    if first.get("cp") is None and first.get("mate") is None:
        return None
    depth = snapshot.get("depth")
    nodes = snapshot.get("nodes")
    return {
        "depth": int(depth) if isinstance(depth, int) else 0,
        "nodes": int(nodes) if isinstance(nodes, int) else None,
        "cp": first.get("cp"),
        "mate": first.get("mate"),
        "lines": lines,
        "best": (first.get("pv") or [None])[0],
    }


def _append_history(stored: CorrespondenceEval, picture: dict[str, Any]) -> None:
    """One entry per completed depth *and* per stretch of nodes, the last `HISTORY_LIMIT`.

    A depth reached again — the same search after a resume, or a second engine pass —
    replaces its entry rather than adding a second one, so the trajectory a player reads is
    one line per depth for an engine whose depth is what moves. An engine whose depth means
    little and whose node count means everything is the case the second key exists for: a
    Leela at depth 19 for a day would otherwise leave one point behind and no trajectory at
    all, which is exactly the readout a correspondence player uses to tell a settled number
    from a moving one.
    """
    entry = {
        "depth": picture["depth"],
        "nodes": picture["nodes"],
        "cp": picture["cp"],
        "mate": picture["mate"],
        "best": picture["best"],
    }
    history = [dict(item) for item in stored.history or []]
    if history and _same_history_point(history[-1], entry):
        history[-1] = entry
    else:
        history.append(entry)
    stored.history = history[-HISTORY_LIMIT:]


def _same_history_point(last: dict[str, Any], entry: dict[str, Any]) -> bool:
    """Whether this picture is the last one again rather than a point of its own.

    The same depth with materially more nodes behind it is a new point; the same depth a
    second later is the same one, written over. An engine that reports no node count at all
    keys on its depth alone, which is what the history did before Leela was thought about.
    """
    if last.get("depth") != entry.get("depth"):
        return False
    nodes, before = entry.get("nodes"), last.get("nodes")
    if not isinstance(nodes, int) or not isinstance(before, int) or before <= 0:
        return True
    return nodes < before * HISTORY_NODE_GROWTH


def _announce_search(
    session: Session, row: CorrespondenceSearch, names: dict[int, str] | None = None
) -> dict[str, Any]:
    """Say that a search moved, and answer with the row the caller asked about.

    One event per transition, with everything a surface needs to place it — which game,
    which node, which engine — so that neither the page nor the worker has to go and look
    the row up before it can act.
    """
    node = session.get(CorrespondenceNode, row.node_id)
    game_id = node.game_id if node is not None else None
    payload = _search_payload(row, names if names is not None else _names_for(session, [row]))
    payload["game_id"] = game_id
    events_service.emit(
        {
            "event": EVENT_SEARCH,
            "search_id": row.id,
            "node_id": row.node_id,
            "game_id": game_id,
            "engine_id": row.engine_id,
            "status": str(row.status),
            "warm": bool(row.warm),
        }
    )
    return payload


def _snapshot_of(search_id: int) -> dict[str, Any] | None:
    """The worker's last picture of this search, if a worker is running in this process."""
    source = _SNAPSHOT_SOURCE
    if source is None:
        return None
    try:
        return source().get(int(search_id))
    except Exception:  # pragma: no cover - a reader must never fail a payload
        return None


# --- internals: payloads ---------------------------------------------------


def _game_payload(
    row: CorrespondenceGame, game: Game, tip: dict[str, Any] | None
) -> dict[str, Any]:
    """The game half of every answer: what it is, whose move it is, when it is due.

    The board is built once and read three times — whose move it is, what number that move
    has and the FEN the client starts its own replay from — because all three are questions
    about the game's first position and answering them from ply parity instead would be
    wrong for every game that does not start from the ordinary array.
    """
    board = games_service.start_board(game)
    start = _start_from(board)
    return {
        "game_id": game.id,
        "white": game.white_name,
        "black": game.black_name,
        "white_rating": game.white_rating,
        "black_rating": game.black_rating,
        "owner_color": str(game.owner_color) if game.owner_color else None,
        "source": str(game.source),
        "source_id": game.source_id,
        "event": row.event,
        "url": row.url,
        "time_control": game.time_control,
        "result": str(game.result),
        "termination": game.termination,
        "state": _state_of(game),
        "finished": game.result is not Result.UNKNOWN,
        "ply_count": game.ply_count,
        "move_number": start.move_number + (game.ply_count + start.offset) // 2,
        "to_move": "white" if (game.ply_count + start.offset) % 2 == 0 else "black",
        "your_move": _owner_to_move(game, start) and game.result is Result.UNKNOWN,
        "moves_uci": list(game.moves_uci),
        "moves_san": list(game.moves_san),
        "last_move_san": game.moves_san[-1] if game.moves_san else None,
        "start_fen": board.fen(),
        "days_per_move": row.days_per_move,
        "reply_due": _stamp(row.reply_due),
        "days_left": _days_left(row.reply_due),
        "last_move_at": _stamp(row.last_move_at),
        "created_at": _stamp(row.created_at),
        "updated_at": _stamp(row.updated_at),
        # The verdict on the position the game actually stands in, which is the number the
        # list page shows and the header repeats — not the tree's root, which is the
        # starting position and says nothing.
        #
        # In White's frame, unlike the tree's own numbers: this one is printed on its own,
        # in a column of games with no move beside it to say whose point of view it is. The
        # tip's frame is the side that played last, which is the opponent in every game
        # waiting on the owner — so a node-framed number would mean opposite things for two
        # rows under one heading, and would flip sign on the same game every time the
        # opponent replied.
        "root_eval": _as_white((tip or {}).get("own"), _tip_frame(tip)),
        "root_backed": _as_white((tip or {}).get("backed"), _tip_frame(tip)),
        "current_node_id": (tip or {}).get("id"),
    }


def _game_row(
    row: CorrespondenceGame,
    game: Game,
    tip: CorrespondenceNode | None,
    evals: dict[str, list[CorrespondenceEval]],
    running: list[dict[str, Any]],
) -> dict[str, Any]:
    """One line of the list page: the game, its verdict and what is searching right now."""
    rows = evals.get(tip.epd, []) if tip is not None else []
    chosen = chosen_eval(rows, tip.pinned_engine_id if tip is not None else None)
    frame = _frame_of(tip) if tip is not None else Color.WHITE
    payload = _game_payload(
        row,
        game,
        {
            "id": tip.id if tip else None,
            "frame": str(frame),
            "own": _score_payload(chosen, frame),
            "backed": None,
        },
    )
    payload["searches"] = running
    return payload


def _node_payload(node: CorrespondenceNode, start: _Start) -> dict[str, Any]:
    """One node on its own: everything about it that does not need the rest of the tree.

    What a create or a patch answers with. The tree payload adds the numbers that are
    computed over a subtree — `own`, `backed`, the evals, the searches and the flags — and
    the children. `start` is the game's first position, which is what the move number is
    counted from.
    """
    mark = node.mark
    return {
        "id": node.id,
        "game_id": node.game_id,
        "parent_id": node.parent_id,
        "uci": node.move_uci,
        "san": node.move_san,
        "epd": node.epd,
        "ply": node.ply,
        "rank": node.rank,
        "played": node.played,
        "conditional": node.conditional,
        "mark": str(mark) if mark else None,
        "glyph": MARK_GLYPHS[mark] if mark else None,
        "comment": node.comment or "",
        "pinned_engine_id": node.pinned_engine_id,
        "move_number": _move_number(node, start),
        "created_at": _stamp(node.created_at),
        "updated_at": _stamp(node.updated_at),
    }


def _eval_payload(row: CorrespondenceEval, names: dict[int, str]) -> dict[str, Any]:
    """One engine's verdict on one position, exactly as it is stored.

    Side to move's point of view, the way `MoveEval` stores a score — the node's own
    numbers are turned into the mover's frame in `own` and `backed`, and this is the raw
    row an engine pane draws.
    """
    return {
        "engine_id": row.engine_id,
        "engine_name": names.get(row.engine_id or -1) or row.engine_name,
        "engine_version": row.engine_version,
        "cp": row.cp,
        "mate": row.mate,
        "depth": row.depth,
        "nodes": row.nodes,
        "time_ms": row.time_ms,
        "best_lines": row.best_lines,
        "history": row.history or [],
        "tablebase": row.tablebase,
        "updated_at": _stamp(row.updated_at),
    }


def _search_payload(row: CorrespondenceSearch, names: dict[int, str]) -> dict[str, Any]:
    """One search row, with the worker's last picture of it where there is one.

    The snapshot is the live half and the row is the durable half, in one object, because
    an engine pane draws both at once and has no way to join them itself: a search that has
    been running for an hour is a row that says so and a picture that says where it has
    got to.
    """
    return {
        "id": row.id,
        "node_id": row.node_id,
        "engine_id": row.engine_id,
        "engine_name": names.get(row.engine_id or -1),
        "kind": str(row.kind),
        "status": str(row.status),
        "warm": row.warm,
        "multipv": row.multipv,
        "run_id": row.run_id,
        "runner_id": row.runner_id,
        "limit_depth": row.limit_depth,
        "limit_nodes": row.limit_nodes,
        "limit_seconds": row.limit_seconds,
        "root_moves": row.root_moves,
        "created_at": _stamp(row.created_at),
        "started_at": _stamp(row.started_at),
        "paused_at": _stamp(row.paused_at),
        "finished_at": _stamp(row.finished_at),
        "heartbeat_at": _stamp(row.heartbeat_at),
        "error": row.error,
        "stderr": row.stderr,
        "snapshot": _snapshot_of(row.id),
    }


def _assemble(
    game: Game,
    nodes: Sequence[CorrespondenceNode],
    evals: dict[str, list[CorrespondenceEval]],
    searches: dict[int, list[CorrespondenceSearch]],
    names: dict[int, str],
) -> tuple[dict[str, Any] | None, dict[int, dict[str, Any]]]:
    """The whole tree as nested payloads, with the two numbers and the draw flags on each.

    One depth-first walk with a board that is pushed and popped, which is what makes the
    flags cheap: repetition is a count of the positions on the path, the fifty-move counter
    and a dead position are the board's own answers, and the FEN a client needs is the
    board it is standing on. The minimax comes back up the same walk — a node's backed value
    is over its children's values, each of which is that child's own backed value where it
    has one — computed in White's frame and handed out in the frame of the node.
    """
    if not nodes:
        return None, {}
    children = _by_parent(nodes)
    root = _root(nodes)
    board = games_service.start_board(game)
    start = _start_from(board)
    seen: dict[str, int] = {}
    payloads: dict[int, dict[str, Any]] = {}

    def walk(node: CorrespondenceNode) -> tuple[dict[str, Any], Value]:
        """One node and the value its parent should minimax over, in White's frame."""
        seen[node.epd] = seen.get(node.epd, 0) + 1
        rows = evals.get(node.epd, [])
        chosen = chosen_eval(rows, node.pinned_engine_id)
        own_white = _white_frame(chosen, board.turn)

        kids: list[dict[str, Any]] = []
        values: list[tuple[int | None, int | None]] = []
        for child in children.get(node.id, []):
            move = board.parse_uci(child.move_uci or "0000")
            board.push(move)
            payload, value = walk(child)
            board.pop()
            kids.append(payload)
            if value is not None:
                values.append(value)

        backed_white = _minimax(values, board.turn) if values else None
        frame = _frame_of(node)
        payload = _node_payload(node, start)
        payload.update(
            {
                "fen": board.fen(),
                "turn": "white" if board.turn else "black",
                "frame": str(frame),
                "own": _score_payload(chosen, frame),
                "backed": _framed(backed_white, frame),
                # Which engine `own` came from: the pinned one where there is a pin, the
                # deepest otherwise. The pane that is showing the number has to be able to
                # say whose it is, and working it out a second time in the client is how
                # the two would come to disagree.
                "chosen_engine_id": chosen.engine_id if chosen is not None else None,
                "evals": [_eval_payload(row, names) for row in rows],
                "searches": [_search_payload(row, names) for row in searches.get(node.id, [])],
                "disagree": disagreement(rows),
                "flags": _flags(board, seen[node.epd]),
                "children": kids,
            }
        )
        payloads[node.id] = payload
        seen[node.epd] -= 1
        return payload, (backed_white if backed_white is not None else own_white)

    tree, _value = walk(root)
    return tree, payloads


def _flags(board: Any, repetitions: int) -> dict[str, Any]:
    """What the path to this node makes true about the position, computed rather than stored."""
    return {
        "repetition": repetitions,
        "threefold": repetitions >= 3,
        "halfmove_clock": board.halfmove_clock,
        "fifty_move": board.halfmove_clock >= 100,
        "dead_position": board.is_insufficient_material(),
        "checkmate": board.is_checkmate(),
        "stalemate": board.is_stalemate(),
    }


def _frame_of(node: CorrespondenceNode) -> Color:
    """Whose point of view a node's `own` and `backed` numbers are from.

    The side that played the move into the node: `15.Bd3 +0.41` means White is better,
    which is what a tree is read as. The root is the one node with no move, and its numbers
    are from the side to move there instead — the position somebody is deciding in, read the
    way a board is.

    Read off the node's own position rather than off its ply's parity, because parity only
    agrees with the mover in a game that started with White to move: the EPD says who is to
    move *after* the move, and the mover is the other one.
    """
    to_move = Color.WHITE if node.epd.split(" ")[1] == "w" else Color.BLACK
    if node.move_uci is None:
        return to_move
    return Color.BLACK if to_move is Color.WHITE else Color.WHITE


def _move_number(node: CorrespondenceNode, start: _Start) -> int:
    """The number the move into this node is written with, counted from the game's start.

    A game entered from a mid-game FEN numbers its moves the way that position does, and one
    whose first position has Black to move gives that move the same number as the White move
    it answers — neither of which falls out of the ply alone.
    """
    if node.ply <= 0:
        return start.move_number
    return start.move_number + (node.ply - 1 + start.offset) // 2


def _white_frame(row: CorrespondenceEval | None, white_to_move: bool) -> Value:
    """A stored verdict as White's: the frame a minimax is taken in, and the one PGN uses."""
    if row is None or (row.cp is None and row.mate is None):
        return None
    if white_to_move:
        return row.cp, row.mate
    return (None if row.cp is None else -row.cp, None if row.mate is None else -row.mate)


def _minimax(
    values: Sequence[tuple[int | None, int | None]], white_to_move: bool
) -> tuple[int | None, int | None]:
    """The value the side to move would choose, out of the children that have one."""
    pick = max if white_to_move else min
    return pick(values, key=lambda value: _score(*value))


def _framed(value: tuple[int | None, int | None] | None, frame: Color) -> dict[str, Any] | None:
    """A White-frame value as the payload's `{cp, mate}` in the frame the node reads in."""
    if value is None:
        return None
    cp, mate = value
    if frame is Color.BLACK:
        cp = None if cp is None else -cp
        mate = None if mate is None else -mate
    return {"cp": cp, "mate": mate}


def _tip_frame(tip: dict[str, Any] | None) -> Color:
    """Whose point of view the tip payload's numbers are from, defaulting to White's."""
    return Color.BLACK if (tip or {}).get("frame") == str(Color.BLACK) else Color.WHITE


def _as_white(score: dict[str, Any] | None, frame: Color) -> dict[str, Any] | None:
    """One payload score, given in `frame`, read as White's.

    A node's numbers are in the frame of the side that played the move into it, which is how
    a variation is read. A game's number stands alone in a list and is read the way a board
    is, so it is turned once here rather than being explained in a column header.
    """
    if score is None or frame is Color.WHITE:
        return score
    turned = dict(score)
    for key in ("cp", "mate"):
        value = turned.get(key)
        if value is not None:
            turned[key] = -value
    return turned


def _score_payload(row: CorrespondenceEval | None, frame: Color) -> dict[str, Any] | None:
    """A node's chosen verdict in its own frame, with what earned it."""
    if row is None or (row.cp is None and row.mate is None):
        return None
    stored_frame = Color.WHITE if row.epd.split(" ")[1] == "w" else Color.BLACK
    flip = stored_frame != frame
    return {
        "cp": None if row.cp is None else (-row.cp if flip else row.cp),
        "mate": None if row.mate is None else (-row.mate if flip else row.mate),
        "depth": row.depth,
        "nodes": row.nodes,
        "engine_id": row.engine_id,
        "engine_name": row.engine_name,
        "updated_at": _stamp(row.updated_at),
    }


def _score(cp: int | None, mate: int | None) -> int:
    """One comparable number, so a mate and a centipawn score can be ordered together."""
    if mate is not None:
        return MATE_SCORE - mate if mate > 0 else -MATE_SCORE - mate
    return cp or 0


# --- internals: PGN --------------------------------------------------------


def _export_children(
    node: Any,
    board: Any,
    row: CorrespondenceNode,
    children: dict[int | None, list[CorrespondenceNode]],
    evals: dict[str, list[CorrespondenceEval]],
) -> None:
    """Write one node's children under it: the played one first, the rest as variations."""
    ordered = sorted(
        children.get(row.id, []), key=lambda child: (not child.played, child.rank, child.id)
    )
    for child in ordered:
        move = board.parse_uci(child.move_uci or "0000")
        variation = node.add_variation(move)
        if child.mark:
            variation.nags.add(MARK_NAGS[child.mark])
        variation.comment = _export_comment(child, evals)
        board.push(move)
        _export_children(variation, board, child, children, evals)
        board.pop()


def _export_comment(row: CorrespondenceNode, evals: dict[str, list[CorrespondenceEval]]) -> str:
    """A node's comment for the export: the owner's words, and the engine's number.

    `{[%eval ...]}` in the spelling readers already know — and that spelling is **White's**
    point of view, on Lichess as in ChessBase and SCID, whatever the side to move is. The
    rows store the mover's frame, as `MoveEval` does, so every verdict with Black to move is
    negated on the way out; a file that did not would read as the opposite verdict in every
    reader that knows the convention, which is the only reason to write the tag at all.
    """
    parts: list[str] = []
    chosen = chosen_eval(evals.get(row.epd, []), row.pinned_engine_id)
    white = _white_frame(chosen, row.epd.split(" ")[1] == "w")
    if white is not None:
        cp, mate = white
        if mate is not None:
            parts.append(f"[%eval #{mate}]")
        elif cp is not None:
            parts.append(f"[%eval {cp / 100:.2f}]")
    if row.comment:
        parts.append(row.comment)
    return " ".join(parts)


# --- internals: small conversions ------------------------------------------


def _names(white: str, black: str) -> tuple[str, str]:
    first, second = (white or "").strip(), (black or "").strip()
    if not first or not second:
        raise CorrespondenceError("a game needs both players' names")
    return first[:128], second[:128]


def _color(value: Color | str) -> Color:
    """The owner's side, which a correspondence game may not be without.

    Every other game learns whose it is from the account index; this one is created by the
    owner in a dialog, and half of what the mode does — whose move it is, when the reply is
    due, which way the tree reads — is that colour.
    """
    try:
        return Color(value)
    except ValueError:
        raise CorrespondenceError(
            f"{value!r} is not a colour; a correspondence game needs white or black"
        ) from None


def _mark(value: str) -> CorrespondenceMark:
    try:
        return CorrespondenceMark(value)
    except ValueError:
        allowed = ", ".join(str(mark) for mark in CorrespondenceMark)
        raise CorrespondenceError(f"{value!r} is not a mark; try one of {allowed}") from None


def _engine(session: Session, engine_id: int | None) -> int | None:
    """A pin, checked to be an engine that exists. None unpins."""
    if engine_id is None:
        return None
    if session.get(Engine, int(engine_id)) is None:
        raise CorrespondenceError(f"no engine with id {engine_id} to pin")
    return int(engine_id)


def _days(session: Session, days: int | None) -> int:
    """The reply window a game is created with, pulled inside what a window can be."""
    if days is None:
        return app_settings_service.get_correspondence_days_per_move(session)
    setting = app_settings_service.BY_KEY[app_settings_service.CORRESPONDENCE_DAYS_PER_MOVE]
    return int(setting.clamp(int(days)))


def _state(value: str | None) -> str | None:
    if value is None:
        return None
    wanted = str(value).strip().casefold()
    if wanted not in STATES:
        raise CorrespondenceError(f"{value!r} is not a state; try {' or '.join(STATES)}")
    return wanted


def _start_board(fen: str | None) -> Any:
    import chess

    if not fen:
        return chess.Board()
    try:
        return chess.Board(fen)
    except ValueError as exc:
        raise CorrespondenceError(f"{fen!r} is not a position: {exc}") from None


def _fresh_pgn(
    *,
    white: str,
    black: str,
    event: str | None,
    url: str | None,
    time_control: str | None,
    played_at: datetime,
    start_fen: str | None,
    white_rating: int | None,
    black_rating: int | None,
) -> str:
    """The PGN of a game with no moves yet: its headers, and a result of `*`."""
    import chess.pgn

    game = chess.pgn.Game()
    game.headers["Event"] = event or "Correspondence game"
    game.headers["Site"] = url or "?"
    game.headers["Date"] = played_at.strftime("%Y.%m.%d")
    game.headers["Round"] = "-"
    game.headers["White"] = white
    game.headers["Black"] = black
    game.headers["Result"] = str(Result.UNKNOWN)
    if white_rating is not None:
        game.headers["WhiteElo"] = str(white_rating)
    if black_rating is not None:
        game.headers["BlackElo"] = str(black_rating)
    if time_control:
        game.headers["TimeControl"] = time_control
    if start_fen:
        game.headers["SetUp"] = "1"
        game.headers["FEN"] = start_fen
    exporter = chess.pgn.StringExporter(headers=True, variations=False, comments=False)
    return str(game.accept(exporter))


def _with_given(pgn: str, row: CorrespondenceGame) -> str:
    """The rebuilt PGN with the game's event and link written back into it.

    Cleared as well as set. `rebuild_pgn` keeps the headers the stored PGN already had, so a
    tournament name the owner has just deleted would be copied back out of yesterday's PGN
    and would sit in every export for good. The row is the authority on both headers, and
    `?` is what PGN writes where nobody filled one in.
    """
    import chess.pgn

    read = chess.pgn.read_game(io.StringIO(pgn))
    if read is None:  # pragma: no cover - it was written by python-chess a line ago
        return pgn
    _write_given(read.headers, row)
    exporter = chess.pgn.StringExporter(headers=True, variations=False, comments=False)
    return str(read.accept(exporter))


def _write_given(headers: Any, row: CorrespondenceGame) -> None:
    """The row's event and link onto a set of PGN headers, emptied where the row is empty."""
    headers["Event"] = row.event or "?"
    headers["Site"] = row.url or "?"


def _given(value: str | None) -> str | None:
    """One PGN header, or nothing: `?` is python-chess's word for a header nobody filled in.

    Used for the `Site` a game links to and for the player names, which is the same
    question in both places — did the file actually say, or is this the default.
    """
    text = (value or "").strip()
    return None if not text or text == "?" else text[:512]


def _text(value: str | None, *, limit: int) -> str | None:
    text = (value or "").strip()
    return text[:limit] if text else None


def _moment(value: datetime | None) -> datetime | None:
    """A caller's timestamp as an aware UTC one; a naive one is read as UTC."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _stamp(value: datetime | None) -> str | None:
    return None if value is None else _moment(value).isoformat()


def _days_left(due: datetime | None) -> float | None:
    """Days until the reply is due, negative once it is late. The list page colours it."""
    if due is None:
        return None
    return round((_moment(due) - utcnow()).total_seconds() / 86400, 2)


def _list_order(row: dict[str, Any]) -> tuple[Any, ...]:
    """Your move first and soonest due at the top, then the opponent's, then the finished."""
    if row["state"] == STATE_FINISHED:
        section = 2
    elif row["your_move"]:
        section = 0
    else:
        section = 1
    due = row["days_left"]
    return (section, due if due is not None else 10**6, -row["game_id"])


def _announce(game_id: int) -> None:
    """Tell every surface the game moved; the page refetches the tree.

    One event for every change here, deliberately: the tree, the move list, the deadlines
    and the marks are one document as far as a reader is concerned, and a client that had
    to work out which of eight events meant "refetch" would eventually get it wrong.
    """
    events_service.emit({"event": EVENT_UPDATED, "game_id": int(game_id)})

"""Lichess import adapter: full-archive NDJSON export, `since` cursor, rate-limit aware.

Ported from the predecessor and re-reviewed. What came over unchanged is the shape of the
export call — the streaming ndjson endpoint, its parameters, and the "wait a full minute"
answer to a 429. What changed is everything the predecessor did for a coach that only
looked at a window of blitz games: the retry is a bounded loop instead of unbounded
recursion, the stream is parsed lazily instead of buffered and sorted, nothing is filtered
out by default because a database wants the whole archive, and the games come back oldest
first so that a cursor only ever moves forward over games that were actually stored.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Collection, Iterable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from itertools import chain
from typing import TYPE_CHECKING, Any

import chess
import chess.pgn
import httpx

from backend.adapters import is_full_archive
from backend.db.enums import Platform, Result, Source, Speed
from backend.services import accounts
from backend.services.import_service import (
    CHESS960_VARIANTS,
    AccountIndex,
    ImportFailure,
    ImportResult,
    ParsedGame,
    ProgressHook,
    account_cursor,
    ingest_games,
    latest_unfinished,
)

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from backend.db.models import ImportJob

GAMES_API = "https://lichess.org/api/games/user/{player}"
# Named games by their IDs, in the same ndjson shape as the account export; up to 300 a call.
GAMES_BY_ID_API = "https://lichess.org/api/games/export/_ids"
MAX_IDS_PER_CALL = 300
USER_AGENT = "Blunderbase/0.1"
HEADERS = {"accept": "application/x-ndjson", "user-agent": USER_AGENT}
TIMEOUT = httpx.Timeout(connect=10.0, read=120.0, write=120.0, pool=120.0)

# Lichess asks for a full minute after a 429, whatever `Retry-After` says; the ceiling is
# only there so that a nonsense header cannot park a worker for a day.
MIN_RETRY_SECONDS = 60.0
MAX_RETRY_SECONDS = 300.0
MAX_ATTEMPTS = 3

# What the pipeline can replay. Everything else is recorded as a per-game failure, so a
# crazyhouse game shows up in the import history instead of vanishing silently.
SUPPORTED_VARIANTS = frozenset({"standard", "from position"}) | CHESS960_VARIANTS
VARIANT_NAMES = {"fromposition": "from position"}

# Lichess's own perf names. `ultraBullet` has no room of its own in the schema and is
# bullet for every purpose Blunderbase has.
SPEEDS: dict[str, Speed] = {speed.value: speed for speed in Speed} | {"ultrabullet": Speed.BULLET}

DRAWN_STATUSES = frozenset({"draw", "stalemate"})
# What the export calls a game that is still being played: a correspondence game that has
# not ended, or a live one caught mid-game.
RUNNING_STATUSES = frozenset({"created", "started"})


class LichessError(RuntimeError):
    """The export could not be read. Recorded as the job's failure message."""


class UnknownPlayerError(LichessError):
    """Lichess has no such user."""


class RateLimitedError(LichessError):
    """Lichess kept answering 429 after the retries were spent."""


@dataclass(slots=True)
class Cursor:
    """Where the next sync starts: the newest `createdAt` this one settled.

    `ingest_games` advances it, not the stream. It moves over every game that got an
    answer — stored, already known, or refused for what it contained, so a crazyhouse game
    is reported once rather than on every sync — and stops at the first game the database
    was too busy to take, because a stamp past that game would never ask for it again and
    only a `since=all` resync would ever find it missing. It never moves backwards, and an
    empty sync hands back the stamp it started from, so the newest job always carries the
    newest cursor.

    It is not held back by a game still being played. The export filters on `createdAt`,
    so a correspondence game begun before a blitz game that is stored, and finished after
    it, sits behind a stamp that has moved past the blitz game. Holding the stamp at such a
    game would have every sync re-read weeks of blitz for as long as it runs; `Unfinished`
    remembers it by ID instead.
    """

    latest: int = 0

    def settled(self, item: ParsedGame | ImportFailure) -> None:
        """Move over one item the storing side has answered for."""
        marker = item.cursor
        if marker and marker.isdigit():
            self.latest = max(self.latest, int(marker))

    @property
    def value(self) -> str | None:
        return str(self.latest) if self.latest else None


@dataclass(slots=True)
class Unfinished:
    """The games the next sync asks for by ID, because the cursor may already be past them.

    Every game an export listed as still being played goes in `running` — the export is
    asked for running games too, and they are never stored, because a stored game with no
    result is one that dedup then keeps from ever being completed. The next sync fetches
    them by ID (`/api/games/export/_ids`), stores those that have ended, and hands the rest
    on again; a sync that starts from a cursor also asks for the account's running games on
    their own, however old, so one begun before the cursor is found even when nothing
    remembered it.

    A game fetched by ID leaves the list once the storing side has answered for it, the way
    the cursor moves: one the database was too busy to take (or a filtered sync passed
    over) is `returned` without being `answered`, and is asked for again next time. A game
    Lichess no longer returns at all — an aborted game it deleted — simply drops out.
    """

    running: set[str] = field(default_factory=set)
    returned: set[str] = field(default_factory=set)
    answered: set[str] = field(default_factory=set)

    def settled(self, item: ParsedGame | ImportFailure) -> None:
        if isinstance(item, ParsedGame):
            self.answered.add(item.source_id)
        elif item.ref.startswith(f"{Source.LICHESS}:"):
            self.answered.add(item.ref.split(":", 1)[1])

    @property
    def value(self) -> list[str]:
        return sorted(self.running | (self.returned - self.answered))


def run(
    session: Session,
    job: ImportJob,
    *,
    username: str | None = None,
    since: str | int | None = None,
    max_games: int | None = None,
    speeds: Collection[str] | None = None,
    rated: bool | None = None,
    token: str | None = None,
    progress: ProgressHook | None = None,
    analyze: bool = True,
    client: httpx.Client | None = None,
    sleep: Callable[[float], None] = time.sleep,
    game_ids: Collection[str] | None = None,
    **options: Any,
) -> ImportResult:
    """Sync one Lichess account: everything played since the last successful sync.

    `since` overrides the stored cursor — a millisecond stamp, an ISO date or datetime, or
    `all` to walk the whole archive again. Nothing is filtered out unless the caller asks
    for it with `speeds` or `rated`, because a database wants every game. `analyze=False`
    lands the games without queueing the automatic analysis pass.

    `game_ids` names games known to have just finished — the live import's `gameFinish`
    frames. They join the games the last sync left `Unfinished`: whichever of them the
    export did not carry is fetched by its ID after it, in the same job, and none of those
    moves the cursor.
    """
    player = (username or "").strip()
    if not player:
        raise ValueError("a lichess import needs the username whose games to sync")

    job.message = player
    # An account the owner already has is this job's from the start, so a sync that fails
    # before Lichess answers — an outage, a rate limit, a closed account — is still a sync
    # of it, and the schedule retries it on its interval rather than on every tick.
    known = accounts.find_account(session, Platform.LICHESS, player)
    if known is not None and known.is_owner:
        job.account_id = known.id
        session.commit()
    remembered = (
        latest_unfinished(session, Source.LICHESS, job.account_id)
        if job.account_id is not None
        else None
    )
    since_ms = resolve_since(session, player, since)
    cursor = Cursor(since_ms or 0)
    unfinished = Unfinished()
    owned = client is None
    http = client if client is not None else httpx.Client(timeout=TIMEOUT, headers=HEADERS)
    try:
        lines = fetch_lines(
            http,
            player,
            since_ms=since_ms,
            max_games=max_games,
            speeds=speeds,
            rated=rated,
            token=token,
            sleep=sleep,
        )
        # The request goes out here, before a new account is written: a mistyped name is a
        # 404 and has to fail the job without leaving an account behind that the schedule
        # would sync for ever. Any other answer says Lichess has such a player.
        try:
            first = next(lines, None)
        except UnknownPlayerError:
            accounts.forget_unconfirmed(session, Platform.LICHESS, player)
            raise
        # The account a sync was asked for is the owner's, and it has to exist before the
        # first game is stored: `owner_color` is read off the accounts as they are on the
        # way in, and a game stored without one is a game with no side of its own.
        job.account_id = accounts.register_account(session, Platform.LICHESS, player).id
        index = AccountIndex.load(session)

        exported: set[str] = set()
        streamed = chain([first] if first is not None else [], lines)
        games = chain(
            parse_stream(streamed, speeds=speeds, running=unfinished.running.add, seen=exported),
            _behind_the_cursor(
                http,
                player,
                [*(remembered or ()), *(game_ids or ())],
                exported,
                unfinished,
                # A walk of the whole archive, unfiltered and uncapped, has listed every
                # running game already; anything narrower has not.
                list_running=(
                    since_ms is not None
                    or bool(speeds)
                    or rated is not None
                    or max_games is not None
                ),
                speeds=speeds,
                token=token,
                sleep=sleep,
            ),
        )

        def settled(item: ParsedGame | ImportFailure) -> None:
            cursor.settled(item)
            unfinished.settled(item)

        result = ingest_games(
            session,
            job,
            games,
            progress=progress,
            accounts=index,
            analyze=analyze,
            settled=settled,
            sleep=sleep,
        )
    finally:
        if owned:
            http.close()
    # A filtered sync saw only part of what the account played, so its newest `createdAt`
    # is not a stamp anything may resume from: a later unfiltered sync starting there
    # would skip every game this one filtered out, permanently. Only a sync that asked
    # for the whole archive moves the account's cursor.
    result.cursor = None if (speeds or rated is not None) else cursor.value
    # Its unfinished list is whole all the same: the running games are listed unfiltered,
    # and a remembered game it filtered out is handed on unanswered.
    result.unfinished = unfinished.value
    return result


def fetch_lines(
    client: httpx.Client,
    player: str,
    *,
    since_ms: int | None = None,
    max_games: int | None = None,
    speeds: Collection[str] | None = None,
    rated: bool | None = None,
    token: str | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> Iterator[str]:
    """The export stream, one non-empty ndjson line at a time.

    Oldest game first: the caller's cursor then only ever names games it has already been
    handed, so stopping early — a `max_games` cap, a dropped connection — costs a later
    sync nothing. A 429 is retried after the delay Lichess asks for; once the first line
    has been read there is no retry, because half a stream cannot be replayed.

    Running games are asked for as well (`ongoing`). They are not stored — `parse_stream`
    passes them over — but they are remembered (`Unfinished`), because a long game that
    finishes after a newer one is behind the cursor by then and this export never lists it
    again.
    """
    params: dict[str, Any] = {
        "moves": "true",
        "clocks": "true",
        "opening": "true",
        "sort": "dateAsc",
        "ongoing": "true",
    }
    if since_ms is not None:
        params["since"] = since_ms
    if max_games is not None:
        params["max"] = max_games
    if speeds:
        params["perfType"] = ",".join(sorted(speeds))
    if rated is not None:
        params["rated"] = "true" if rated else "false"

    missing = UnknownPlayerError(f"lichess has no player called {player!r}")
    yield from _lines(
        client,
        "GET",
        GAMES_API.format(player=player),
        params=params,
        token=token,
        sleep=sleep,
        not_found=missing,
    )


def fetch_running(
    client: httpx.Client,
    player: str,
    *,
    token: str | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> Iterator[str]:
    """Only the games the account is still playing, however long ago they began.

    `finished=false` drops every played-out game and there is no `since`, so this is a
    short answer even for a large archive: a correspondence player's open games.
    """
    params = {"moves": "false", "ongoing": "true", "finished": "false"}
    missing = UnknownPlayerError(f"lichess has no player called {player!r}")
    yield from _lines(
        client,
        "GET",
        GAMES_API.format(player=player),
        params=params,
        token=token,
        sleep=sleep,
        not_found=missing,
    )


def fetch_games_by_id(
    client: httpx.Client,
    game_ids: Collection[str],
    *,
    token: str | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> Iterator[str]:
    """Named games in the export's own ndjson shape, however old they are.

    What a sync asks for when a game it remembered running, or one the live import saw
    end, may have finished: the account export filters on when a game began, and a game
    that began before the stored cursor is not in it.
    """
    ids = list(dict.fromkeys(game_id.strip() for game_id in game_ids if game_id.strip()))
    params = {"moves": "true", "clocks": "true", "opening": "true"}
    for offset in range(0, len(ids), MAX_IDS_PER_CALL):
        batch = ids[offset : offset + MAX_IDS_PER_CALL]
        yield from _lines(
            client,
            "POST",
            GAMES_BY_ID_API,
            params=params,
            content=",".join(batch),
            token=token,
            sleep=sleep,
        )


def _lines(
    client: httpx.Client,
    method: str,
    url: str,
    *,
    params: dict[str, Any],
    content: str | None = None,
    token: str | None = None,
    sleep: Callable[[float], None] = time.sleep,
    not_found: LichessError | None = None,
) -> Iterator[str]:
    """One streamed ndjson request, retried while Lichess answers 429."""
    headers = dict(HEADERS)
    if token:
        headers["authorization"] = f"Bearer {token}"
    if content is not None:
        headers["content-type"] = "text/plain"
    for attempt in range(1, MAX_ATTEMPTS + 1):
        with client.stream(
            method, url, params=params, headers=headers, content=content
        ) as response:
            if response.status_code == httpx.codes.TOO_MANY_REQUESTS:
                response.read()
                if attempt == MAX_ATTEMPTS:
                    raise RateLimitedError(
                        f"lichess is rate limiting this import; gave up after {attempt} attempts"
                    )
                sleep(retry_delay(response.headers))
                continue
            if response.status_code == httpx.codes.NOT_FOUND and not_found is not None:
                response.read()
                raise not_found
            if response.status_code >= httpx.codes.BAD_REQUEST:
                response.read()
                response.raise_for_status()
            for raw in response.iter_lines():
                line = raw.strip()
                if line:
                    yield line
            return


def retry_delay(headers: httpx.Headers) -> float:
    """How long to wait after a 429: what Lichess asked for, never less than a minute."""
    try:
        seconds = float(headers.get("retry-after", ""))
    except (TypeError, ValueError):
        seconds = MIN_RETRY_SECONDS
    return min(MAX_RETRY_SECONDS, max(MIN_RETRY_SECONDS, seconds))


def parse_stream(
    lines: Iterable[str],
    *,
    speeds: Collection[str] | None = None,
    running: Callable[[str], None] | None = None,
    seen: set[str] | None = None,
) -> Iterator[ParsedGame | ImportFailure]:
    """Every game an export stream holds; one `ImportFailure` per game that could not be read.

    A line that is not JSON is a line, not the end of the stream: the export is one object
    per line and the next one is unaffected.

    Every item carries the `createdAt` it was exported under as its cursor. That is a stamp
    the storing side may resume past *once it has settled this game*, and not before, which
    is why it travels with the game instead of being written into a cursor here.

    A game still being played is not yielded at all: storing it would store a game with no
    result that dedup then keeps from ever being completed. Its ID goes to `running`
    instead, for a later sync to ask for by ID. `seen` collects the ID of every played-out
    game the stream named.
    """
    for index, line in enumerate(lines, start=1):
        try:
            payload = json.loads(line)
        except ValueError as exc:
            yield ImportFailure(ref=f"line {index}", error=f"{type(exc).__name__}: {exc}")
            continue
        if not isinstance(payload, dict) or not payload.get("id"):
            yield ImportFailure(ref=f"line {index}", error="not a lichess game object")
            continue

        marker = _marker(payload)
        ref = f"{Source.LICHESS}:{payload['id']}"
        if payload.get("status") in RUNNING_STATUSES:
            if running is not None:
                running(str(payload["id"]))
            continue
        if seen is not None:
            seen.add(str(payload["id"]))
        if speeds and payload.get("speed") not in speeds:
            continue
        variant = _variant(payload)
        if variant not in SUPPORTED_VARIANTS:
            yield ImportFailure(ref=ref, error=f"unsupported variant {variant!r}", cursor=marker)
            continue
        try:
            yield parse_game(payload, variant=variant)
        except Exception as exc:
            yield ImportFailure(ref=ref, error=f"{type(exc).__name__}: {exc}", cursor=marker)


def _behind_the_cursor(
    client: httpx.Client,
    player: str,
    game_ids: Collection[str],
    exported: set[str],
    unfinished: Unfinished,
    *,
    list_running: bool,
    speeds: Collection[str] | None,
    token: str | None,
    sleep: Callable[[float], None],
) -> Iterator[ParsedGame | ImportFailure]:
    """The games the cursor may already be past: remembered running, or just seen to end.

    Read lazily, after the export: only then is it known which of them the export already
    handed over, and which it listed as still running. The account's running games are
    listed on their own first (`fetch_running`) when the export may not have reached them
    all, which is also how a game begun before the cursor is found with nothing having
    remembered it. What is left is fetched by ID; a game that turns out to be running still
    goes back into `unfinished`. None of them moves the cursor — a game fetched this way
    can sit anywhere in the account's history, and the cursor is a statement about
    everything before it.
    """
    if list_running:
        # Only the listing matters: a finished game in this answer is the export's to store.
        for _ in parse_stream(
            fetch_running(client, player, token=token, sleep=sleep),
            running=unfinished.running.add,
        ):
            pass
    wanted = [
        game_id
        for game_id in dict.fromkeys(game_ids)
        if game_id not in exported and game_id not in unfinished.running
    ]
    if not wanted:
        return
    fetched = fetch_games_by_id(client, wanted, token=token, sleep=sleep)
    for item in parse_stream(
        fetched, speeds=speeds, running=unfinished.running.add, seen=unfinished.returned
    ):
        item.cursor = None
        yield item


def parse_game(payload: dict[str, Any], *, variant: str | None = None) -> ParsedGame:
    """One export record as the pipeline wants it, PGN included.

    The PGN is written here rather than asked for with `pgnInJson`, so that a game's stored
    text always exists and always says the same thing as its parsed move list.
    """
    variant = variant if variant is not None else _variant(payload)
    initial_fen = payload.get("initialFen")
    chess960 = variant in CHESS960_VARIANTS
    if initial_fen:
        board = chess.Board(initial_fen, chess960=chess960)
    else:
        board = chess.Board(chess960=chess960)
    board.chess960 = board.chess960 or board.has_chess960_castling_rights()
    start = board.copy()

    tokens = str(payload.get("moves") or "").split()
    if not tokens:
        raise ValueError("the game ended before a move was played")
    moves: list[chess.Move] = []
    moves_uci: list[str] = []
    moves_san: list[str] = []
    for token in tokens:
        move = board.parse_san(token)
        moves.append(move)
        moves_san.append(board.san(move))
        # `Board.uci` and not `Move.uci`: castling is held king-takes-rook internally, and
        # only the board knows whether this game wants that spelling or `e1g1`.
        moves_uci.append(board.uci(move))
        board.push(move)

    clock = payload.get("clock") or {}
    initial_clock = _number(clock.get("initial"))
    increment = _number(clock.get("increment"))
    clocks = _clocks(payload.get("clocks"), len(moves))
    opening = payload.get("opening") or {}
    white_name, white_rating, white_diff = _player(payload, "white")
    black_name, black_rating, black_diff = _player(payload, "black")
    speed = SPEEDS.get(str(payload.get("speed") or "").casefold())
    rated = payload.get("rated") if isinstance(payload.get("rated"), bool) else None
    result = _result(payload)
    played_at = _played_at(payload)
    time_control = f"{initial_clock}+{increment or 0}" if initial_clock is not None else None

    return ParsedGame(
        source=Source.LICHESS,
        source_id=str(payload["id"]),
        white_name=white_name,
        black_name=black_name,
        white_rating=white_rating,
        black_rating=black_rating,
        result=result,
        termination=payload.get("status"),
        variant=variant,
        rated=rated,
        speed=speed,
        time_control=time_control,
        initial_clock=initial_clock,
        increment=increment,
        eco=opening.get("eco"),
        opening_name=opening.get("name"),
        played_at=played_at,
        pgn=build_pgn(
            payload,
            start,
            moves,
            clocks,
            white_name=white_name,
            black_name=black_name,
            white_rating=white_rating,
            black_rating=black_rating,
            white_diff=white_diff,
            black_diff=black_diff,
            result=result,
            speed=speed,
            rated=rated,
            time_control=time_control,
            played_at=played_at,
            opening=opening,
        ),
        moves_uci=moves_uci,
        moves_san=moves_san,
        clocks=clocks,
        initial_fen=initial_fen,
        cursor=_marker(payload),
    )


def build_pgn(
    payload: dict[str, Any],
    start: chess.Board,
    moves: list[chess.Move],
    clocks: list[float | None] | None,
    *,
    white_name: str,
    black_name: str,
    white_rating: int | None,
    black_rating: int | None,
    white_diff: int | None = None,
    black_diff: int | None = None,
    result: Result,
    speed: Speed | None,
    rated: bool | None,
    time_control: str | None,
    played_at: datetime | None,
    opening: dict[str, Any],
) -> str:
    """The game as a PGN file, spelled the way Lichess spells its own exports.

    The Event line matters beyond decoration: it is where the speed and the rated flag live
    in a PGN, so re-importing this text through the PGN adapter reads back the same game.
    The same goes for the ratings: `white_rating` is the rating after the game, and a PGN
    spells that as the Elo before it plus a `WhiteRatingDiff`, which is how Lichess writes
    it and how the PGN adapter adds it back up.
    """
    game = chess.pgn.Game()
    game.setup(start)
    game.headers["Event"] = _event(speed, rated)
    game.headers["Site"] = f"https://lichess.org/{payload['id']}"
    game.headers["White"] = white_name
    game.headers["Black"] = black_name
    game.headers["Result"] = str(result)
    if played_at is not None:
        game.headers["Date"] = played_at.strftime("%Y.%m.%d")
        game.headers["UTCDate"] = played_at.strftime("%Y.%m.%d")
        game.headers["UTCTime"] = played_at.strftime("%H:%M:%S")
    for tag, value in (
        ("WhiteElo", white_rating - white_diff if white_diff is not None else white_rating),
        ("BlackElo", black_rating - black_diff if black_diff is not None else black_rating),
        ("WhiteRatingDiff", white_diff),
        ("BlackRatingDiff", black_diff),
        ("TimeControl", time_control),
        ("ECO", opening.get("eco")),
        ("Opening", opening.get("name")),
        ("Termination", payload.get("status")),
    ):
        if value is not None:
            game.headers[tag] = str(value)

    node: chess.pgn.GameNode = game
    for index, move in enumerate(moves):
        node = node.add_main_variation(move)
        seconds = clocks[index] if clocks is not None else None
        if seconds is not None:
            node.set_clock(seconds)
    exporter = chess.pgn.StringExporter(headers=True, variations=True, comments=True)
    return game.accept(exporter)


def resolve_since(session: Session, player: str, since: str | int | None = None) -> int | None:
    """The `since` stamp this sync starts from: what the caller asked for, else the cursor."""
    if since is not None:
        return parse_since(since)
    stored = stored_cursor(session, player)
    return int(stored) if stored and stored.isdigit() else None


def parse_since(value: str | int | datetime) -> int | None:
    """A millisecond stamp, an ISO date or datetime, or `all` for the whole archive."""
    if isinstance(value, datetime):
        moment = value
    else:
        text = str(value).strip()
        # `--since all`, or an empty value: ignore the stored cursor and walk the archive.
        if is_full_archive(text):
            return None
        if text.isdigit():
            return int(text)
        try:
            moment = datetime.fromisoformat(text)
        except ValueError:
            raise ValueError(
                f"cannot read {value!r} as a lichess cursor: "
                "expected a millisecond stamp, an ISO date, or 'all'"
            ) from None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return int(moment.timestamp() * 1000)


def stored_cursor(session: Session, player: str) -> str | None:
    """The cursor of the last finished sync of this account.

    Scoped by account and not only by source: two Lichess accounts in one database have
    two archives, and resuming one from the other's stamp would silently skip everything
    before it. A sync job names its account, however long ago the account last synced.
    """
    return account_cursor(session, Source.LICHESS, player)


def _player(payload: dict[str, Any], color: str) -> tuple[str, int | None, int | None]:
    """Who played this side, their rating as the game left it, and what the game did to it.

    Lichess's `rating` is the rating the player brought to the game; `ratingDiff` is what
    the game did to it (absent for a casual game, a bot, or a game still running). The
    rating stored is the sum — the rating after the game — because that is what chess.com
    reports, and the progress chart draws both sources on one line. An anonymous opponent
    and a bot both still need a name.
    """
    entry = (payload.get("players") or {}).get(color) or {}
    name = str((entry.get("user") or {}).get("name") or "").strip()
    if not name:
        level = entry.get("aiLevel")
        name = f"lichess AI level {level}" if level is not None else "Anonymous"
    rating = _number(entry.get("rating"))
    diff = _number(entry.get("ratingDiff")) if rating is not None else None
    return name, rating + diff if rating is not None and diff is not None else rating, diff


def _result(payload: dict[str, Any]) -> Result:
    winner = payload.get("winner")
    if winner == "white":
        return Result.WHITE_WIN
    if winner == "black":
        return Result.BLACK_WIN
    if payload.get("status") in DRAWN_STATUSES:
        return Result.DRAW
    return Result.UNKNOWN


def _variant(payload: dict[str, Any]) -> str:
    name = str(payload.get("variant") or "standard").strip().casefold()
    return VARIANT_NAMES.get(name, name) or "standard"


def _clocks(raw: Any, ply_count: int) -> list[float | None] | None:
    """Lichess counts what is left on the clock in centiseconds, one entry per ply."""
    if not isinstance(raw, list) or not raw:
        return None
    clocks: list[float | None] = [
        round(value / 100, 2) if isinstance(value, int | float) else None
        for value in raw[:ply_count]
    ]
    clocks.extend([None] * (ply_count - len(clocks)))
    return clocks if any(seconds is not None for seconds in clocks) else None


def _marker(payload: dict[str, Any]) -> str | None:
    """This game's place in the export: the stamp a later sync's `since` would name."""
    stamp = _created_at(payload)
    return str(stamp) if stamp else None


def _created_at(payload: dict[str, Any]) -> int | None:
    stamp = payload.get("createdAt") or payload.get("lastMoveAt")
    return stamp if isinstance(stamp, int) else None


def _played_at(payload: dict[str, Any]) -> datetime | None:
    """When the game started, which is the date its PGN export carries too."""
    stamp = _created_at(payload)
    if not stamp:
        return None
    return datetime.fromtimestamp(stamp / 1000, tz=UTC)


def _event(speed: Speed | None, rated: bool | None) -> str:
    name = speed.value.capitalize() if speed is not None else "Chess"
    if rated is None:
        return f"{name} game"
    return f"{'Rated' if rated else 'Casual'} {name} game"


def _number(value: Any) -> int | None:
    return int(value) if isinstance(value, int | float) and not isinstance(value, bool) else None

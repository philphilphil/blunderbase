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
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

import chess
import chess.pgn
import httpx

from backend.adapters import is_full_archive
from backend.db.enums import JobStatus, Platform, Result, Source, Speed
from backend.services import accounts
from backend.services.import_service import (
    CHESS960_VARIANTS,
    AccountIndex,
    ImportFailure,
    ImportResult,
    ParsedGame,
    ProgressHook,
    ingest_games,
    list_jobs,
)

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from backend.db.models import ImportJob

GAMES_API = "https://lichess.org/api/games/user/{player}"
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

# How far back the cursor lookup reads. A sync writes one job, so this is "the last two
# hundred syncs of any source", which is far more than a resume ever needs.
CURSOR_LOOKBACK = 200



class LichessError(RuntimeError):
    """The export could not be read. Recorded as the job's failure message."""


class UnknownPlayerError(LichessError):
    """Lichess has no such user."""


class RateLimitedError(LichessError):
    """Lichess kept answering 429 after the retries were spent."""


@dataclass(slots=True)
class Cursor:
    """Where the next sync starts: the newest `createdAt` this one was handed.

    It advances over every game the stream produced, imported or not, so a game that
    cannot be stored is reported once rather than on every sync. It never moves backwards,
    and an empty sync hands back the stamp it started from, so the newest job always
    carries the newest cursor.
    """

    latest: int = 0

    def observe(self, created_at: int | None) -> None:
        if created_at:
            self.latest = max(self.latest, created_at)

    @property
    def value(self) -> str | None:
        return str(self.latest) if self.latest else None


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
    **options: Any,
) -> ImportResult:
    """Sync one Lichess account: everything played since the last successful sync.

    `since` overrides the stored cursor — a millisecond stamp, an ISO date or datetime, or
    `all` to walk the whole archive again. Nothing is filtered out unless the caller asks
    for it with `speeds` or `rated`, because a database wants every game. `analyze=False`
    lands the games without queueing the automatic quick pass.
    """
    player = (username or "").strip()
    if not player:
        raise ValueError("a lichess import needs the username whose games to sync")

    job.message = player
    # The account a sync was asked for is the owner's, and it has to exist before the
    # first game is stored: `owner_color` is read off the accounts as they are on the way
    # in, and a game stored without one is a game with no side of its own.
    job.account_id = accounts.register_account(session, Platform.LICHESS, player).id
    index = AccountIndex.load(session)

    since_ms = resolve_since(session, player, since)
    cursor = Cursor(since_ms or 0)
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
        games = parse_stream(lines, cursor=cursor, speeds=speeds)
        result = ingest_games(
            session, job, games, progress=progress, accounts=index, analyze=analyze
        )
    finally:
        if owned:
            http.close()
    # A filtered sync saw only part of what the account played, so its newest `createdAt`
    # is not a stamp anything may resume from: a later unfiltered sync starting there
    # would skip every game this one filtered out, permanently. Only a sync that asked
    # for the whole archive moves the account's cursor.
    result.cursor = None if (speeds or rated is not None) else cursor.value
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
    """
    params: dict[str, Any] = {
        "moves": "true",
        "clocks": "true",
        "opening": "true",
        "sort": "dateAsc",
    }
    if since_ms is not None:
        params["since"] = since_ms
    if max_games is not None:
        params["max"] = max_games
    if speeds:
        params["perfType"] = ",".join(sorted(speeds))
    if rated is not None:
        params["rated"] = "true" if rated else "false"
    headers = dict(HEADERS)
    if token:
        headers["authorization"] = f"Bearer {token}"

    url = GAMES_API.format(player=player)
    for attempt in range(1, MAX_ATTEMPTS + 1):
        with client.stream("GET", url, params=params, headers=headers) as response:
            if response.status_code == httpx.codes.TOO_MANY_REQUESTS:
                response.read()
                if attempt == MAX_ATTEMPTS:
                    raise RateLimitedError(
                        f"lichess is rate limiting this import; gave up after {attempt} attempts"
                    )
                sleep(retry_delay(response.headers))
                continue
            if response.status_code == httpx.codes.NOT_FOUND:
                response.read()
                raise UnknownPlayerError(f"lichess has no player called {player!r}")
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
    cursor: Cursor | None = None,
    speeds: Collection[str] | None = None,
) -> Iterator[ParsedGame | ImportFailure]:
    """Every game an export stream holds; one `ImportFailure` per game that could not be read.

    A line that is not JSON is a line, not the end of the stream: the export is one object
    per line and the next one is unaffected.
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

        if cursor is not None:
            cursor.observe(_created_at(payload))
        ref = f"{Source.LICHESS}:{payload['id']}"
        if speeds and payload.get("speed") not in speeds:
            continue
        variant = _variant(payload)
        if variant not in SUPPORTED_VARIANTS:
            yield ImportFailure(ref=ref, error=f"unsupported variant {variant!r}")
            continue
        try:
            yield parse_game(payload, variant=variant)
        except Exception as exc:
            yield ImportFailure(ref=ref, error=f"{type(exc).__name__}: {exc}")


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
    white_name, white_rating = _player(payload, "white")
    black_name, black_rating = _player(payload, "black")
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
        ("WhiteElo", white_rating),
        ("BlackElo", black_rating),
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

    Scoped by account name and not only by source: two Lichess accounts in one database
    have two archives, and resuming one from the other's stamp would silently skip
    everything before it. The name lives in the job's message, which is where this adapter
    puts it on the way in.
    """
    key = player.strip().casefold()
    for job in list_jobs(session, Source.LICHESS, limit=CURSOR_LOOKBACK):
        if (
            job.status == JobStatus.DONE
            and job.cursor
            and (job.message or "").strip().casefold() == key
        ):
            return job.cursor
    return None


def _player(payload: dict[str, Any], color: str) -> tuple[str, int | None]:
    """Who played this side. An anonymous opponent and a bot both still need a name."""
    entry = (payload.get("players") or {}).get(color) or {}
    name = str((entry.get("user") or {}).get("name") or "").strip()
    if not name:
        level = entry.get("aiLevel")
        name = f"lichess AI level {level}" if level is not None else "Anonymous"
    return name, _number(entry.get("rating"))


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

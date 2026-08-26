"""PGN import adapter: multi-game files from the UI or the CLI.

A PGN file is a stream of games and one of them being wrong says nothing about the rest,
so every game is parsed on its own and a broken one comes back as an `ImportFailure`
rather than as an exception.
"""

from __future__ import annotations

import io
import re
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, TextIO

import chess
import chess.pgn

from backend.db.enums import Result, Source, Speed
from backend.services.import_service import (
    CHESS960_VARIANTS,
    ImportFailure,
    ImportResult,
    ParsedGame,
    ProgressHook,
    ingest_games,
)

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from backend.db.models import ImportJob

SUPPORTED_VARIANTS = frozenset({"standard", "from position"}) | CHESS960_VARIANTS

# Lichess spells its speed in the Event header ("Rated Blitz game"); everyone else leaves
# it to be derived from the clock.
SPEED_WORDS = {speed.value: speed for speed in Speed}

# Lichess's own boundaries on the estimated duration of a game, in seconds.
SPEED_BOUNDS: tuple[tuple[int, Speed], ...] = (
    (179, Speed.BULLET),
    (479, Speed.BLITZ),
    (1499, Speed.RAPID),
)

CLOCK_PATTERN = re.compile(r"^(\d+)\+(\d+)$")
LICHESS_ID = re.compile(r"lichess\.org/(\w{8})")
CHESSCOM_ID = re.compile(r"chess\.com/game/(?:live|daily)/(\d+)")


def run(
    session: Session,
    job: ImportJob,
    *,
    path: str | None = None,
    text: str | None = None,
    max_games: int | None = None,
    progress: ProgressHook | None = None,
    **options: Any,
) -> ImportResult:
    """Read one PGN file (or one uploaded blob) and hand every game to the pipeline."""
    if text is not None:
        return ingest_games(
            session, job, parse_stream(io.StringIO(text), limit=max_games), progress=progress
        )
    if not path:
        raise ValueError("a pgn import needs either a file path or the file's text")
    file = Path(path).expanduser()
    if not file.is_file():
        raise FileNotFoundError(f"no such PGN file: {file}")
    job.message = str(file)
    with file.open("r", encoding="utf-8-sig", errors="replace") as stream:
        return ingest_games(session, job, parse_stream(stream, limit=max_games), progress=progress)


def parse_file(
    path: str | Path, *, limit: int | None = None
) -> Iterator[ParsedGame | ImportFailure]:
    """Every game in a PGN file, in order. Reads the file lazily."""
    with Path(path).expanduser().open("r", encoding="utf-8-sig", errors="replace") as stream:
        yield from parse_stream(stream, limit=limit)


def parse_stream(
    stream: TextIO, *, limit: int | None = None
) -> Iterator[ParsedGame | ImportFailure]:
    """Every game a stream holds, one `ImportFailure` per game that could not be read."""
    index = 0
    while limit is None or index < limit:
        try:
            game = chess.pgn.read_game(stream)
        except Exception as exc:
            # The reader normally recovers on its own; if it did not, the file's remaining
            # offset means nothing and continuing would loop on the same bytes.
            yield ImportFailure(ref=f"game {index + 1}", error=f"{type(exc).__name__}: {exc}")
            return
        if game is None:
            return
        index += 1
        ref = reference(game.headers, index)
        if game.errors:
            yield ImportFailure(ref=ref, error="; ".join(str(error) for error in game.errors))
            continue
        variant = _variant(game.headers)
        if variant not in SUPPORTED_VARIANTS:
            yield ImportFailure(ref=ref, error=f"unsupported variant {variant!r}")
            continue
        try:
            yield parse_game(game, ref=ref, variant=variant)
        except Exception as exc:
            yield ImportFailure(ref=ref, error=f"{type(exc).__name__}: {exc}")


def parse_game(
    game: chess.pgn.Game, *, ref: str | None = None, variant: str | None = None
) -> ParsedGame:
    """One python-chess game as the pipeline wants it."""
    headers = game.headers
    board = game.board()

    moves_uci: list[str] = []
    moves_san: list[str] = []
    clocks: list[float | None] = []
    for node in game.mainline():
        move = node.move
        moves_san.append(board.san(move))
        # `Board.uci` and not `Move.uci`: castling is held king-takes-rook internally, and
        # only the board knows whether this game wants that spelling or `e1g1`.
        moves_uci.append(board.uci(move))
        clocks.append(node.clock())
        board.push(move)

    initial_clock, increment = _time_control(headers.get("TimeControl"))
    exporter = chess.pgn.StringExporter(headers=True, variations=True, comments=True)
    return ParsedGame(
        source=Source.PGN,
        source_id=_source_id(headers),
        white_name=headers.get("White") or "?",
        black_name=headers.get("Black") or "?",
        white_rating=_rating(headers.get("WhiteElo")),
        black_rating=_rating(headers.get("BlackElo")),
        result=_result(headers.get("Result")),
        termination=headers.get("Termination"),
        variant=variant if variant is not None else _variant(headers),
        rated=_rated(headers.get("Event")),
        speed=_speed(headers.get("Event"), initial_clock, increment),
        time_control=headers.get("TimeControl"),
        initial_clock=initial_clock,
        increment=increment,
        eco=headers.get("ECO"),
        opening_name=headers.get("Opening"),
        played_at=_played_at(headers),
        pgn=game.accept(exporter),
        moves_uci=moves_uci,
        moves_san=moves_san,
        clocks=clocks if any(clock is not None for clock in clocks) else None,
        initial_fen=headers.get("FEN"),
        ref=ref,
    )


def reference(headers: chess.pgn.Headers, index: int) -> str:
    """How a game is named in an error record: enough to find it again in the file."""
    white = headers.get("White") or "?"
    black = headers.get("Black") or "?"
    date = headers.get("UTCDate") or headers.get("Date") or "????.??.??"
    return f"game {index}: {white} vs {black} ({date})"


def _variant(headers: chess.pgn.Headers) -> str:
    name = (headers.get("Variant") or "standard").strip().casefold()
    return name or "standard"


def _result(value: str | None) -> Result:
    try:
        return Result(value or "*")
    except ValueError:
        return Result.UNKNOWN


def _rating(value: str | None) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _rated(event: str | None) -> bool | None:
    lowered = (event or "").casefold()
    if "rated" in lowered and "unrated" not in lowered:
        return True
    if "unrated" in lowered or "casual" in lowered:
        return False
    return None


def _time_control(value: str | None) -> tuple[int | None, int | None]:
    """`300+3` and `600` are what the sources actually write; anything else stays unparsed."""
    text = (value or "").strip()
    if not text or text == "-":
        return None, None
    match = CLOCK_PATTERN.match(text)
    if match is not None:
        return int(match.group(1)), int(match.group(2))
    if text.isdigit():
        return int(text), 0
    return None, None


def _speed(event: str | None, initial: int | None, increment: int | None) -> Speed | None:
    lowered = (event or "").casefold()
    for word, speed in SPEED_WORDS.items():
        if word in lowered:
            return speed
    if initial is None:
        return None
    estimate = initial + 40 * (increment or 0)
    for bound, speed in SPEED_BOUNDS:
        if estimate <= bound:
            return speed
    return Speed.CLASSICAL


def _source_id(headers: chess.pgn.Headers) -> str | None:
    """The game's ID on the site it came from, when the file still carries it."""
    for key in ("Site", "Link", "GameId", "GameID"):
        value = headers.get(key) or ""
        for pattern in (LICHESS_ID, CHESSCOM_ID):
            match = pattern.search(value)
            if match is not None:
                return match.group(1)
    return None


def _played_at(headers: chess.pgn.Headers) -> datetime | None:
    date = (headers.get("UTCDate") or headers.get("Date") or "").strip()
    parts = date.replace("-", ".").split(".")
    if len(parts) != 3 or not all(part.isdigit() for part in parts):
        return None
    year, month, day = (int(part) for part in parts)
    hour, minute, second = _clock_time(headers.get("UTCTime"))
    try:
        return datetime(year, month, day, hour, minute, second, tzinfo=UTC)
    except ValueError:
        return None


def _clock_time(value: str | None) -> tuple[int, int, int]:
    parts = (value or "").strip().split(":")
    if len(parts) != 3 or not all(part.isdigit() for part in parts):
        return 0, 0, 0
    hour, minute, second = (int(part) for part in parts)
    if hour > 23 or minute > 59 or second > 59:
        return 0, 0, 0
    return hour, minute, second

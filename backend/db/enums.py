from __future__ import annotations

from enum import StrEnum

# Every one of these is stored as a plain string column and validated in Python (see
# `backend.db.types.EnumString`). SQLite has no enum type at all, and a plain string column
# gains a member without a migration.


class Source(StrEnum):
    """Where a game came from."""

    LICHESS = "lichess"
    CHESSCOM = "chesscom"
    PGN = "pgn"
    MANUAL = "manual"


class Platform(StrEnum):
    """Where an account lives."""

    LICHESS = "lichess"
    CHESSCOM = "chesscom"
    OTB = "otb"


class Color(StrEnum):
    WHITE = "white"
    BLACK = "black"


class Result(StrEnum):
    WHITE_WIN = "1-0"
    BLACK_WIN = "0-1"
    DRAW = "1/2-1/2"
    UNKNOWN = "*"


class Speed(StrEnum):
    BULLET = "bullet"
    BLITZ = "blitz"
    RAPID = "rapid"
    CLASSICAL = "classical"
    CORRESPONDENCE = "correspondence"


class NoteSource(StrEnum):
    """Which surface wrote a note down.

    Worth a column because the three read differently: the web note was typed while
    looking at the board, the MCP one is what the coach concluded, and the live one is a
    moment somebody grabbed mid-session and has not come back to yet.
    """

    WEB = "web"
    MCP = "mcp"
    LIVE = "live"


class Tier(StrEnum):
    """How much engine budget one analysis pass gets."""

    QUICK = "quick"
    DEEP = "deep"


class RunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class Classification(StrEnum):
    """Win-percentage-based move quality, à la Lichess; thresholds are configurable."""

    BEST = "best"
    GOOD = "good"
    INACCURACY = "inaccuracy"
    MISTAKE = "mistake"
    BLUNDER = "blunder"


class EngineKind(StrEnum):
    UCI = "uci"
    MAIA = "maia"

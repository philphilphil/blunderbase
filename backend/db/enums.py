from __future__ import annotations

from enum import StrEnum

# Every one of these is stored as a plain string column and validated in Python (see
# `backend.db.types.EnumString`). SQLite has no enum type at all, and a plain string column
# gains a member without a migration.


class Source(StrEnum):
    """Where a game came from."""

    LICHESS = "lichess"
    CHESSCOM = "chesscom"
    FICS = "fics"
    PGN = "pgn"
    MANUAL = "manual"
    # Lichess's masters archive, reached through the reference explorer. Its games are
    # somebody else's by definition, so they arrive with `Game.is_owner_game` off.
    MASTERS = "masters"


class Platform(StrEnum):
    """Where an account lives."""

    LICHESS = "lichess"
    CHESSCOM = "chesscom"
    FICS = "fics"
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


class EngineRole(StrEnum):
    """A job the owner assigns one engine to. Deliberately *not* `Tier`.

    `Tier` is a search budget: it is stored on every `analysis_runs` row and read by the
    node and multipv defaults, by `default_priority`, by the coverage endpoint and by the
    MCP surface. `HUMAN` searches nothing — Maia answers with a policy rather than a
    search — so making it a third `Tier` member to give the owner a third dropdown would
    corrupt a well-defined type for a display convenience.

    The two share their spelling where they overlap (`quick`, `deep`) because a run of a
    tier is served by the engine assigned to the role of the same name, and nothing but an
    owner's assignment decides which engine that is: an engine advertises what kind of
    thing it is, and never claims a role.
    """

    QUICK = "quick"
    DEEP = "deep"
    HUMAN = "human"


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
    # Stopped on request, part-way. What it stored is stored and deduplicated like any
    # other import; what it had not reached is simply not here yet. Kept apart from DONE
    # because a cursor must not be resumed from a run that did not finish its stream.
    CANCELLED = "cancelled"


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

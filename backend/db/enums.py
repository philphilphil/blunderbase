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
    # A correspondence game played on the ICCF server. Its `source_id` is the ICCF game
    # number, so a later importer can reconcile a finished game by id rather than by hash.
    # A correspondence game played anywhere else is `MANUAL` and is otherwise identical.
    ICCF = "iccf"
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


class CorrespondenceMark(StrEnum):
    """The player's word about a move in a correspondence tree, against the engine's.

    A mark is not decoration: it steers the machine as well as the eye. An `EXCLUDED` move
    is never expanded and never gets a task, a `BAD` one is expanded once at most, and
    `GOOD` and `INTERESTING` earn a stage and a sibling more when the node above them is
    expanded. The glyph each one shows — and the NAG it exports as — lives in
    `services.correspondence`, because it is a property of the presentation and not of the
    stored value.
    """

    GOOD = "good"
    INTERESTING = "interesting"
    DUBIOUS = "dubious"
    BAD = "bad"
    EXCLUDED = "excluded"


class SearchKind(StrEnum):
    """Which of the two engine modes a correspondence search row is.

    `SEARCH` is IDeA's infinite analysis: one engine on one node for as long as it takes,
    in the correspondence pool. `TASK` is IDeA's bounded task: a node budget, carried by an
    `AnalysisRun` through the ordinary queue and its runners.
    """

    SEARCH = "search"
    TASK = "task"


class SearchStatus(StrEnum):
    """Where a correspondence search is. Deliberately not `RunStatus`.

    Two members have no meaning in the analysis queue and are the whole point here:
    `PAUSED` is a search whose process may still be parked with its hash intact, and
    `STOPPED` is one the owner ended rather than one that reached its limit.
    """

    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    DONE = "done"
    STOPPED = "stopped"
    FAILED = "failed"

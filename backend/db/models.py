from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.db.base import Base
from backend.db.enums import (
    Classification,
    Color,
    EngineKind,
    JobStatus,
    NoteSource,
    Platform,
    Result,
    RunStatus,
    Source,
    Speed,
    Tier,
)
from backend.db.types import EnumString, UtcDateTime, utcnow

FEN_LENGTH = 120
ZOBRIST_LENGTH = 16
UCI_LENGTH = 8
SAN_LENGTH = 16


class Account(Base):
    """A username the owner plays under. Defines which side of a game is "you"."""

    __tablename__ = "accounts"
    __table_args__ = (
        UniqueConstraint("platform", "username", name="uq_accounts_platform_username"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    platform: Mapped[Platform] = mapped_column(EnumString(Platform), nullable=False)
    username: Mapped[str] = mapped_column(String(64), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(128))
    is_owner: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utcnow)


class Credential(Base):
    """The owner's password. One row, because Blunderbase has one user by design.

    Never the password itself: a scrypt hash over a per-credential random salt, with the
    cost parameters stored beside it so they can be raised later — an old row is still
    verifiable with the numbers it was written under, and the next password change writes
    the new ones. The failure counter and the lockout live here too: one user means
    "consecutive failures" is a single number rather than a table.
    """

    __tablename__ = "credentials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    algorithm: Mapped[str] = mapped_column(String(16), nullable=False, default="scrypt")
    salt: Mapped[str] = mapped_column(String(64), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    scrypt_n: Mapped[int] = mapped_column(Integer, nullable=False)
    scrypt_r: Mapped[int] = mapped_column(Integer, nullable=False)
    scrypt_p: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        UtcDateTime, nullable=False, default=utcnow, onupdate=utcnow
    )
    last_login_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    # Consecutive failures since the last success, and how long the door stays shut.
    failed_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(UtcDateTime)


class AuthSession(Base):
    """One signed-in browser. The cookie's value is never stored, only its SHA-256.

    A stolen database is then not a stolen session: the token exists in the owner's cookie
    jar and nowhere else, and it is high-entropy enough that hashing it once is the whole
    of the protection it needs.
    """

    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utcnow)
    # Moved on use, which is what makes the expiry slide rather than run out mid-session.
    last_seen_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)


class AppSetting(Base):
    """One piece of deployment configuration the owner edits in the analysis UI.

    Key and value rather than a column apiece: these are single values a person changes
    from a form, not a schema anything joins against, and the set of them is expected to
    grow one at a time. `services/app_settings.py` is the only module that reads or writes
    them, and it is where each key's type and range live.

    An absent row is the setting nobody has chosen, which is why clearing one deletes the
    row instead of writing a null: "unset" has to be tellable from "set to nothing", and
    the value column is where a `null` would be indistinguishable from either.
    """

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UtcDateTime, nullable=False, default=utcnow, onupdate=utcnow
    )


class Engine(Base):
    """A configured analysis engine. Managed from the UI, not from a config file."""

    __tablename__ = "engines"
    __table_args__ = (Index("ix_engines_runner_id", "runner_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    kind: Mapped[EngineKind] = mapped_column(EnumString(EngineKind), nullable=False)
    path: Mapped[str] = mapped_column(String(512), nullable=False)
    version: Mapped[str | None] = mapped_column(String(64))
    options: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Whether the host that advertised this engine answers `stream_open` — its own word,
    # persisted rather than inferred. A binary on this host advertises nothing and drives
    # a board as it always has, which is what the default says; a runner that implements
    # queue work and no analysis boards says `streams: false` in its `hello`, and the
    # picker has to be able to see that rather than offer a board nobody will answer.
    streams: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    # No `default_tier`: an engine says what kind of thing it is and nothing about which
    # job it does. The three jobs are assignments the owner makes, stored as settings and
    # resolved by `services.engines` — see `EngineRole`.
    # NULL means the binary is on this host. A row that names a runner is that runner's
    # advertisement of what it can run, and `path` is a path on *its* filesystem.
    runner_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("runners.id"))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utcnow)


class Runner(Base):
    """A machine that hosts engines for this deployment and dials in for work.

    The token is never stored, only its SHA-256 — the same reasoning as `AuthSession`, and
    the same one-time-display rule: 32 random bytes need no scrypt, and a copy of the
    database is then not a way to impersonate a runner.

    `connected` is a persisted column rather than a fact the gateway keeps in memory,
    because the questions that need it — can this tier run, where will the backlog be
    worked — are answered by pure database reads that have no gateway to ask. A process
    that dies leaves the flag set, so a starting one clears every row the way it collects
    the runs a dead process left `running`.
    """

    __tablename__ = "runners"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    # Concurrent engine jobs plus stream sessions. The owner's cap, not the runner's claim.
    slots: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    version: Mapped[str | None] = mapped_column(String(32))
    connected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Whether this runner is a browser tab rather than a process on a machine, as it said
    # so in its `hello`. Written on every connection, because the same token could be used
    # by a tab today and by a script tomorrow. What it is for is `requeue_stale_runs`: a
    # tab is expected to vanish — a closed laptop, a locked phone, a background tab whose
    # timers are throttled — and a run it was holding when it did must not spend one of its
    # two attempts on that.
    browser: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utcnow)


class McpKey(Base):
    """A bearer key the owner minted for one MCP client, so the password stays theirs.

    The password opens the browser; handing it to every coach configuration that wants
    `/mcp` means rotating it everywhere the day one of them leaks. A key is a separate,
    revocable secret per client — and the same rules as `Runner`: only the SHA-256 is
    kept, 32 random bytes need no scrypt, and the token is shown at the moment it is minted
    and never again. `last_used_at` is what tells the owner which key they can safely
    delete.
    """

    __tablename__ = "mcp_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(UtcDateTime)


class ImportJob(Base):
    """One sync of one source: its cursor, its counts and its per-game failures."""

    __tablename__ = "import_jobs"
    __table_args__ = (Index("ix_import_jobs_source_created_at", "source", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[Source] = mapped_column(EnumString(Source), nullable=False)
    account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("accounts.id"))
    status: Mapped[JobStatus] = mapped_column(
        EnumString(JobStatus), nullable=False, default=JobStatus.QUEUED
    )
    # Whatever the source needs to resume: a Lichess `since` millisecond stamp, a
    # chess.com archive month. Opaque to everything but the adapter that wrote it.
    cursor: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    finished_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    games_seen: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    games_imported: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    games_skipped: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Games this run found in `deleted_games` and would not store again. Its own count
    # rather than part of `games_skipped`: "you already have this" and "you threw this
    # away" are different facts, and only one of them has a button that changes it.
    games_blocked: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    games_failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # One entry per game that could not be parsed or stored; a bad game never aborts a sync.
    errors: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    message: Mapped[str | None] = mapped_column(Text)

    account: Mapped[Account | None] = relationship()


class DeletedGame(Base):
    """A game the owner deleted, remembered so that an import cannot quietly bring it back.

    Deleting a game deletes the only record of it, and the importer's deduplication is a
    lookup in `games` (`services.games.identify`) — so without this row the next sync
    of that source stores it again as a brand-new game. That is not a corner case:
    `adapters.chesscom` deliberately re-reads the archive month that is still being played
    on every sync, so a game deleted today comes back on the next one.

    Both identities the importer matches on are kept, because the same game arrives by more
    than one route: `source` + `source_id` is what a sync offers, and `dedup_hash` is what
    a PGN of that same game carries when it has no ID of its own. The names and the date
    are a snapshot for the screen that lists these — the game is gone, so there is nothing
    left to join to, and nobody can decide anything about a bare hash.

    Nothing here is a foreign key and nothing cascades: the row outlives its game on
    purpose. Forgetting one (`services.games.forget_deletions`) is the undo, and the next
    import stores the game again like any other new one. A full wipe writes none of these —
    "reset the imported library" means start over, and a library's worth of tombstones
    would make the re-import that follows it impossible.
    """

    __tablename__ = "deleted_games"
    __table_args__ = (
        Index("ix_deleted_games_dedup_hash", "dedup_hash"),
        Index("ix_deleted_games_source_source_id", "source", "source_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[Source] = mapped_column(EnumString(Source), nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(64))
    dedup_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    white_name: Mapped[str] = mapped_column(String(128), nullable=False)
    black_name: Mapped[str] = mapped_column(String(128), nullable=False)
    played_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    deleted_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utcnow)


class Position(Base):
    """A position reached in any game, stored once and pointed at by every game that hit it."""

    __tablename__ = "positions"
    __table_args__ = (
        Index("ix_positions_zobrist_key", "zobrist_key"),
        Index("ix_positions_book_state", "book_state"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # The normalised FEN (board, side to move, castling, en passant) — the identity of the
    # position, and the unique key. The move and halfmove counters are deliberately absent.
    fen: Mapped[str] = mapped_column(String(FEN_LENGTH), nullable=False, unique=True)
    # python-chess's polyglot zobrist hash as hex, for cheap lookups next to the FEN.
    zobrist_key: Mapped[str] = mapped_column(String(ZOBRIST_LENGTH), nullable=False)
    side_to_move: Mapped[Color] = mapped_column(EnumString(Color), nullable=False)
    # Whether the precomputed book below describes this position, and if not, why not.
    # 0 dirty — something that feeds the book changed, rebuild me; 1 built — the
    # `position_moves` and `position_totals` rows are authoritative; 2 cold — deliberately
    # left out because too few games reach it to be worth a row, so it is computed live.
    # `services.explorer` owns the values (`BOOK_DIRTY` / `BOOK_BUILT` / `BOOK_COLD`) and
    # the sweep that settles them; indexed because that sweep's whole job is finding 0s.
    book_state: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )


class Game(Base):
    """One game from one source, with its parsed move list and clock times."""

    __tablename__ = "games"
    __table_args__ = (
        UniqueConstraint("source", "source_id", name="uq_games_source_source_id"),
        Index("ix_games_played_at", "played_at"),
        Index("ix_games_dedup_hash", "dedup_hash"),
        Index("ix_games_stat_worst_win_loss", "stat_worst_win_loss"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[Source] = mapped_column(EnumString(Source), nullable=False)
    # The source's own ID where it has one. NULL for PGN and manual games, and NULLs do
    # not collide in a unique constraint on either back end.
    source_id: Mapped[str | None] = mapped_column(String(64))
    # Hash of moves + date + players: catches the same game arriving twice by two routes,
    # e.g. a PGN export of an already-synced Lichess game. Not unique — the service layer
    # decides what a collision means.
    dedup_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    white_name: Mapped[str] = mapped_column(String(128), nullable=False)
    black_name: Mapped[str] = mapped_column(String(128), nullable=False)
    white_rating: Mapped[int | None] = mapped_column(Integer)
    black_rating: Mapped[int | None] = mapped_column(Integer)
    white_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("accounts.id"))
    black_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("accounts.id"))
    owner_color: Mapped[Color | None] = mapped_column(EnumString(Color))

    result: Mapped[Result] = mapped_column(EnumString(Result), nullable=False)
    termination: Mapped[str | None] = mapped_column(String(64))
    variant: Mapped[str] = mapped_column(String(32), nullable=False, default="standard")
    rated: Mapped[bool | None] = mapped_column(Boolean)
    speed: Mapped[Speed | None] = mapped_column(EnumString(Speed))
    time_control: Mapped[str | None] = mapped_column(String(32))
    initial_clock: Mapped[int | None] = mapped_column(Integer)
    increment: Mapped[int | None] = mapped_column(Integer)
    eco: Mapped[str | None] = mapped_column(String(8))
    opening_name: Mapped[str | None] = mapped_column(String(128))

    played_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    imported_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utcnow)

    pgn: Mapped[str] = mapped_column(Text, nullable=False)
    moves_uci: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    moves_san: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    # Seconds remaining after each ply, aligned with the move lists; NULL when the source
    # carries no clock information.
    clocks: Mapped[list[float | None] | None] = mapped_column(JSON)
    ply_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # The analysis half of the game's card — the eval curve, the worst moments, whether a
    # deep pass reached it — as `services.games` builds it. Written in the same commit that
    # changes the game's finished runs, because a listing of fifty games cannot afford to
    # read every MoveEval of every run behind each of them. NULL for a game nothing has
    # analysed yet, and for one analysed before this column existed: a reader that finds
    # NULL computes the card the slow way.
    card: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    # The stats half of the same idea: this game's contribution to every aggregation,
    # folded out of its primary run (`stats.primary_runs()` — the newest done, full-game,
    # UCI pass) and written in the same commit that finishes one. A dimension used to
    # hydrate every analysed ply of every game in the library to answer; with these it sums
    # one row per game. `services.stats` builds it and is the only thing that reads it.
    #
    # NULL for a game no full-game pass has finished, and for one analysed before the
    # column existed: the full scan is still there, and is what answers until the backfill
    # sweep has been over the library.
    #
    # Deferred, because it is several kilobytes of JSON that only `services.stats` reads
    # and every other `select(Game)` in the app — a games page, a game detail, an import
    # sweep — was paying to fetch and parse it per row. The one path that hydrates games to
    # read it (`stats._worst_moments_from_summaries`) undefers it on its own query, so no
    # reader trades the eager parse for a lazy load per row.
    stat_summary: Mapped[dict[str, Any] | None] = mapped_column(JSON, deferred=True)
    # Analysed owner moves and owner blunders in that run — the two numbers the per-game
    # dimensions are a rate over — as columns rather than inside the JSON, so a query that
    # already selects game rows picks them up without parsing anything.
    stat_owner_moves: Mapped[int | None] = mapped_column(Integer)
    stat_blunders: Mapped[int | None] = mapped_column(Integer)
    # The most win percentage the owner gave away in a single blunder of that run; NULL
    # when it holds none. A real, indexed column because "the worst moments in the library"
    # is then an ordered walk of that index over games rather than a scan of every eval
    # behind them.
    stat_worst_win_loss: Mapped[float | None] = mapped_column(Float)

    import_job_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("import_jobs.id"))

    import_job: Mapped[ImportJob | None] = relationship()
    positions: Mapped[list[GamePosition]] = relationship(
        back_populates="game",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="GamePosition.ply",
    )
    runs: Mapped[list[AnalysisRun]] = relationship(
        back_populates="game", cascade="all, delete-orphan", passive_deletes=True
    )


class GamePosition(Base):
    """Game × ply × position. Turns "have I been here before?" into a lookup."""

    __tablename__ = "game_positions"
    __table_args__ = (
        UniqueConstraint("game_id", "ply", name="uq_game_positions_game_id_ply"),
        Index("ix_game_positions_position_id", "position_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    game_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("games.id", ondelete="CASCADE"), nullable=False
    )
    ply: Mapped[int] = mapped_column(Integer, nullable=False)
    position_id: Mapped[int] = mapped_column(Integer, ForeignKey("positions.id"), nullable=False)
    # The move played from this position in this game; NULL at the final position.
    move_uci: Mapped[str | None] = mapped_column(String(UCI_LENGTH))
    move_san: Mapped[str | None] = mapped_column(String(SAN_LENGTH))

    game: Mapped[Game] = relationship(back_populates="positions")
    position: Mapped[Position] = relationship()


class PositionMove(Base):
    """One continuation out of one position, already folded. The explorer's book.

    The explorer used to fold every `game_positions` row of a position on every request,
    and the initial array is nine and a half thousand of them. A position's continuations
    only change when a game that reaches it is imported, analysed, recoloured or deleted,
    so the fold is written down then — one row per (position, owner colour, move), holding
    exactly the counters `services.explorer._tree` accumulates.

    Only *hot* positions get rows: `explorer.BOOK_MIN_OCCURRENCES` is the cut, and the
    long tail of positions one game has ever reached folds live in microseconds. Which
    side of the cut a position is on is `positions.book_state`.

    Per owner colour rather than summed, because every read is filtered by colour or by
    neither, and the sums merge — a game has one owner colour, so "both" is white's row
    plus black's. `next_position_id` is what makes the book walk positional: it is where
    this move lands, so the walk follows a pointer instead of replaying a board.
    """

    __tablename__ = "position_moves"
    __table_args__ = (
        UniqueConstraint(
            "position_id",
            "owner_color",
            "move_uci",
            name="uq_position_moves_position_id_owner_color_move_uci",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    position_id: Mapped[int] = mapped_column(Integer, ForeignKey("positions.id"), nullable=False)
    owner_color: Mapped[Color] = mapped_column(EnumString(Color), nullable=False)
    move_uci: Mapped[str] = mapped_column(String(UCI_LENGTH), nullable=False)
    move_san: Mapped[str | None] = mapped_column(String(SAN_LENGTH))
    # The position this move reaches, NULL only where no game carried on far enough to
    # record one. Chess makes it a property of (position, move), not of the game.
    next_position_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("positions.id"))

    # Distinct games that played the move, and the rows they did it in: a game that reached
    # the position twice and played the same move both times is one game, two occurrences.
    games: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    occurrences: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Occurrences where the owner was the one to move, and where an eval reached the ply.
    # The three accuracy counters are the owner's alone: a row whose `owner_color` is not
    # the position's `side_to_move` folded only opponent moves and counts none of them.
    # Rows written before that rule still hold the mover's numbers and the explorer reads
    # them as zero (`services.explorer._tree_from_book`) until the sweep rebuilds them.
    owner_moves: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    evaluated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    blunders: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Distinct games again, split by how they ended for the owner. Their sum falls short of
    # `games` by the games with no decided result.
    wins: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    draws: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    losses: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Sums rather than averages, because an average cannot be merged with another one:
    # `avg_win_loss` is `loss_sum / evaluated` and `avg_ply` is `ply_sum / occurrences`.
    loss_sum: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    ply_sum: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_played: Mapped[datetime | None] = mapped_column(UtcDateTime)


class PositionTotal(Base):
    """A position's own row in the book: every game through it, however it continued.

    Not the sum of its `PositionMove` rows, and that is the whole reason it exists. The
    explorer's totals count a game once per position, but a game that visits a position
    twice and plays two different moves is counted under both moves — summing the moves
    would report it twice. `ended_here` is the other half: occurrences with no move at all,
    which no move row could hold.
    """

    __tablename__ = "position_totals"
    __table_args__ = (
        UniqueConstraint(
            "position_id", "owner_color", name="uq_position_totals_position_id_owner_color"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    position_id: Mapped[int] = mapped_column(Integer, ForeignKey("positions.id"), nullable=False)
    owner_color: Mapped[Color] = mapped_column(EnumString(Color), nullable=False)

    games: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    wins: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    draws: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    losses: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Occurrences where the game stopped here rather than playing on.
    ended_here: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # How many occurrences arrived at each ply, keyed by ply as a string because JSON has
    # no integer keys. The explorer reports the commonest as the tree's `root_ply`, and a
    # mode is the one number here that cannot be recovered from a sum or an average.
    ply_counts: Mapped[dict[str, int]] = mapped_column(JSON, nullable=False, default=dict)


class AnalysisRun(Base):
    """One engine pass over one game (or one standalone position). Re-analysis is a new run."""

    __tablename__ = "analysis_runs"
    __table_args__ = (
        Index("ix_analysis_runs_game_id", "game_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    game_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("games.id", ondelete="CASCADE"))
    # Set instead of `game_id` for a run over a position that is not part of a stored game.
    fen: Mapped[str | None] = mapped_column(String(FEN_LENGTH))
    engine_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("engines.id"))
    tier: Mapped[Tier] = mapped_column(EnumString(Tier), nullable=False)
    status: Mapped[RunStatus] = mapped_column(
        EnumString(RunStatus), nullable=False, default=RunStatus.QUEUED
    )
    depth: Mapped[int | None] = mapped_column(Integer)
    nodes: Mapped[int | None] = mapped_column(Integer)
    multipv: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    ply_start: Mapped[int | None] = mapped_column(Integer)
    ply_end: Mapped[int | None] = mapped_column(Integer)
    # Higher runs first: deep jobs jump the FIFO queue because someone is waiting on them.
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Whether a Maia pass follows this run's search at all. Copied off the tier's setting
    # when the run is queued, for the reason the budget is: a run queued to be searched and
    # nothing else must not grow a human-move pass because a setting moved while it waited.
    # Always true on a `maia_only` row — a fill with no Maia would be no pass at all.
    maia: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    # A pass that asks Maia and nothing else: no search, and its rows carry a policy and no
    # evaluation. What "fill in the missing Maia levels" queues over a game that has already
    # been searched, so the levels are added without paying for Stockfish twice.
    maia_only: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    # The Maia levels this run was queued for, where they are not the deployment's current
    # ones: a fill run's missing levels, or an explicit override. NULL means "whatever is
    # configured when the plan is built".
    maia_elos: Mapped[list[int] | None] = mapped_column(JSON)
    # A crashed engine buys one retry; after that the run stays failed.
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Written by every claim. A result is only accepted while the run is `running` under
    # the token it was dispatched with, which is what lets a late answer from a runner that
    # was already given up on be dropped instead of overwriting the retry's work.
    attempt_token: Mapped[str | None] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    # Touched while a worker is executing this run. A `running` row whose heartbeat has
    # gone quiet is one a dead process left behind; a fresh one belongs to a live worker,
    # which is what keeps a second worker set from taking work off the first.
    heartbeat_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    finished_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    error: Mapped[str | None] = mapped_column(Text)
    stderr: Mapped[str | None] = mapped_column(Text)

    game: Mapped[Game | None] = relationship(back_populates="runs")
    engine: Mapped[Engine | None] = relationship()
    move_evals: Mapped[list[MoveEval]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="MoveEval.ply",
    )


# Mixed directions matter: claims take high priority first and FIFO inside it. Declared
# against the mapped columns so SQLAlchemy preserves those directions in schema creation.
Index(
    "ix_analysis_runs_status_priority_created_at",
    AnalysisRun.status,
    AnalysisRun.priority.desc(),
    AnalysisRun.created_at.asc(),
    AnalysisRun.id.asc(),
)


class MoveEval(Base):
    """One ply of one run: what the engine thought before and after the move played."""

    __tablename__ = "move_evals"
    __table_args__ = (UniqueConstraint("run_id", "ply", name="uq_move_evals_run_id_ply"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("analysis_runs.id", ondelete="CASCADE"), nullable=False
    )
    ply: Mapped[int] = mapped_column(Integer, nullable=False)
    position_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("positions.id"))
    move_uci: Mapped[str | None] = mapped_column(String(UCI_LENGTH))
    move_san: Mapped[str | None] = mapped_column(String(SAN_LENGTH))
    # Scores are from the side to move's point of view; exactly one of cp / mate is set.
    eval_before_cp: Mapped[int | None] = mapped_column(Integer)
    eval_before_mate: Mapped[int | None] = mapped_column(Integer)
    eval_after_cp: Mapped[int | None] = mapped_column(Integer)
    eval_after_mate: Mapped[int | None] = mapped_column(Integer)
    # Win percentages and the drop between them: classification is win%-based, so a
    # middlegame swing is not overweighted the way raw centipawns would.
    win_before: Mapped[float | None] = mapped_column(Float)
    win_after: Mapped[float | None] = mapped_column(Float)
    win_loss: Mapped[float | None] = mapped_column(Float)
    classification: Mapped[Classification | None] = mapped_column(EnumString(Classification))
    best_move_uci: Mapped[str | None] = mapped_column(String(UCI_LENGTH))
    # Multi-PV lines: [{"multipv": 1, "cp": 34, "mate": null, "pv": ["e2e4", ...]}, ...]
    # `none_as_null` on both of these because "there is no policy here" has to be SQL NULL:
    # a plain JSON column stores Python None as the JSON literal `null`, which is a value,
    # and a row holding it answers `IS NOT NULL` while decoding to None. That is what had
    # `_settled_maia_levels` reading whole runs as carrying no Maia levels at all (0011).
    best_lines: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON(none_as_null=True))
    # Maia's predicted human move per rating level: {"1700": [{"uci": "e2e4", "p": 0.31}, ...]}
    maia_policy: Mapped[dict[str, Any] | None] = mapped_column(JSON(none_as_null=True))

    run: Mapped[AnalysisRun] = relationship(back_populates="move_evals")
    position: Mapped[Position | None] = relationship()


class Line(Base):
    """A variation off a stored game: the moves somebody actually walked from one position.

    A game carries one line of play and there is nowhere in `games` to put a second, so
    every variation the owner clicked through has always died with the tab. This is where
    the ones worth keeping go: `base_ply` names the mainline position it branches from —
    the position *after* that many half-moves, 0 being the start — and `moves` is the
    variation in UCI, replayed against the game rather than stored as a second board.

    Kept deliberately flat rather than as a move tree. What a reader wants back is "the
    line I looked at", and a list of lines off their branch points is that, with no tree to
    merge and no ordering to preserve. Two lines off the same position where one is the
    head of the other are one line walked twice, which `services.notes.save_line` folds
    into the longer of them — the same rule the move list applies to unsaved variations.
    """

    __tablename__ = "lines"
    __table_args__ = (Index("ix_lines_game_id", "game_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    game_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("games.id", ondelete="CASCADE"), nullable=False
    )
    base_ply: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    moves: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        UtcDateTime, nullable=False, default=utcnow, onupdate=utcnow
    )

    game: Mapped[Game] = relationship()
    notes: Mapped[list[Note]] = relationship(back_populates="line")


class Note(Base):
    """Coach-written memory: free text plus tags, attached to a game, a position or nothing.

    Three anchors, and a note may carry any combination of them. `game_id` says which game
    it is about, `position_id` which position (that is what lets the explorer find the note
    for a position, however the owner reached it), and `line_id` which variation. `ply` reads
    against whichever of the first two applies: a half-move count into the game's mainline,
    or — with `line_id` set — a half-move count on the same scale as the line's `base_ply`,
    so `ply == base_ply` is the branch point and `base_ply + k` is k moves into the line.

    `source` is who wrote it, which is worth keeping because the three surfaces mean
    different things by a note; see `db.enums.NoteSource`.
    """

    __tablename__ = "notes"
    __table_args__ = (
        Index("ix_notes_created_at", "created_at"),
        Index("ix_notes_game_id", "game_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    game_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("games.id", ondelete="CASCADE"))
    position_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("positions.id"))
    # SET NULL rather than CASCADE: unpinning a line must not silently take the thinking
    # that was written about it, and a note whose line is gone still says something.
    line_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("lines.id", ondelete="SET NULL")
    )
    ply: Mapped[int | None] = mapped_column(Integer)
    source: Mapped[NoteSource] = mapped_column(
        EnumString(NoteSource), nullable=False, default=NoteSource.WEB
    )
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        UtcDateTime, nullable=False, default=utcnow, onupdate=utcnow
    )

    game: Mapped[Game | None] = relationship()
    position: Mapped[Position | None] = relationship()
    line: Mapped[Line | None] = relationship(back_populates="notes")


class RepertoireMove(Base):
    """One move in one of the owner's two opening repertoires: what they intend to play.

    A tree rather than a list of lines, because that is what a repertoire is: `parent_id`
    is the move this one answers and a NULL parent is a first move from the standard start
    position. There are exactly two trees, one per `color` — the colour the *owner* plays,
    which is what decides whose moves are choices and whose are the ones being prepared
    against. Nothing here is a game and nothing joins to `games`: this is what the owner
    means to play, not what they have played, and mixing the two would make the explorer's
    counts lie.

    `rank` orders siblings and 0 is the main line, so promoting a move is a renumbering of
    its siblings rather than a column that says "main". `epd` is the normalised position
    *after* the move, keyed exactly as `positions.fen` is (`explorer.normalize_fen`), which
    is what makes a repertoire lookup transposition-aware: two paths that reach the same
    position carry the same EPD and can be found from a board without walking the tree.

    `comment` is the PGN-comment-style note on the move, empty rather than NULL so a tree
    payload never has to distinguish "no comment" from "the comment is nothing".

    Deletes of a subtree are done in the service, in Python: SQLite would need the
    self-referential cascade turned on per connection, and a repertoire is small enough
    that collecting the descendants and deleting them by id is the honest version.
    """

    __tablename__ = "repertoire_moves"
    __table_args__ = (
        Index("ix_repertoire_moves_color_parent_id", "color", "parent_id"),
        Index("ix_repertoire_moves_color_epd", "color", "epd"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    color: Mapped[Color] = mapped_column(EnumString(Color), nullable=False)
    parent_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("repertoire_moves.id"))
    move_uci: Mapped[str] = mapped_column(String(UCI_LENGTH), nullable=False)
    move_san: Mapped[str] = mapped_column(String(SAN_LENGTH), nullable=False)
    epd: Mapped[str] = mapped_column(String(FEN_LENGTH), nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False, default="")
    rank: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        UtcDateTime, nullable=False, default=utcnow, onupdate=utcnow
    )


# The notes full-text index is not a table SQLAlchemy can declare, so importing it here is
# what registers the hook that builds it alongside the tables that are.
from backend.db import fts  # noqa: E402, F401  (registers the notes_fts after_create hook)

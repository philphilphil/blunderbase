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


class Engine(Base):
    """A configured analysis engine. Managed from the UI, not from a config file."""

    __tablename__ = "engines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    kind: Mapped[EngineKind] = mapped_column(EnumString(EngineKind), nullable=False)
    path: Mapped[str] = mapped_column(String(512), nullable=False)
    version: Mapped[str | None] = mapped_column(String(64))
    options: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    default_tier: Mapped[Tier | None] = mapped_column(EnumString(Tier))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utcnow)


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
    games_failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # One entry per game that could not be parsed or stored; a bad game never aborts a sync.
    errors: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    message: Mapped[str | None] = mapped_column(Text)

    account: Mapped[Account | None] = relationship()


class Position(Base):
    """A position reached in any game, stored once and pointed at by every game that hit it."""

    __tablename__ = "positions"
    __table_args__ = (Index("ix_positions_zobrist_key", "zobrist_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # The normalised FEN (board, side to move, castling, en passant) — the identity of the
    # position, and the unique key. The move and halfmove counters are deliberately absent.
    fen: Mapped[str] = mapped_column(String(FEN_LENGTH), nullable=False, unique=True)
    # python-chess's polyglot zobrist hash as hex, for cheap lookups next to the FEN.
    zobrist_key: Mapped[str] = mapped_column(String(ZOBRIST_LENGTH), nullable=False)
    side_to_move: Mapped[Color] = mapped_column(EnumString(Color), nullable=False)


class Game(Base):
    """One game from one source, with its parsed move list and clock times."""

    __tablename__ = "games"
    __table_args__ = (
        UniqueConstraint("source", "source_id", name="uq_games_source_source_id"),
        Index("ix_games_played_at", "played_at"),
        Index("ix_games_dedup_hash", "dedup_hash"),
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


class AnalysisRun(Base):
    """One engine pass over one game (or one standalone position). Re-analysis is a new run."""

    __tablename__ = "analysis_runs"
    __table_args__ = (
        Index("ix_analysis_runs_game_id", "game_id"),
        Index("ix_analysis_runs_status_priority_created_at", "status", "priority", "created_at"),
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
    # A crashed engine buys one retry; after that the run stays failed.
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
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
    best_lines: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)
    # Maia's predicted human move per rating level: {"1700": [{"uci": "e2e4", "p": 0.31}, ...]}
    maia_policy: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    run: Mapped[AnalysisRun] = relationship(back_populates="move_evals")
    position: Mapped[Position | None] = relationship()


class Note(Base):
    """Coach-written memory: free text plus tags, attached to a game, a position or nothing."""

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
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        UtcDateTime, nullable=False, default=utcnow, onupdate=utcnow
    )

    game: Mapped[Game | None] = relationship()
    position: Mapped[Position | None] = relationship()

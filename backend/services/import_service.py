from __future__ import annotations

import hashlib
import logging
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from importlib import import_module
from typing import Any, Protocol

from sqlalchemy import func, insert, select
from sqlalchemy.orm import Session

from backend.adapters import openings
from backend.db.enums import (
    Color,
    JobStatus,
    Result,
    Source,
    Speed,
    Tier,
)
from backend.db.models import (
    Account,
    AnalysisRun,
    Engine,
    Game,
    GamePosition,
    ImportJob,
    Position,
)
from backend.db.types import utcnow
from backend.services import accounts as accounts_service
from backend.services import analysis, engines
from backend.services import explorer as explorer_service
from backend.services import games as games_service
from backend.services.accounts import AccountIndex, fold
from backend.services.analysis import QUICK_PRIORITY  # noqa: F401  (the pipeline's own priority)

logger = logging.getLogger(__name__)


class UnknownSourceError(LookupError):
    """The requested source has no registered adapter."""


class SourceNotImplementedError(NotImplementedError):
    """The adapter is registered but has not been written yet."""


@dataclass(slots=True)
class ImportResult:
    """What one adapter run did, folded back into the job row by `run_import`."""

    seen: int = 0
    imported: int = 0
    skipped: int = 0
    # Games this run found in `deleted_games` and left alone. Counted apart from `skipped`
    # because the owner can change it: forgetting the deletion lets the next run store them.
    blocked: int = 0
    failed: int = 0
    cursor: str | None = None
    # One entry per game that could not be parsed or stored: {"ref": ..., "error": ...}.
    errors: list[dict[str, Any]] = field(default_factory=list)


@dataclass(slots=True)
class ParsedGame:
    """One game as an adapter hands it over: source-neutral, still database-free.

    The pipeline replays `moves_uci` itself to extract positions, so an adapter is only
    responsible for producing a legal move list and whatever metadata its source carries.
    """

    source: Source
    white_name: str
    black_name: str
    result: Result
    pgn: str
    moves_uci: list[str] = field(default_factory=list)
    moves_san: list[str] = field(default_factory=list)
    source_id: str | None = None
    white_rating: int | None = None
    black_rating: int | None = None
    termination: str | None = None
    variant: str = "standard"
    rated: bool | None = None
    speed: Speed | None = None
    time_control: str | None = None
    initial_clock: int | None = None
    increment: int | None = None
    eco: str | None = None
    opening_name: str | None = None
    played_at: datetime | None = None
    clocks: list[float | None] | None = None
    # Set when the game does not start from the initial array (chess960, OTB fragments).
    initial_fen: str | None = None
    # How this game is named in an error record or a progress event.
    ref: str | None = None

    @property
    def reference(self) -> str:
        if self.ref:
            return self.ref
        if self.source_id:
            return f"{self.source}:{self.source_id}"
        return f"{self.white_name} vs {self.black_name}"


@dataclass(slots=True)
class ImportFailure:
    """A game an adapter could not parse. Yielded in place of a `ParsedGame`."""

    ref: str
    error: str


@dataclass(slots=True)
class IngestOutcome:
    """The stored game and whether this call is what created it.

    `game` is None for the third answer: a game the owner deleted on purpose, which this
    run refused to store again (`blocked`). There is no row to point at, which is the whole
    reason `deleted_games` exists.
    """

    game: Game | None
    created: bool
    blocked: bool = False


# A progress subscriber: the WebSocket layer, a CLI printer, a test recorder. It is called
# once per game and once each at the start and the end of a job; see the EVENT_* shapes.
ProgressHook = Callable[[dict[str, Any]], None]

EVENT_IMPORT_STARTED = "import.started"
EVENT_IMPORT_GAME = "import.game"
EVENT_IMPORT_FINISHED = "import.finished"

GAME_IMPORTED = "imported"
GAME_SKIPPED = "skipped"
# A game that is not here because the owner deleted it, not because it is already stored.
GAME_BLOCKED = "blocked"
GAME_FAILED = "failed"

CHESS960_VARIANTS = frozenset({"chess960", "fischerandom", "fischerrandom"})

# SQLite's default parameter limit is the tighter of the two back ends; a game never has
# this many distinct positions, but a lookup is chunked rather than assumed to be small.
LOOKUP_CHUNK = 400


class ImportAdapter(Protocol):
    """What every source module exposes as `run`.

    The adapter owns fetching and parsing; it turns what it fetched into `ParsedGame`s
    (and `ImportFailure`s for what it could not parse) and hands them to `ingest_games`,
    which does the storing. It never aborts the whole sync for one bad game — that goes
    into `ImportResult.errors`.

    `**options` are the CLI flags and API fields the caller passed, plus `progress` and
    `analyze`, which the adapter forwards to `ingest_games`. Every adapter accepts
    `**options` so a flag it does not know about is ignored rather than raising.
    """

    def __call__(self, session: Session, job: ImportJob, **options: Any) -> ImportResult: ...


# Source name -> the dotted path of its adapter's `run`. Registration is by path rather
# than by import so that adding a source never means editing an import list, and so that
# an adapter that is still a stub fails when it is called rather than at start-up.
SOURCES: dict[str, str] = {
    Source.LICHESS: "backend.adapters.lichess:run",
    Source.CHESSCOM: "backend.adapters.chesscom:run",
    Source.FICS: "backend.adapters.fics:run",
    Source.PGN: "backend.adapters.pgn_import:run",
}


def register_source(source: str, target: str) -> None:
    """Point a source name at `module:attribute`. Overwrites an existing registration."""
    SOURCES[source] = target


def get_adapter(source: str) -> ImportAdapter:
    """Resolve a registered source to its callable, importing the module on first use."""
    try:
        target = SOURCES[source]
    except KeyError:
        known = ", ".join(sorted(SOURCES))
        raise UnknownSourceError(
            f"unknown import source {source!r}; known sources: {known}"
        ) from None
    module_name, _, attribute = target.partition(":")
    module = import_module(module_name)
    adapter = getattr(module, attribute, None)
    if adapter is None:
        raise SourceNotImplementedError(f"{target} is not implemented yet")
    return adapter


def run_import(
    session: Session, source: str, *, progress: ProgressHook | None = None, **options: Any
) -> ImportJob:
    """Create an ImportJob, run the source's adapter under it and record the outcome.

    Failures of individual games land in `ImportJob.errors`; only an adapter-level error
    marks the job failed. That error is not re-raised, because the job row is the record
    of what happened and rolling it back would lose it.
    """
    adapter = get_adapter(source)
    job = ImportJob(source=Source(source), status=JobStatus.RUNNING, started_at=utcnow())
    session.add(job)
    session.commit()
    _emit(progress, {"event": EVENT_IMPORT_STARTED, **_job_fields(job), "at": _stamp()})

    try:
        result = adapter(session, job, progress=progress, **options)
        _reconcile(session, job)
    except Exception as exc:
        session.rollback()
        job.status = JobStatus.FAILED
        job.message = f"{type(exc).__name__}: {exc}"
    else:
        _apply(job, result)
        job.status = JobStatus.DONE
        if result.cursor is not None:
            job.cursor = result.cursor
    job.finished_at = utcnow()
    session.commit()

    _emit(progress, _finished_event(job))
    return job


def _reconcile(session: Session, job: ImportJob) -> None:
    """Re-derive the owner's side over this account's games, now that the sync has run.

    An adapter that names an account registers it before it stores anything, so a healthy
    sync finds nothing left to fill in. What this catches is everything that was stored
    before the account existed: games from an earlier sync of the same username, and games
    of it that arrived through a PGN.
    """
    if job.account_id is None:
        return
    account = session.get(Account, job.account_id)
    if account is not None:
        accounts_service.reconcile_games(session, account)


def ingest_games(
    session: Session,
    job: ImportJob,
    games: Iterable[ParsedGame | ImportFailure],
    *,
    progress: ProgressHook | None = None,
    accounts: AccountIndex | None = None,
    analyze: bool = True,
    presume_owner: bool = True,
) -> ImportResult:
    """Store a stream of parsed games under one job: dedup, positions, quick-tier run.

    Every game is its own transaction, so a sync that dies half-way keeps what it got and
    one unstorable game costs exactly that game. The counters and the error list are
    written back to the job after each one, which is what makes a long sync's progress
    visible to anything reading the row.

    `analyze=False` stores the games and stops there — no quick pass is queued, and the
    owner asks for one later over the games they care about. `presume_owner=False` says the
    stream is somebody else's games — see `ingest_game`.
    """
    if job.id is None:
        session.add(job)
        session.commit()
    if accounts is None:
        accounts = AccountIndex.load(session)

    result = ImportResult()
    for item in games:
        result.seen += 1
        if isinstance(item, ImportFailure):
            _record_failure(result, item.ref, item.error)
            event = _game_event(job, item.ref, GAME_FAILED, result, error=item.error)
        else:
            try:
                outcome = ingest_game(
                    session, job, item, accounts, analyze=analyze, presume_owner=presume_owner
                )
            except Exception as exc:
                session.rollback()
                error = f"{type(exc).__name__}: {exc}"
                _record_failure(result, item.reference, error)
                event = _game_event(job, item.reference, GAME_FAILED, result, error=error)
            else:
                if outcome.blocked:
                    result.blocked += 1
                    status = GAME_BLOCKED
                elif outcome.created:
                    result.imported += 1
                    status = GAME_IMPORTED
                else:
                    result.skipped += 1
                    status = GAME_SKIPPED
                event = _game_event(
                    job,
                    item.reference,
                    status,
                    result,
                    game_id=outcome.game.id if outcome.game is not None else None,
                )
        _apply(job, result)
        session.commit()
        _emit(progress, event)
    return result


def ingest_game(
    session: Session,
    job: ImportJob,
    parsed: ParsedGame,
    accounts: AccountIndex | None = None,
    *,
    analyze: bool = True,
    presume_owner: bool = True,
) -> IngestOutcome:
    """Store one parsed game, or report the one that is already there.

    Raises whatever the move list is wrong about — `ingest_games` turns that into a
    per-game error record. `analyze=False` skips the automatic quick pass; a game that was
    already stored never gets one either way, because this call did not create it.

    `presume_owner` is what a sync does: a game it brings is the owner's even when neither
    name resolves to an account yet, and reconciliation fills the side in later. A game
    fetched from the reference books is the opposite case — somebody else's unless an owner
    account is recognised in it — and passes False. A PGN upload is the one route that can
    be either, so the person uploading it says which.
    """
    if accounts is None:
        accounts = AccountIndex.load(session)

    digest = dedup_hash(parsed)
    # One question — "does the library know this game?" — asked once, over the games and
    # over the record of the ones the owner deleted. Asked here rather than in the adapters
    # so that every route in, a sync or a PGN or a paste, is answered on the same terms.
    known = games_service.identify(session, parsed.source, parsed.source_id, digest)
    if known.game is not None:
        return IngestOutcome(game=known.game, created=False)
    if known.deleted is not None:
        return IngestOutcome(game=None, created=False, blocked=True)

    rows = position_rows(parsed)
    # A source that names the opening itself (Lichess, chess.com) is believed as it is. One
    # that does not — a PGN without ECO tags, a masters game — is named from the vendored
    # book by the deepest position on the game's line the book knows, which is the same
    # rule the explorer names positions by, so the two never disagree about a game.
    eco, opening_name = parsed.eco, parsed.opening_name
    if not eco and not opening_name:
        named = openings.deepest([row[0] for row in rows])
        if named is not None:
            eco, opening_name = named.eco, named.name
    white_account, white_is_owner = accounts.match(parsed.source, parsed.white_name)
    black_account, black_is_owner = accounts.match(parsed.source, parsed.black_name)
    owner_color: Color | None = None
    if white_is_owner:
        owner_color = Color.WHITE
    elif black_is_owner:
        owner_color = Color.BLACK

    game = Game(
        source=parsed.source,
        source_id=parsed.source_id,
        dedup_hash=digest,
        white_name=parsed.white_name,
        black_name=parsed.black_name,
        white_rating=parsed.white_rating,
        black_rating=parsed.black_rating,
        white_account_id=white_account,
        black_account_id=black_account,
        owner_color=owner_color,
        is_owner_game=presume_owner or owner_color is not None,
        result=parsed.result,
        termination=parsed.termination,
        variant=parsed.variant,
        rated=parsed.rated,
        speed=parsed.speed,
        time_control=parsed.time_control,
        initial_clock=parsed.initial_clock,
        increment=parsed.increment,
        eco=eco,
        opening_name=opening_name,
        played_at=parsed.played_at,
        pgn=parsed.pgn,
        moves_uci=list(parsed.moves_uci),
        moves_san=list(parsed.moves_san),
        clocks=list(parsed.clocks) if parsed.clocks else None,
        ply_count=len(parsed.moves_uci),
        import_job_id=job.id,
    )
    session.add(game)
    session.flush()

    store_positions(session, game, rows)
    if analyze:
        enqueue_quick_analysis(session, game)
    return IngestOutcome(game=game, created=True)


def dedup_hash(parsed: ParsedGame) -> str:
    """A stable identity for a game that carries no source ID.

    Moves plus the calendar day plus both player names, which is what stays the same when
    the same game arrives twice by two routes — a PGN export of an already-synced Lichess
    game keeps all three even though its source and its source ID change.
    """
    day = parsed.played_at.date().isoformat() if parsed.played_at else ""
    material = "|".join(
        (
            fold(parsed.white_name),
            fold(parsed.black_name),
            day,
            " ".join(parsed.moves_uci),
        )
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def position_rows(parsed: ParsedGame) -> list[tuple[str, str, Color, str | None, str | None]]:
    """Replay the game into one row per position reached, the last one after the last move.

    The key is the normalised FEN — piece placement, side to move, castling rights and a
    legal en-passant square. The move and halfmove counters are deliberately dropped, so
    the same position reached by two move orders is one row.
    """
    # Imported here rather than at module scope: registration by path keeps `chess` out of
    # a process that only serves `/health`, and this is the one function that needs it.
    import chess
    import chess.polyglot

    chess960 = parsed.variant.lower() in CHESS960_VARIANTS
    if parsed.initial_fen:
        board = chess.Board(parsed.initial_fen, chess960=chess960)
    else:
        board = chess.Board(chess960=chess960)
    board.chess960 = board.chess960 or board.has_chess960_castling_rights()

    def key() -> tuple[str, str, Color]:
        side = Color.WHITE if board.turn else Color.BLACK
        return board.epd(), f"{chess.polyglot.zobrist_hash(board):016x}", side

    rows: list[tuple[str, str, Color, str | None, str | None]] = []
    for index, uci in enumerate(parsed.moves_uci):
        san = parsed.moves_san[index] if index < len(parsed.moves_san) else None
        rows.append((*key(), uci, san))
        board.push(board.parse_uci(uci))
    rows.append((*key(), None, None))
    return rows


def store_positions(
    session: Session,
    game: Game,
    rows: Sequence[tuple[str, str, Color, str | None, str | None]],
) -> None:
    """Insert the positions this game reached that are new, then the join rows in one go."""
    keys: dict[str, tuple[str, Color]] = {}
    for fen, zobrist, side, _uci, _san in rows:
        keys.setdefault(fen, (zobrist, side))

    stored: dict[str, int] = {}
    fens = list(keys)
    for start in range(0, len(fens), LOOKUP_CHUNK):
        chunk = fens[start : start + LOOKUP_CHUNK]
        found = session.execute(
            select(Position.fen, Position.id).where(Position.fen.in_(chunk))
        ).all()
        stored.update({fen: identifier for fen, identifier in found})

    missing = [
        Position(fen=fen, zobrist_key=zobrist, side_to_move=side)
        for fen, (zobrist, side) in keys.items()
        if fen not in stored
    ]
    if missing:
        session.add_all(missing)
        session.flush()
        stored.update({position.fen: position.id for position in missing})

    session.execute(
        insert(GamePosition),
        [
            {
                "game_id": game.id,
                "ply": ply,
                "position_id": stored[fen],
                "move_uci": uci,
                "move_san": san,
            }
            for ply, (fen, _zobrist, _side, uci, san) in enumerate(rows)
        ],
    )
    # A position one more game has reached counts one more game, so whatever the explorer
    # had folded about it is now short by this game. Inside the transaction that stored the
    # join rows, so nothing can read a book that disagrees with them.
    explorer_service.mark_positions_dirty(session, game.id)


def import_one(
    session: Session,
    parsed: ParsedGame,
    *,
    progress: ProgressHook | None = None,
    presume_owner: bool = True,
) -> IngestOutcome:
    """Store one game the owner asked for by name, under a job of its own.

    The "add this game" path, as opposed to a sync's stream: the game gets an `ImportJob`
    row like any other so its provenance reads the same in the library, the same events go
    out so the page refreshes the same way, and the quick pass is queued the same way.

    A tombstone for this game is forgotten first. A deletion exists to stop a *sync* from
    quietly bringing a game back; the owner naming the game and asking for it is the undo,
    and refusing them here would leave no way to ever have it again.

    A game that will not store is recorded on the job as a failure and re-raised: this is
    one game a person is waiting on, not a stream where one bad game must not stop the rest.
    """
    known = games_service.identify(session, parsed.source, parsed.source_id, dedup_hash(parsed))
    if known.deleted is not None:
        games_service.forget_deletions(session, [known.deleted.id])

    job = ImportJob(source=parsed.source, status=JobStatus.RUNNING, started_at=utcnow())
    session.add(job)
    session.commit()
    _emit(progress, {"event": EVENT_IMPORT_STARTED, **_job_fields(job), "at": _stamp()})

    result = ImportResult(seen=1)
    try:
        outcome = ingest_game(session, job, parsed, presume_owner=presume_owner)
    except Exception as exc:
        session.rollback()
        error = f"{type(exc).__name__}: {exc}"
        _record_failure(result, parsed.reference, error)
        _apply(job, result)
        job.status = JobStatus.FAILED
        job.message = error
        job.finished_at = utcnow()
        session.commit()
        _emit(progress, _game_event(job, parsed.reference, GAME_FAILED, result, error=error))
        _emit(progress, _finished_event(job))
        raise

    if outcome.created:
        result.imported = 1
        status = GAME_IMPORTED
    else:
        result.skipped = 1
        status = GAME_SKIPPED
    _apply(job, result)
    job.status = JobStatus.DONE
    job.finished_at = utcnow()
    session.commit()
    _emit(
        progress,
        _game_event(
            job,
            parsed.reference,
            status,
            result,
            game_id=outcome.game.id if outcome.game is not None else None,
        ),
    )
    _emit(progress, _finished_event(job))
    return outcome


def _finished_event(job: ImportJob) -> dict[str, Any]:
    return {
        "event": EVENT_IMPORT_FINISHED,
        **_job_fields(job),
        "status": str(job.status),
        **_counts(job),
        "message": job.message,
        "at": _stamp(),
    }


def enqueue_quick_analysis(session: Session, game: Game) -> AnalysisRun | None:
    """Queue the automatic quick pass over a freshly imported game.

    The run is built by `analysis.request_analysis`, so it lands in the queue with the
    node budget and priority the workers actually need — one enqueue path, one set of
    defaults, whether the pass was asked for by an import, the UI or the coach.

    No enabled engine to run it with means no run: an import must not fail because the
    engine list is empty, and a run pointing at nothing would only fail later. The commit
    is left to `ingest_games`, which owns the transaction this game is being written in.

    A configuration `request_analysis` refuses — a search engine and a Maia model on two
    different machines — is the same story: the games still import, and the refusal is
    logged rather than raised. An owner who asks for a pass by hand is told exactly why.
    """
    engine = quick_tier_engine(session)
    if engine is None:
        return None
    try:
        return analysis.request_analysis(
            session,
            game_id=game.id,
            tier=Tier.QUICK,
            engine_id=engine.id,
            commit=False,
        )
    except analysis.AnalysisRequestError as exc:
        logger.warning("game %s was imported without a quick pass: %s", game.id, exc)
        return None


def quick_tier_engine(session: Session) -> Engine | None:
    """The engine assigned to the quick tier, if it can run. None means no pass is queued."""
    return engines.engine_for_tier(session, Tier.QUICK)


def get_job(session: Session, job_id: int) -> ImportJob | None:
    """One import job with its counts and per-game errors."""
    return session.get(ImportJob, job_id)


def list_jobs(
    session: Session, source: str | None = None, limit: int = 50, offset: int = 0
) -> list[ImportJob]:
    """One page of the sync history, newest first, optionally for one source.

    `id` breaks the tie under `created_at` for the same reason the games table's order
    does: two jobs written in the same second must not swap places between one page and
    the next, which is how a page shows a row twice and hides another.
    """
    statement = select(ImportJob).order_by(ImportJob.created_at.desc(), ImportJob.id.desc())
    if source is not None:
        statement = statement.where(ImportJob.source == Source(source))
    return list(session.scalars(statement.limit(limit).offset(offset)))


def count_jobs(session: Session, source: str | None = None) -> int:
    """How many syncs the history holds, for the pager under it."""
    statement = select(func.count(ImportJob.id)).select_from(ImportJob)
    if source is not None:
        statement = statement.where(ImportJob.source == Source(source))
    return int(session.scalar(statement) or 0)


def latest_cursor(session: Session, source: str, account_id: int | None = None) -> str | None:
    """The cursor of the last successful sync of this source, for an incremental run."""
    statement = (
        select(ImportJob.cursor)
        .where(
            ImportJob.source == Source(source),
            ImportJob.status == JobStatus.DONE,
            ImportJob.cursor.is_not(None),
        )
        .order_by(ImportJob.created_at.desc(), ImportJob.id.desc())
    )
    if account_id is not None:
        statement = statement.where(ImportJob.account_id == account_id)
    return session.scalars(statement.limit(1)).first()


def _stamp() -> str:
    return utcnow().isoformat()


def _job_fields(job: ImportJob) -> dict[str, Any]:
    return {"job_id": job.id, "source": str(job.source)}


def _counts(job: ImportJob) -> dict[str, int]:
    return {
        "seen": job.games_seen,
        "imported": job.games_imported,
        "skipped": job.games_skipped,
        "blocked": job.games_blocked,
        "failed": job.games_failed,
    }


def _record_failure(result: ImportResult, ref: str, error: str) -> None:
    result.failed += 1
    result.errors.append({"ref": ref, "error": error})


def _game_event(
    job: ImportJob,
    ref: str,
    status: str,
    result: ImportResult,
    *,
    game_id: int | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    return {
        "event": EVENT_IMPORT_GAME,
        **_job_fields(job),
        "ref": ref,
        "status": status,
        "game_id": game_id,
        "error": error,
        "seen": result.seen,
        "imported": result.imported,
        "skipped": result.skipped,
        "blocked": result.blocked,
        "failed": result.failed,
    }


def _apply(job: ImportJob, result: ImportResult) -> None:
    job.games_seen = result.seen
    job.games_imported = result.imported
    job.games_skipped = result.skipped
    job.games_blocked = result.blocked
    job.games_failed = result.failed
    job.errors = list(result.errors)


def _emit(progress: ProgressHook | None, event: dict[str, Any]) -> None:
    """Hand one event to the subscriber. A subscriber must never be able to abort a sync."""
    if progress is None:
        return
    try:
        progress(event)
    except Exception:
        return

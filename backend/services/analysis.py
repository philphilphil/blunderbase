"""The analysis tier: what a run is, how it is queued, and what computing one means.

Three things live here and nothing else does:

- **The queue.** `AnalysisRun` rows *are* the queue, so it survives a restart with no
  broker in the picture. `claim_next_run` takes the highest-priority queued row with a
  conditional UPDATE rather than a lock, which is the one claim that is race-free on both
  SQLite and PostgreSQL. `requeue_stale_runs` is what a starting process calls to collect
  the rows a dead one left `running`.
- **The computation.** `build_plan` turns a run row into a database-free `RunPlan`, and
  `analyse_plan` turns that plus an engine adapter into a list of unattached `MoveEval`
  objects. Neither touches a Session, which is what lets the worker run them in a thread
  and commit the whole run in one transaction at the end (`complete_run`).
- **The events.** `subscribe` / `emit_run_event` is the lifecycle feed the WebSocket layer
  attaches to later. Events are plain dicts and are emitted from worker threads.

`backend/workers/` drives all of this; it owns the asyncio and the engine pool, and this
module owns every rule about what a run means.

**The attempt token.** Every claim writes a fresh `attempt_token` onto the row, and a
caller that did not claim the run itself — a remote runner handing a result back over a
socket it may have reconnected twice since — presents that token with its result. A
payload for a run that has moved on, because the stale sweep took it away or because the
answer is a duplicate, therefore fails `guard_attempt` and is dropped with a log line
rather than overwriting the retry that is already running. Local callers pass no token and
behave exactly as they did before this existed.
"""

from __future__ import annotations

import hmac
import logging
import math
import secrets
import threading
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import delete, func, select, update
from sqlalchemy import event as sa_event
from sqlalchemy.orm import Session

from backend.config import MAIA_MAX_RATING, MAIA_MIN_RATING, Settings, get_settings
from backend.db.enums import Classification, Color, EngineKind, RunStatus, Tier
from backend.db.models import AnalysisRun, Engine, Game, GamePosition, MoveEval, Position
from backend.db.types import utcnow
from backend.services import app_settings as app_settings_service
from backend.services import engines as engines_service

if TYPE_CHECKING:  # pragma: no cover - typing only
    import chess

    from backend.adapters.maia import MaiaAdapter
    from backend.adapters.stockfish import Score, StockfishAdapter

# Deep runs jump the FIFO queue: someone is waiting on them.
QUICK_PRIORITY = 0
DEEP_PRIORITY = 10
MAX_ATTEMPTS = 2

# Lichess's win-percentage curve: win% = 50 + 50 * (2 / (1 + exp(-K * cp)) - 1), with the
# centipawn score clamped first so that +12 and +30 are not two different kinds of winning.
WIN_PERCENT_K = 0.00368208
CP_CLAMP = 1000
# A mate in N is worth (21 - min(10, N)) pawns on that same curve.
MATE_CP_BASE = 21
MATE_CP_CAP = 10

# How many moves Maia is asked for per position. The predicted move is the first; the rest
# are what makes "and a 1700 would have considered" answerable — and what gives the human
# column of the game panel the same depth as Stockfish's (`DEFAULT_MULTIPV = 5`).
MAIA_POLICY_MOVES = 5
SELF_ELO = "SelfElo"

STALE_RUN_MESSAGE = "the process running this pass stopped before it finished"

# 16 random bytes as 32 hex characters, written by every claim. Long enough that two
# attempts at the same run never collide, short enough to sit in a String(32).
ATTEMPT_TOKEN_BYTES = 16

# How long a `running` row may go without a heartbeat before a starting worker set treats
# it as abandoned. Generous next to `HEARTBEAT_SECONDS` in `backend/workers`: a live worker
# beats several times inside it, and taking a run off one that is still working would mean
# two processes searching the same game.
STALE_AFTER_SECONDS = 60.0

EVENT_RUN_QUEUED = "analysis.queued"
EVENT_RUN_STARTED = "analysis.running"
EVENT_RUN_PROGRESS = "analysis.progress"
EVENT_RUN_DONE = "analysis.done"
EVENT_RUN_FAILED = "analysis.failed"

# One progress event every this many analysed positions, plus one at the end. A run of a
# hundred positions should tell a UI it is moving without flooding a socket.
PROGRESS_EVERY = 8

logger = logging.getLogger(__name__)


class AnalysisError(RuntimeError):
    """Anything the analysis surface has to report instead of a stack trace."""


class AnalysisRequestError(AnalysisError, ValueError):
    """The request itself is wrong: no target, two targets, a bad FEN, a bad ply range."""


class UnknownRunError(AnalysisError, LookupError):
    """No run with that id."""


class StaleResultError(AnalysisError):
    """A result for a run that has moved on: the wrong attempt, or no longer running."""

    def __init__(self, run_id: int, expected: str | None, presented: str | None) -> None:
        super().__init__(
            f"the result for run {run_id} is for an attempt that is over; it was dropped"
        )
        self.run_id = run_id
        self.expected = expected
        self.presented = presented


# A lifecycle subscriber. Called from whichever thread reached the transition, so a
# subscriber that owns an event loop has to bounce the event onto it itself.
RunEventHook = Callable[[dict[str, Any]], None]

_SUBSCRIBERS: list[RunEventHook] = []
_SUBSCRIBER_LOCK = threading.Lock()


def subscribe(hook: RunEventHook) -> Callable[[], None]:
    """Receive every run lifecycle event. Returns the callable that unsubscribes it."""
    with _SUBSCRIBER_LOCK:
        _SUBSCRIBERS.append(hook)

    def cancel() -> None:
        unsubscribe(hook)

    return cancel


def unsubscribe(hook: RunEventHook) -> None:
    with _SUBSCRIBER_LOCK:
        if hook in _SUBSCRIBERS:
            _SUBSCRIBERS.remove(hook)


def clear_subscribers() -> None:
    """Drop every subscriber. Tests and a shutting-down process call this."""
    with _SUBSCRIBER_LOCK:
        _SUBSCRIBERS.clear()


def emit_run_event(event: dict[str, Any]) -> None:
    """Hand one event to every subscriber. A subscriber must never be able to fail a run."""
    with _SUBSCRIBER_LOCK:
        hooks = list(_SUBSCRIBERS)
    for hook in hooks:
        try:
            hook(event)
        except Exception:
            continue


# Events buffered on a Session until whoever owns its transaction commits.
_PENDING_EVENTS = "blunderbase_pending_run_events"


def emit_on_commit(session: Session, event: dict[str, Any]) -> None:
    """Publish `event` when this session's transaction commits, and never if it rolls back.

    A run that is enqueued inside someone else's transaction — the import pipeline queues
    the quick pass as part of storing the game — is not a run yet. Announcing it before the
    commit hands the UI a run id that a rolled-back import never created.
    """
    pending = session.info.get(_PENDING_EVENTS)
    if pending is None:
        pending = session.info[_PENDING_EVENTS] = []
        sa_event.listen(session, "after_commit", _flush_pending)
        sa_event.listen(session, "after_soft_rollback", _drop_pending)
    pending.append(event)


def _flush_pending(session: Session) -> None:
    # The listeners stay on the session for its lifetime: removing one from inside the
    # dispatch that is calling it mutates the list being iterated. The buffer is emptied
    # instead, so a session that queues nothing again dispatches nothing.
    pending: list[dict[str, Any]] = session.info.get(_PENDING_EVENTS) or []
    events = list(pending)
    pending.clear()
    for event in events:
        emit_run_event(event)


def _drop_pending(session: Session, _previous: Any) -> None:
    pending: list[dict[str, Any]] | None = session.info.get(_PENDING_EVENTS)
    if pending is not None:
        pending.clear()


@dataclass(frozen=True, slots=True)
class Thresholds:
    """Win-percentage points lost by the mover, above which a move earns a name."""

    inaccuracy: float
    mistake: float
    blunder: float

    @classmethod
    def from_settings(cls, settings: Settings | None = None) -> Thresholds:
        resolved = settings or get_settings()
        return cls(
            inaccuracy=resolved.inaccuracy_threshold,
            mistake=resolved.mistake_threshold,
            blunder=resolved.blunder_threshold,
        )


@dataclass(frozen=True, slots=True)
class RunPlan:
    """Everything one pass needs, with no Session and no ORM object in sight.

    The worker builds this on the database thread and then hands it to an engine thread,
    so every field is a plain value that can cross that boundary safely.
    """

    run_id: int
    tier: Tier
    game_id: int | None
    fen: str | None
    variant: str
    initial_fen: str | None
    moves_uci: tuple[str, ...]
    moves_san: tuple[str | None, ...]
    # Position row id per ply, indexed by ply. None where the position is not stored.
    position_ids: tuple[int | None, ...]
    ply_start: int
    ply_end: int
    nodes: int
    depth: int | None
    multipv: int
    thresholds: Thresholds
    owner_color: Color | None = None
    owner_rating: int | None = None
    maia_offsets: tuple[int, ...] = ()
    # The one level every Maia question in this run is asked at, when the deployment
    # configures one. It replaces `maia_offsets` and `owner_rating` for the human-move
    # pass; None is the original rating-centred behaviour.
    maia_target_elo: int | None = None

    @property
    def plies(self) -> range:
        """The moves this run classifies."""
        return range(self.ply_start, self.ply_end)

    @property
    def is_position_run(self) -> bool:
        """A run over a bare FEN: one position, no move to judge."""
        return self.game_id is None

    @property
    def positions(self) -> range:
        """The positions this run evaluates — one more than the moves it classifies."""
        if self.is_position_run:
            return range(0, 1)
        return range(self.ply_start, self.ply_end + 1)

    def maia_plies(self) -> list[int]:
        """The plies Maia is asked about: the owner's own moves where one is known.

        Maia answers "what would a human of this rating have played" — a question about
        the owner, so their opponent's moves are not worth the second engine pass. With no
        owner on the game (an OTB PGN, a stranger's game) every move is fair game.

        A configured target elo widens that to every ply of both sides. The second half of
        what Maia is for is "what will a human opposite me actually fall into", which is a
        question about the positions the *opponent* moves in — and the cost is a wash,
        because a target elo is also one level where the offsets were three.
        """
        if self.is_position_run:
            return [self.ply_start]
        if self.owner_color is None or self.maia_target_elo is not None:
            return list(self.plies)
        white = self.owner_color is Color.WHITE
        return [ply for ply in self.plies if (ply % 2 == 0) == white]


# --- win percentage and classification ------------------------------------


def winning_chances(cp: int | None, mate: int | None) -> float:
    """-1 (lost) .. +1 (won), from the point of view the score is given in."""
    if mate is not None:
        magnitude = (MATE_CP_BASE - min(MATE_CP_CAP, abs(mate))) * 100
        # `mate` is 0 both for "is mated" and for "has mated"; only the folded centipawn
        # score carries the sign in that case, which is why it is stored alongside.
        sign = 1 if mate > 0 else -1 if mate < 0 else (1 if (cp or 0) >= 0 else -1)
        return _raw_chances(sign * magnitude)
    if cp is None:
        return 0.0
    return _raw_chances(max(-CP_CLAMP, min(CP_CLAMP, cp)))


def win_percent(cp: int | None, mate: int | None) -> float:
    """0..100: how often the side the score belongs to wins from here."""
    return round(50.0 + 50.0 * winning_chances(cp, mate), 2)


def classify_move(win_loss: float, *, played_best: bool, thresholds: Thresholds) -> Classification:
    """Name a move by the win percentage it gave away.

    Playing the engine's own first choice is checked first: a top move that still shows a
    large drop is search disagreeing with itself between two depths, not a blunder.
    """
    if played_best:
        return Classification.BEST
    if win_loss >= thresholds.blunder:
        return Classification.BLUNDER
    if win_loss >= thresholds.mistake:
        return Classification.MISTAKE
    if win_loss >= thresholds.inaccuracy:
        return Classification.INACCURACY
    return Classification.GOOD


def maia_levels(
    rating: int | None,
    offsets: Sequence[int],
    *,
    low: int = MAIA_MIN_RATING,
    high: int = MAIA_MAX_RATING,
    default: int = 1500,
    target: int | None = None,
) -> list[int]:
    """The rating levels to ask Maia about, clamped to what the model can answer.

    A `target` is the whole answer on its own: one configured level, the same one for
    every game, which is what makes two games comparable at all. The rating and the
    offsets are then not consulted — a spread around the rating someone *has* is exactly
    the thing a target elo replaces.
    """
    if target is not None:
        return [min(high, max(low, int(target)))]
    base = int(rating if rating is not None else default)
    levels = {min(high, max(low, base + int(offset))) for offset in (offsets or (0,))}
    return sorted(levels)


def _raw_chances(cp: float) -> float:
    return 2.0 / (1.0 + math.exp(-WIN_PERCENT_K * cp)) - 1.0


# --- enqueueing -----------------------------------------------------------


def request_analysis(
    session: Session,
    *,
    game_id: int | None = None,
    fen: str | None = None,
    tier: Tier = Tier.QUICK,
    ply_range: tuple[int, int] | None = None,
    engine_id: int | None = None,
    multipv: int | None = None,
    nodes: int | None = None,
    depth: int | None = None,
    priority: int | None = None,
    settings: Settings | None = None,
    commit: bool = True,
) -> AnalysisRun:
    """Enqueue one pass. Exactly one of `game_id` and `fen` must be given.

    Re-analysis is always a new run; existing runs are never overwritten.

    The engine is resolved now so the row records which engine was meant, but its binary
    is not checked here: enqueueing must stay a cheap write, and a binary that has gone
    missing is the worker's problem to report on the run it fails.

    The one thing that *is* checked is where the engines live. A run's evaluation and its
    human-move passes happen in one process on one machine, so a search engine on a host
    with no Maia is refused here when the deployment's only Maia is somewhere else — see
    `_require_one_host`.
    """
    resolved = settings or get_settings()
    tier = Tier(tier)
    if (game_id is None) == (fen is None):
        raise AnalysisRequestError("a run analyses exactly one of a game or a FEN")

    window: tuple[int, int] | None = None
    if game_id is not None:
        game = session.get(Game, game_id)
        if game is None:
            raise AnalysisRequestError(f"no game with id {game_id}")
        window = ply_window(game.ply_count, ply_range)
    else:
        fen = normalise_fen(fen)
        if ply_range is not None:
            raise AnalysisRequestError("a run over a FEN has no ply range")

    engine = _resolve_engine(session, tier, engine_id)
    _require_one_host(session, engine)
    run = AnalysisRun(
        game_id=game_id,
        fen=fen,
        engine_id=engine.id,
        tier=tier,
        status=RunStatus.QUEUED,
        nodes=nodes if nodes is not None else _default_nodes(tier, resolved),
        depth=depth,
        multipv=max(1, multipv if multipv is not None else _default_multipv(tier, resolved)),
        ply_start=None if window is None else window[0],
        ply_end=None if window is None else window[1],
        priority=priority if priority is not None else default_priority(tier),
    )
    session.add(run)
    session.flush()
    emit_on_commit(session, run_event(EVENT_RUN_QUEUED, run))
    if commit:
        session.commit()
    return run


def enqueue_missing(
    session: Session,
    tier: Tier = Tier.QUICK,
    *,
    limit: int | None = None,
    settings: Settings | None = None,
) -> list[AnalysisRun]:
    """Queue a full-game pass for every game that has no live run of this tier.

    "Live" means queued, running or done: a run that failed twice is not retried by a
    batch command, because whatever is wrong with it will still be wrong.
    """
    covered = (
        select(AnalysisRun.game_id)
        .where(
            AnalysisRun.game_id.is_not(None),
            AnalysisRun.tier == Tier(tier),
            AnalysisRun.status != RunStatus.FAILED,
            AnalysisRun.ply_start.is_(None),
            AnalysisRun.ply_end.is_(None),
        )
        .scalar_subquery()
    )
    statement = select(Game.id).where(Game.id.not_in(covered)).order_by(Game.id)
    if limit:
        statement = statement.limit(limit)
    pending = list(session.scalars(statement))

    queued = [
        request_analysis(session, game_id=game_id, tier=tier, settings=settings, commit=False)
        for game_id in pending
    ]
    if queued:
        session.commit()
    return queued


def ply_window(ply_count: int, ply_range: tuple[int, int] | None) -> tuple[int, int] | None:
    """Validate and clamp a ply range against a game, or None for the whole game.

    None is not the same as `(0, ply_count)`: a full-game run stores NULL bounds, which is
    what lets the stats layer tell a whole pass from a deep look at one phase.
    """
    if ply_range is None:
        return None
    start, end = (int(ply_range[0]), int(ply_range[1]))
    start = max(0, start)
    end = min(ply_count, end)
    if start >= end:
        raise AnalysisRequestError(
            f"ply range {ply_range} is empty for a game of {ply_count} plies"
        )
    return start, end


def normalise_fen(fen: str | None) -> str:
    """The EPD form of a FEN — the same key the position table stores.

    Read through the explorer's reader, so that a position the coach found by FEN is a
    position it can also ask for a pass over: chess960 castling rights and all.
    """
    from backend.services.explorer import normalize_fen

    text = (fen or "").strip()
    try:
        epd, _zobrist, _side = normalize_fen(text)
    except ValueError as exc:
        raise AnalysisRequestError(f"{text!r} is not a valid FEN: {exc}") from exc
    return epd


def default_priority(tier: Tier) -> int:
    return DEEP_PRIORITY if Tier(tier) is Tier.DEEP else QUICK_PRIORITY


def _default_nodes(tier: Tier, settings: Settings) -> int:
    return settings.deep_nodes if tier is Tier.DEEP else settings.quick_nodes


def _default_multipv(tier: Tier, settings: Settings) -> int:
    return settings.deep_multipv if tier is Tier.DEEP else 1


def _require_one_host(session: Session, engine: Engine) -> None:
    """Refuse a run whose two engine passes would have to happen on different machines.

    A run is one process's worth of work: `analyse_plan` searches, then `apply_maia` asks
    the human-move model about the same boards, and both hold the same slot on the same
    host. Nothing in an analysis request can say "this Stockfish and that Maia", so a
    mismatch is a deployment that has been configured into a corner, and the honest place
    to say so is here — at enqueue, naming both machines — rather than on a run that
    finishes hours later with the human-move half silently missing.
    """
    stranded = engines_service.stranded_maia(session, engine)
    if stranded is None:
        return
    raise AnalysisRequestError(
        f"a run's engine and its Maia model must be on one machine: {engine.name!r} is on "
        f"{engines_service.engine_host(session, engine)} and the only human-move model, "
        f"{stranded.name!r}, is on {engines_service.engine_host(session, stranded)}. "
        f"Install a Maia there, or disable {stranded.name!r}."
    )


def _resolve_engine(session: Session, tier: Tier, engine_id: int | None) -> Engine:
    if engine_id is not None:
        return engines_service.require_engine(session, engine_id)
    engine = engines_service.engine_for_tier(session, tier)
    if engine is None:
        status = engines_service.tier_status(session, tier)
        raise engines_service.TierUnavailableError(tier, status.reason or "no engine")
    return engine


# --- queue ----------------------------------------------------------------


def get_run(session: Session, run_id: int) -> AnalysisRun | None:
    """One run with its status and timestamps."""
    return session.get(AnalysisRun, run_id)


def require_run(session: Session, run_id: int) -> AnalysisRun:
    run = get_run(session, run_id)
    if run is None:
        raise UnknownRunError(f"no analysis run with id {run_id}")
    return run


def list_runs(session: Session, game_id: int, tier: Tier | None = None) -> list[AnalysisRun]:
    """Every run over a game, newest first."""
    statement = (
        select(AnalysisRun)
        .where(AnalysisRun.game_id == game_id)
        .order_by(AnalysisRun.created_at.desc(), AnalysisRun.id.desc())
    )
    if tier is not None:
        statement = statement.where(AnalysisRun.tier == Tier(tier))
    return list(session.scalars(statement))


def queue_depth(session: Session) -> dict[str, int]:
    """How much work is outstanding, for the dashboard's queue widget."""
    rows = session.execute(
        select(AnalysisRun.status, func.count())
        .where(AnalysisRun.status.in_([RunStatus.QUEUED, RunStatus.RUNNING]))
        .group_by(AnalysisRun.status)
    ).all()
    counts = {str(status): int(total) for status, total in rows}
    return {
        "queued": counts.get(str(RunStatus.QUEUED), 0),
        "running": counts.get(str(RunStatus.RUNNING), 0),
    }


def claim_next_run(
    session: Session,
    *,
    engine_ids: Sequence[int] | None = None,
    exclude_engine_ids: Sequence[int] | None = None,
) -> AnalysisRun | None:
    """Take the highest-priority queued run and mark it running, or return None if idle.

    The claim is a conditional UPDATE rather than a `SELECT … FOR UPDATE`, because SQLite
    has no row locks at all and the same statement has to be correct on both back ends: a
    second worker's UPDATE simply matches no row and it looks at the next candidate.

    The two filters are how one queue serves several kinds of worker. `engine_ids` narrows
    the claim to the engines one runner advertises; `exclude_engine_ids` is what a local
    worker set uses to leave the remote half of the queue alone. A run with no engine at
    all is nobody's in particular, so it stays claimable under an exclusion and is not
    claimable under an inclusion — the local fallback at `_prepare` time is what will end
    up serving it.
    """
    if engine_ids is not None and not list(engine_ids):
        return None
    while True:
        statement = (
            select(AnalysisRun.id)
            .where(AnalysisRun.status == RunStatus.QUEUED)
            .order_by(
                AnalysisRun.priority.desc(), AnalysisRun.created_at.asc(), AnalysisRun.id.asc()
            )
            .limit(1)
        )
        if engine_ids is not None:
            statement = statement.where(AnalysisRun.engine_id.in_(list(engine_ids)))
        if exclude_engine_ids:
            statement = statement.where(
                (AnalysisRun.engine_id.is_(None))
                | (AnalysisRun.engine_id.not_in(list(exclude_engine_ids)))
            )
        candidate = session.scalars(statement).first()
        if candidate is None:
            return None
        claimed = session.execute(
            update(AnalysisRun)
            .where(AnalysisRun.id == candidate, AnalysisRun.status == RunStatus.QUEUED)
            .values(
                status=RunStatus.RUNNING,
                started_at=utcnow(),
                heartbeat_at=utcnow(),
                finished_at=None,
                attempts=AnalysisRun.attempts + 1,
                attempt_token=secrets.token_hex(ATTEMPT_TOKEN_BYTES),
            )
        )
        session.commit()
        if claimed.rowcount != 1:
            continue
        run = session.get(AnalysisRun, candidate)
        if run is None:
            continue
        session.refresh(run)
        emit_run_event(run_event(EVENT_RUN_STARTED, run))
        return run


def heartbeat_runs(session: Session, run_ids: Sequence[int]) -> None:
    """Say that these runs are still being worked on. Called by their worker while it runs."""
    if not run_ids:
        return
    session.execute(
        update(AnalysisRun)
        .where(AnalysisRun.id.in_(list(run_ids)), AnalysisRun.status == RunStatus.RUNNING)
        .values(heartbeat_at=utcnow())
    )
    session.commit()


def guard_attempt(session: Session, run_id: int, attempt_token: str) -> AnalysisRun:
    """The run this token still owns, or `StaleResultError` because it does not.

    A row claimed before the token column existed has none, and cannot be vouched for
    either way; the conservative answer is the safe one, because the only caller that
    presents a token is one the server dispatched to and therefore did claim.
    """
    run = require_run(session, run_id)
    _require_attempt(run, attempt_token)
    return run


def heartbeat_run(session: Session, run_id: int, attempt_token: str) -> bool:
    """Say one remote run is still being worked on. False means it is not yours any more.

    One conditional UPDATE, so the answer and the write are the same statement: a runner
    whose run was collected by the stale sweep learns it on its next beat rather than at
    the end of a search nobody is waiting for.
    """
    touched = session.execute(
        update(AnalysisRun)
        .where(
            AnalysisRun.id == run_id,
            AnalysisRun.status == RunStatus.RUNNING,
            AnalysisRun.attempt_token == attempt_token,
        )
        .values(heartbeat_at=utcnow())
    )
    session.commit()
    return touched.rowcount == 1


def _require_attempt(run: AnalysisRun, attempt_token: str | None) -> None:
    """Refuse a result for an attempt that is over. Nothing is written on the way out.

    The line names the token that was presented and never the one on the row: the row's is
    the live capability guarding the attempt that is running *now*, and anyone who can make
    this line be written is by definition someone who does not have it.
    """
    if attempt_token is None:
        return
    if run.status is RunStatus.RUNNING and _same_token(run.attempt_token, attempt_token):
        return
    logger.info(
        "dropped a result for run %s: it is %s, and attempt %r is not the one that owns it",
        run.id,
        run.status.value,
        attempt_token,
    )
    raise StaleResultError(run.id, run.attempt_token, attempt_token)


def _same_token(expected: str | None, presented: str) -> bool:
    """Constant-time, and a row with no token matches nothing."""
    if not expected:
        return False
    return hmac.compare_digest(expected, presented)


def requeue_stale_runs(
    session: Session, *, stale_after: float = STALE_AFTER_SECONDS
) -> list[AnalysisRun]:
    """Collect the runs a dead process left `running`; called when one starts.

    Only the ones that have stopped saying they are alive: a second worker set — the owner
    running `blunderbase analyze` while the server is up — must take nothing off the first,
    because both would then search the same game and each theft would spend an attempt on a
    run that never failed.

    A run whose retry is already spent is failed rather than queued again, so a pass that
    takes the engine down with it cannot survive restarts forever.
    """
    cutoff = utcnow() - timedelta(seconds=stale_after)
    stale = list(
        session.scalars(
            select(AnalysisRun).where(
                AnalysisRun.status == RunStatus.RUNNING,
                (AnalysisRun.heartbeat_at.is_(None)) | (AnalysisRun.heartbeat_at < cutoff),
            )
        )
    )
    for run in stale:
        run.error = STALE_RUN_MESSAGE
        run.heartbeat_at = None
        if run.attempts >= MAX_ATTEMPTS:
            run.status = RunStatus.FAILED
            run.finished_at = utcnow()
        else:
            run.status = RunStatus.QUEUED
            run.started_at = None
    if stale:
        session.commit()
    for run in stale:
        event = EVENT_RUN_QUEUED if run.status is RunStatus.QUEUED else EVENT_RUN_FAILED
        emit_run_event(run_event(event, run, error=run.error, requeued=True))
    return stale


def complete_run(
    session: Session,
    run: AnalysisRun,
    evals: Sequence[MoveEval],
    *,
    attempt_token: str | None = None,
) -> None:
    """Store a whole run's MoveEvals and mark it done in one commit.

    Buffering to the end of the run is what keeps SQLite's single-writer model a
    non-issue: the write lock is held for milliseconds, not for the length of the search.

    `attempt_token` is what a caller that did not claim the run itself presents. Given one,
    the run has to still be running under it or nothing at all is written; without one —
    the local worker, which holds the run for the length of its own search — this behaves
    exactly as it always has.
    """
    _require_attempt(run, attempt_token)
    session.execute(delete(MoveEval).where(MoveEval.run_id == run.id))
    for row in evals:
        row.run_id = run.id
    session.add_all(list(evals))
    run.status = RunStatus.DONE
    run.finished_at = utcnow()
    run.error = None
    run.stderr = None
    session.commit()
    emit_run_event(run_event(EVENT_RUN_DONE, run, evals=len(evals)))


def fail_run(
    session: Session,
    run: AnalysisRun,
    error: str,
    stderr: str | None = None,
    *,
    retry: bool = True,
    attempt_token: str | None = None,
) -> RunStatus:
    """Mark a run failed with the engine's stderr, releasing its slot. One retry follows.

    The first failure puts the run back in the queue with its error still on it, so the
    UI can show what went wrong while the retry is pending; the second gives up. Either
    way the game stays browsable with whatever tiers it already has.

    `attempt_token` guards exactly as it does in `complete_run`: a failure reported by a
    runner whose run was already taken away must not fail the attempt that replaced it.
    """
    _require_attempt(run, attempt_token)
    run.error = error
    run.stderr = stderr
    will_retry = retry and run.attempts < MAX_ATTEMPTS
    if will_retry:
        run.status = RunStatus.QUEUED
        run.started_at = None
    else:
        run.status = RunStatus.FAILED
        run.finished_at = utcnow()
    session.commit()
    emit_run_event(
        run_event(EVENT_RUN_FAILED, run, error=error, stderr=stderr, will_retry=will_retry)
    )
    return run.status


def abandon_run(
    session: Session,
    run: AnalysisRun,
    *,
    reason: str = STALE_RUN_MESSAGE,
    refund_attempt: bool = True,
) -> bool:
    """Give a running run back to the queue rather than stranding it. Was there one to give?

    With its attempt refunded by default: a worker that was cancelled, or a runner whose
    socket dropped, did not fail the pass — it had it taken away mid-search. Counting that
    against the retry budget would let two restarts during one long deep run mark it
    permanently failed with no engine ever having crashed.
    """
    if run.status is not RunStatus.RUNNING:
        return False
    run.status = RunStatus.QUEUED
    run.started_at = None
    run.heartbeat_at = None
    if refund_attempt:
        run.attempts = max(0, run.attempts - 1)
    run.error = reason
    session.commit()
    emit_run_event(run_event(EVENT_RUN_QUEUED, run))
    return True


def note_run(session: Session, run: AnalysisRun, message: str) -> None:
    """Record something that degraded the run without failing it — a missing Maia, say."""
    run.error = message
    session.commit()


def run_event(event: str, run: AnalysisRun, **extra: Any) -> dict[str, Any]:
    """One lifecycle event. Every event carries the same identity fields."""
    return {
        "event": event,
        "run_id": run.id,
        "game_id": run.game_id,
        "fen": run.fen,
        "tier": str(run.tier),
        "status": str(run.status),
        "engine_id": run.engine_id,
        "priority": run.priority,
        "attempts": run.attempts,
        "at": utcnow().isoformat(),
        **extra,
    }


def progress_event(plan: RunPlan, done: int, total: int) -> dict[str, Any]:
    """Emitted while a run is working; the run row itself is unchanged."""
    return {
        "event": EVENT_RUN_PROGRESS,
        "run_id": plan.run_id,
        "game_id": plan.game_id,
        "tier": str(plan.tier),
        "status": str(RunStatus.RUNNING),
        "done": done,
        "total": total,
        "at": utcnow().isoformat(),
    }


# --- planning -------------------------------------------------------------


def build_plan(session: Session, run: AnalysisRun, settings: Settings | None = None) -> RunPlan:
    """Read everything one pass needs out of the database, once."""
    resolved = settings or get_settings()
    thresholds = Thresholds.from_settings(resolved)
    offsets = tuple(resolved.maia_rating_offsets)
    # An app setting rather than a variable, so it is read per plan: a run queued after the
    # owner changed it on the Settings page is analysed at the level they chose.
    target_elo = app_settings_service.get_maia_target_elo(session)

    if run.game_id is None:
        fen = run.fen or ""
        position_id = session.scalar(select(Position.id).where(Position.fen == fen))
        return RunPlan(
            run_id=run.id,
            tier=run.tier,
            game_id=None,
            fen=fen,
            variant="standard",
            initial_fen=fen,
            moves_uci=(),
            moves_san=(),
            position_ids=(position_id,),
            ply_start=0,
            ply_end=0,
            nodes=run.nodes or resolved.quick_nodes,
            depth=run.depth,
            multipv=max(1, run.multipv),
            thresholds=thresholds,
            owner_rating=resolved.default_owner_rating,
            maia_offsets=offsets,
            maia_target_elo=target_elo,
        )

    game = session.get(Game, run.game_id)
    if game is None:
        raise AnalysisRequestError(f"no game with id {run.game_id}")

    ply_start = run.ply_start if run.ply_start is not None else 0
    ply_end = run.ply_end if run.ply_end is not None else game.ply_count
    ply_start = max(0, min(ply_start, game.ply_count))
    ply_end = max(ply_start, min(ply_end, game.ply_count))

    stored = dict(
        session.execute(
            select(GamePosition.ply, GamePosition.position_id).where(
                GamePosition.game_id == game.id
            )
        ).all()
    )
    position_ids = tuple(stored.get(ply) for ply in range(game.ply_count + 1))
    initial_fen = session.scalar(
        select(Position.fen)
        .join(GamePosition, GamePosition.position_id == Position.id)
        .where(GamePosition.game_id == game.id, GamePosition.ply == 0)
    )
    moves_san = tuple(
        (game.moves_san[index] if index < len(game.moves_san) else None)
        for index in range(len(game.moves_uci))
    )

    return RunPlan(
        run_id=run.id,
        tier=run.tier,
        game_id=game.id,
        fen=None,
        variant=game.variant,
        initial_fen=initial_fen,
        moves_uci=tuple(game.moves_uci),
        moves_san=moves_san,
        position_ids=position_ids,
        ply_start=ply_start,
        ply_end=ply_end,
        nodes=run.nodes or resolved.quick_nodes,
        depth=run.depth,
        multipv=max(1, run.multipv),
        thresholds=thresholds,
        owner_color=game.owner_color,
        owner_rating=owner_rating(game, resolved),
        maia_offsets=offsets,
        maia_target_elo=target_elo,
    )


def owner_rating(game: Game, settings: Settings | None = None) -> int:
    """The rating Maia's levels are centred on: the owner's, else the configured default."""
    resolved = settings or get_settings()
    if game.owner_color is Color.WHITE and game.white_rating:
        return int(game.white_rating)
    if game.owner_color is Color.BLACK and game.black_rating:
        return int(game.black_rating)
    return resolved.default_owner_rating


# --- computing a run ------------------------------------------------------


def analyse_plan(
    plan: RunPlan,
    adapter: StockfishAdapter,
    *,
    progress: Callable[[int, int], None] | None = None,
) -> list[MoveEval]:
    """Evaluate every position of a plan and turn it into unattached `MoveEval` rows.

    Nothing here touches the database: the rows are buffered in memory and handed to
    `complete_run`, which writes them all in one transaction. That is the whole reason a
    long search never holds SQLite's single write lock.
    """
    import chess
    import chess.engine

    limit = chess.engine.Limit(nodes=plan.nodes, depth=plan.depth)
    wanted = list(plan.positions)
    boards = dict(replay(plan))
    scores: dict[int, Score] = {}
    candidates: dict[int, Any] = {}

    for done, ply in enumerate(wanted, 1):
        board = boards[ply]
        terminal = terminal_score(board)
        if terminal is not None:
            scores[ply] = terminal
        else:
            result = adapter.analyse(board, limit, multipv=plan.multipv)
            scores[ply] = result.score
            candidates[ply] = result
        if progress is not None and (done % PROGRESS_EVERY == 0 or done == len(wanted)):
            progress(done, len(wanted))

    if plan.is_position_run:
        return [_position_row(plan, boards[0], scores[0], candidates.get(0))]
    return [
        _move_row(plan, ply, boards[ply], scores, candidates.get(ply))
        for ply in plan.plies
        if ply in scores and (ply + 1) in scores
    ]


def apply_maia(plan: RunPlan, rows: Sequence[MoveEval], adapter: MaiaAdapter) -> int:
    """Add Maia's predicted human moves to the rows of the plies it is asked about.

    Runs after the evaluation pass rather than beside it: the two engines share one
    concurrency cap, and a worker that held a slot for Stockfish while waiting for one for
    Maia would deadlock the moment the cap is a single process.
    """
    levels = maia_levels(
        plan.owner_rating,
        plan.maia_offsets,
        target=plan.maia_target_elo,
        **maia_bounds(adapter),
    )
    if not adapter.supports_rating:
        # Fixed weights are one rating level; asking for three is a configuration error.
        levels = levels[:1]

    boards = dict(replay(plan))
    by_ply = {row.ply: row for row in rows}
    wanted = [ply for ply in plan.maia_plies() if ply in by_ply and ply in boards]
    for ply in wanted:
        policy = adapter.policy_at(boards[ply], levels, multipv=MAIA_POLICY_MOVES)
        by_ply[ply].maia_policy = {
            level: [move.as_dict() for move in moves] for level, moves in policy.items()
        }
    return len(wanted)


def replay(plan: RunPlan) -> Iterator[tuple[int, chess.Board]]:
    """Every position this plan needs, as its own board, keyed by ply.

    The moves before `ply_start` are still replayed — a ply range narrows what is
    evaluated, not what has to be walked to get there.
    """
    import chess

    from backend.services.import_service import CHESS960_VARIANTS

    if plan.is_position_run:
        yield 0, chess.Board(plan.fen or chess.STARTING_FEN)
        return

    chess960 = plan.variant.lower() in CHESS960_VARIANTS
    if plan.initial_fen:
        board = chess.Board(plan.initial_fen, chess960=chess960)
    else:
        board = chess.Board(chess960=chess960)
    board.chess960 = board.chess960 or board.has_chess960_castling_rights()

    wanted = plan.positions
    last = wanted.stop - 1
    for ply in range(last + 1):
        if ply >= wanted.start:
            yield ply, board.copy(stack=False)
        if ply >= last or ply >= len(plan.moves_uci):
            break
        board.push(board.parse_uci(plan.moves_uci[ply]))


def terminal_score(board: chess.Board) -> Score | None:
    """The score of a finished position, which no engine can be asked for."""
    from backend.adapters.stockfish import MATE_SCORE, Score

    if board.is_checkmate():
        # The side to move is the one that has been mated, so White's score is -MATE when
        # it is White's turn and +MATE when it is Black's.
        folded = -MATE_SCORE if board.turn else MATE_SCORE
        return Score(cp=None, mate_in=0, folded_cp=folded)
    if board.is_stalemate() or board.is_insufficient_material():
        return Score(cp=0, mate_in=None, folded_cp=0)
    return None


def _position_row(plan: RunPlan, board: chess.Board, score: Score, result: Any) -> MoveEval:
    """A run over a bare FEN: one row, an evaluation and its lines, no move to judge."""
    pov = score.pov(board.turn)
    best = result.best if result is not None else None
    return MoveEval(
        run_id=plan.run_id,
        ply=plan.ply_start,
        position_id=plan.position_ids[0] if plan.position_ids else None,
        eval_before_cp=pov.stored_cp,
        eval_before_mate=pov.mate_in,
        win_before=win_percent(pov.stored_cp, pov.mate_in),
        best_move_uci=None if best is None else best.uci,
        best_lines=result.best_lines() if result is not None else None,
    )


def _move_row(
    plan: RunPlan,
    ply: int,
    board: chess.Board,
    scores: dict[int, Score],
    result: Any,
) -> MoveEval:
    before = scores[ply].pov(board.turn)
    # The score after the move is White's; flipped into the mover's frame so that
    # "before" and "after" are two readings of the same dial.
    after = scores[ply + 1].pov(board.turn)
    win_before = win_percent(before.stored_cp, before.mate_in)
    win_after = win_percent(after.stored_cp, after.mate_in)
    win_loss = round(max(0.0, win_before - win_after), 2)

    played = plan.moves_uci[ply]
    best = result.best if result is not None else None
    return MoveEval(
        run_id=plan.run_id,
        ply=ply,
        position_id=plan.position_ids[ply] if ply < len(plan.position_ids) else None,
        move_uci=played,
        move_san=plan.moves_san[ply] if ply < len(plan.moves_san) else None,
        eval_before_cp=before.stored_cp,
        eval_before_mate=before.mate_in,
        eval_after_cp=after.stored_cp,
        eval_after_mate=after.mate_in,
        win_before=win_before,
        win_after=win_after,
        win_loss=win_loss,
        classification=classify_move(
            win_loss,
            played_best=_is_best(board, played, None if best is None else best.uci),
            thresholds=plan.thresholds,
        ),
        best_move_uci=None if best is None else best.uci,
        best_lines=result.best_lines() if result is not None else None,
    )


def _is_best(board: chess.Board, played: str, best: str | None) -> bool:
    """Whether the move played is the engine's first choice, castling spellings aside."""
    if best is None:
        return False
    try:
        return board.parse_uci(played) == board.parse_uci(best)
    except ValueError:
        return played == best


def maia_bounds(adapter: MaiaAdapter) -> dict[str, int]:
    """Clamp to the rating range this build declares, where it declares one.

    Shared with the live policy service, so a level the analysis board reports and a level
    a stored run keys by are narrowed by the same engine's own declaration.
    """
    for option in adapter.declared_options():
        if option.name == SELF_ELO and option.min is not None and option.max is not None:
            return {"low": int(option.min), "high": int(option.max)}
    return {}


# --- reading ---------------------------------------------------------------


def get_move_evals(
    session: Session, run_id: int, ply_range: tuple[int, int] | None = None
) -> list[MoveEval]:
    """The eval curve of a run, optionally narrowed to a ply window."""
    statement = select(MoveEval).where(MoveEval.run_id == run_id).order_by(MoveEval.ply)
    if ply_range is not None:
        statement = statement.where(MoveEval.ply >= ply_range[0], MoveEval.ply < ply_range[1])
    return list(session.scalars(statement))


def get_worst_moments(
    session: Session, *, days: int | None = None, amount: int = 5
) -> list[MoveEval]:
    """Recent moves ranked by win-percentage loss: "what should I train?".

    The rows themselves; `stats.get_worst_recent_moments` is the same ranking dressed up
    with the game, the phase and the better move for a coach to read.
    """
    if amount <= 0:
        return []
    statement = (
        select(MoveEval)
        .join(AnalysisRun, MoveEval.run_id == AnalysisRun.id)
        .join(Game, AnalysisRun.game_id == Game.id)
        .outerjoin(Engine, AnalysisRun.engine_id == Engine.id)
        .where(
            AnalysisRun.status == RunStatus.DONE,
            MoveEval.win_loss.is_not(None),
            (Engine.id.is_(None)) | (Engine.kind == EngineKind.UCI),
        )
        .order_by(MoveEval.win_loss.desc(), MoveEval.id.desc())
        .limit(amount)
    )
    if days is not None:
        statement = statement.where(Game.played_at >= datetime.now(UTC) - timedelta(days=days))
    return list(session.scalars(statement))


def analyze_position(session: Session, fen: str, budget_nodes: int) -> dict[str, Any]:
    """A synchronous, bounded-budget eval for a mid-conversation "what if" line.

    Starts its own short-lived process rather than borrowing a warm one: this is called
    from a request thread, and the warm pool is asyncio-facing and reserved for runs.

    That process starts here, which is why the engine is resolved `local_only`: a runner
    carries whole runs, not single positions, and its engine's path means nothing on this
    machine.
    """
    import chess
    import chess.engine

    from backend.adapters.stockfish import EngineError, StockfishAdapter
    from backend.services.explorer import read_fen

    engine = engines_service.require_engine_for_tier(session, Tier.QUICK, local_only=True)
    text = (fen or "").strip()
    try:
        board = read_fen(text)
    except ValueError as exc:
        raise AnalysisRequestError(f"{text!r} is not a valid FEN: {exc}") from exc

    terminal = terminal_score(board)
    if terminal is not None:
        pov = terminal.pov(board.turn)
        return {
            "fen": board.fen(),
            "engine_id": engine.id,
            "engine_name": engine.name,
            "nodes": 0,
            "cp": pov.stored_cp,
            "mate": pov.mate_in,
            "win_percent": win_percent(pov.stored_cp, pov.mate_in),
            "best_move": None,
            "lines": [],
        }

    try:
        with StockfishAdapter(engine.path, options=engine.options or {}) as adapter:
            result = adapter.analyse(
                board, chess.engine.Limit(nodes=max(1, int(budget_nodes))), multipv=1
            )
    except EngineError as exc:
        raise AnalysisError(f"{engine.name} could not analyse the position: {exc}") from exc

    pov = result.score.pov(board.turn)
    best = result.best
    return {
        "fen": board.fen(),
        "engine_id": engine.id,
        "engine_name": engine.name,
        "depth": result.depth,
        "nodes": result.nodes,
        "cp": pov.stored_cp,
        "mate": pov.mate_in,
        "win_percent": win_percent(pov.stored_cp, pov.mate_in),
        "best_move": None if best is None else {"uci": best.uci, "san": best.san},
        "lines": result.best_lines(),
    }

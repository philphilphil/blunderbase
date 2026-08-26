"""The analysis workers: asyncio tasks that drain the `AnalysisRun` queue.

The division of labour is deliberate. `services/analysis.py` owns every rule — what a run
means, how it is claimed, what a blunder is — and does it all synchronously. This module
owns nothing but the plumbing: N asyncio tasks in the API process, the engine pool's
concurrency cap, and the boundary between the event loop and the two blocking worlds it
has to talk to.

Both of those worlds go out through `asyncio.to_thread`:

- the database, because SQLAlchemy here is synchronous and a claim or a commit would
  otherwise stall every other worker's engine;
- the engine, because a UCI search is a blocking read on a pipe.

One run is two passes over the same positions: Stockfish for the evaluation, then Maia for
the human policy. They are sequential rather than nested because both draw on the same
`analysis_concurrency` semaphore, and a worker holding a slot while waiting for a second
one deadlocks the moment that cap is a single process.

A set also says that the runs it holds are alive, every `HEARTBEAT_SECONDS`. That is what
tells another starting process which `running` rows are a dead one's to collect and which
belong to a worker that is still searching.

This set drains the **local** half of the queue: it claims past every run bound to an
engine that lives on a runner, because that machine is the only one that can start the
binary. The remote half is `workers/runner_gateway.py`, and both halves take their work
through the same `claim_next_run` — there is one queue and one claim, only two kinds of
worker reading it.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from sqlalchemy.orm import Session, sessionmaker

from backend.config import Settings, get_settings
from backend.db.enums import RunStatus
from backend.db.models import Engine
from backend.db.session import get_sessionmaker
from backend.services import analysis
from backend.services import engines as engines_service

if TYPE_CHECKING:  # pragma: no cover - typing only
    from backend.adapters.pool import Adapter, EnginePool, EngineSpec
    from backend.db.models import MoveEval
    from backend.services.analysis import RunPlan

logger = logging.getLogger(__name__)

# How long `stop()` lets a run finish on its own before the task is cancelled. A quick
# pass over one game is well inside this; a deep pass is not, and is requeued instead.
STOP_GRACE_SECONDS = 5.0
# How often `wait_idle` looks at the queue.
IDLE_CHECK_SECONDS = 0.02
# How often the runs this set is executing are marked alive. Several beats fit inside
# `analysis.STALE_AFTER_SECONDS`, so a slow beat is not mistaken for a dead process.
HEARTBEAT_SECONDS = 10.0


class EngineFailure(Exception):
    """An engine call that failed, with whatever the process said on its way out."""

    def __init__(self, error: str, stderr: str | None = None) -> None:
        super().__init__(error)
        self.error = error
        self.stderr = stderr


@dataclass(slots=True)
class RunContext:
    """What the loop needs to execute one claimed run, read off the database once."""

    plan: RunPlan
    spec: EngineSpec
    maia_spec: EngineSpec | None = None


class AnalysisWorkers:
    """A pool of asyncio workers draining the analysis queue for one database."""

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        sessions: sessionmaker[Session] | None = None,
        pool: EnginePool | None = None,
        concurrency: int | None = None,
        poll_seconds: float | None = None,
        stop_grace: float = STOP_GRACE_SECONDS,
    ) -> None:
        self.settings = settings or get_settings()
        self.concurrency = max(1, int(concurrency or self.settings.analysis_concurrency))
        self.poll_seconds = float(
            poll_seconds if poll_seconds is not None else self.settings.analysis_poll_seconds
        )
        self.stop_grace = stop_grace
        self._sessions = sessions
        self._pool = pool
        self._owns_pool = pool is None
        self._tasks: list[asyncio.Task[None]] = []
        self._heartbeat: asyncio.Task[None] | None = None
        self._stopping = asyncio.Event()
        self._wake = asyncio.Event()
        self._busy = 0
        # The runs this set has claimed and not yet handed back. What the heartbeat marks
        # alive, so that another process starting up leaves them alone.
        self._inflight: set[int] = set()

    # --- lifecycle --------------------------------------------------------

    @property
    def running(self) -> bool:
        return bool(self._tasks)

    @property
    def busy(self) -> int:
        """Workers executing a run right now."""
        return self._busy

    async def start(self) -> None:
        """Collect what a dead process left behind, then start draining."""
        if self._tasks:
            return
        self._stopping.clear()
        await asyncio.to_thread(self._requeue_stale)
        self._tasks = [
            asyncio.create_task(self._worker(), name=f"analysis-worker-{index}")
            for index in range(self.concurrency)
        ]
        self._heartbeat = asyncio.create_task(self._beat(), name="analysis-heartbeat")

    async def stop(self) -> None:
        """Ask the workers to finish, then take the queue back from the ones that cannot."""
        self._stopping.set()
        self._wake.set()
        heartbeat, self._heartbeat = self._heartbeat, None
        if heartbeat is not None:
            heartbeat.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await heartbeat
        tasks, self._tasks = self._tasks, []
        if tasks:
            _done, pending = await asyncio.wait(tasks, timeout=self.stop_grace)
            for task in pending:
                task.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
        if self._owns_pool and self._pool is not None:
            await self._pool.close()
            self._pool = None

    async def __aenter__(self) -> AnalysisWorkers:
        await self.start()
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.stop()

    def notify(self) -> None:
        """Wake an idle worker: something was just enqueued."""
        self._wake.set()

    async def wait_idle(self, timeout: float = 30.0) -> bool:
        """Block until nothing is queued, running or in flight. For batch runs and tests."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while loop.time() < deadline:
            outstanding = await asyncio.to_thread(self._outstanding)
            if outstanding == 0 and self._busy == 0:
                return True
            await asyncio.sleep(IDLE_CHECK_SECONDS)
        return False

    # --- the loop ---------------------------------------------------------

    async def _worker(self) -> None:
        while not self._stopping.is_set():
            # The claim commits on a thread, so a cancellation arriving while it does
            # would lose the id of a row that is already `running`. It is written here on
            # the way out of the thread instead of returned, so there is always something
            # to hand back to the queue.
            claimed: list[int] = []
            try:
                run_id = await asyncio.to_thread(self._claim, claimed)
            except asyncio.CancelledError:
                for claimed_id in claimed:
                    self._abandon(claimed_id)
                raise
            except Exception:
                logger.exception("analysis worker could not claim a run")
                await self._idle()
                continue
            if run_id is None:
                await self._idle()
                continue
            self._busy += 1
            self._inflight.add(run_id)
            try:
                await self._execute(run_id)
            except asyncio.CancelledError:
                # Awaiting anything here would be cancelled again straight away, so the
                # handover back to the queue is the one blocking call this loop makes.
                self._abandon(run_id)
                raise
            except Exception as exc:
                # Nothing else will: an unhandled error here would kill this task without
                # anyone retrieving it, leaving the run `running` for ever and the pool one
                # worker smaller each time it happened.
                logger.exception("analysis run %s died in its worker", run_id)
                await self._release(run_id, _message(exc))
            finally:
                self._inflight.discard(run_id)
                self._busy -= 1

    async def _idle(self) -> None:
        self._wake.clear()
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._wake.wait(), self.poll_seconds)

    async def _beat(self) -> None:
        """Mark the claimed runs alive, so no other worker set collects them as stale."""
        while True:
            await asyncio.sleep(HEARTBEAT_SECONDS)
            run_ids = sorted(self._inflight)
            if not run_ids:
                continue
            try:
                await asyncio.to_thread(self._touch, run_ids)
            except Exception:
                logger.exception("could not mark runs %s alive", run_ids)

    async def _release(self, run_id: int, error: str) -> None:
        """Hand a run back after its worker fell over, so the row does not stay `running`.

        Best effort by construction: whatever killed the run may well have been the
        database itself, and a second failure here must not take the worker with it. The
        stale-run sweep is what collects a run this could not release.
        """
        try:
            await asyncio.to_thread(self._fail, run_id, error, None, True)
        except Exception:
            logger.exception("could not release analysis run %s", run_id)

    async def _execute(self, run_id: int) -> None:
        try:
            context = await asyncio.to_thread(self._prepare, run_id)
        except analysis.AnalysisError as exc:
            # A run this database cannot describe — no engine, a binary that has moved,
            # a game that is gone. A second attempt would hit exactly the same wall.
            await asyncio.to_thread(self._fail, run_id, str(exc), None, False)
            return
        except Exception as exc:
            await asyncio.to_thread(self._fail, run_id, _message(exc), None, True)
            return
        if context is None:
            return

        try:
            evals = await self._analyse(context)
        except EngineFailure as failure:
            await asyncio.to_thread(self._fail, run_id, failure.error, failure.stderr, True)
            return
        except Exception as exc:
            await asyncio.to_thread(self._fail, run_id, _message(exc), None, True)
            return

        note = await self._add_maia(context, evals)
        await asyncio.to_thread(self._finish, run_id, evals, note)

    async def _analyse(self, context: RunContext) -> list[MoveEval]:
        plan = context.plan

        def work(adapter: Adapter) -> list[MoveEval]:
            return analysis.analyse_plan(
                plan,
                adapter,  # type: ignore[arg-type]
                progress=lambda done, total: analysis.emit_run_event(
                    analysis.progress_event(plan, done, total)
                ),
            )

        return await self._with_engine(context.spec, work)

    async def _add_maia(self, context: RunContext, evals: list[MoveEval]) -> str | None:
        """Run the human-policy pass. A Maia that will not answer degrades, never fails."""
        if context.maia_spec is None or not evals:
            return None
        plan = context.plan

        def work(adapter: Adapter) -> int:
            return analysis.apply_maia(plan, evals, adapter)  # type: ignore[arg-type]

        try:
            await self._with_engine(context.maia_spec, work)
        except EngineFailure as failure:
            return f"human-move predictions skipped: {failure.error}"
        except Exception as exc:
            return f"human-move predictions skipped: {_message(exc)}"
        return None

    async def _with_engine(self, spec: EngineSpec, work: Any) -> Any:
        """One blocking engine call on a warm process, with its stderr on the way out."""
        async with self.pool.acquire(spec) as adapter:
            try:
                return await asyncio.to_thread(work, adapter)
            except Exception as exc:
                raise EngineFailure(_message(exc), _stderr_of(adapter)) from exc

    # --- the database side (always on a thread) ---------------------------

    @property
    def pool(self) -> EnginePool:
        """This worker set's own warm processes.

        A private pool rather than the process-wide one: `stop()` then really does stop
        the engines it started, which is what a headless `blunderbase analyze` needs in
        order to exit, and what lets a test start a second set without disturbing the
        first. Pass `pool=` to share one.
        """
        if self._pool is None:
            from backend.adapters.pool import EnginePool

            self._pool = EnginePool(concurrency=self.concurrency)
        return self._pool

    @property
    def sessions(self) -> sessionmaker[Session]:
        if self._sessions is None:
            self._sessions = get_sessionmaker(self.settings)
        return self._sessions

    def _requeue_stale(self) -> int:
        with self.sessions() as session:
            return len(analysis.requeue_stale_runs(session))

    def _outstanding(self) -> int:
        with self.sessions() as session:
            counts = analysis.queue_depth(session)
        return counts["queued"] + counts["running"]

    def _claim(self, claimed: list[int]) -> int | None:
        with self.sessions() as session:
            run = analysis.claim_next_run(
                session, exclude_engine_ids=engines_service.remote_engine_ids(session)
            )
            if run is None:
                return None
            claimed.append(run.id)
            return run.id

    def _touch(self, run_ids: list[int]) -> None:
        with self.sessions() as session:
            analysis.heartbeat_runs(session, run_ids)

    def _prepare(self, run_id: int) -> RunContext | None:
        """Turn a claimed row into a plan plus the engines that will serve it."""
        with self.sessions() as session:
            run = analysis.require_run(session, run_id)
            if run.status is not RunStatus.RUNNING:
                return None
            engine = session.get(Engine, run.engine_id) if run.engine_id else None
            if engine is None or not engine.enabled or engine.runner_id is not None:
                # The engine named at enqueue time has since been deleted, switched off or
                # moved to a runner; the tier's current local choice stands in rather than
                # the run failing. Remote work is claimed by the gateway, not by this set,
                # so a remote engine reaching here is a race, not a job to attempt.
                engine = engines_service.engine_for_tier(session, run.tier, local_only=True)
            if engine is None:
                raise analysis.AnalysisError("no engine is available for this tier")
            if not engines_service.binary_present(engine.path):
                raise analysis.AnalysisError(
                    f"the binary for {engine.name!r} is no longer at {engine.path}"
                )
            plan = analysis.build_plan(session, run, self.settings)
            maia = engines_service.maia_engine_for_host(session, None)
            return RunContext(
                plan=plan,
                spec=engines_service.spec_for(engine),
                maia_spec=None if maia is None else engines_service.spec_for(maia),
            )

    def _finish(self, run_id: int, evals: list[MoveEval], note: str | None) -> None:
        with self.sessions() as session:
            run = analysis.require_run(session, run_id)
            analysis.complete_run(session, run, evals)
            if note is not None:
                analysis.note_run(session, run, note)

    def _fail(self, run_id: int, error: str, stderr: str | None, retry: bool) -> None:
        with self.sessions() as session:
            run = analysis.get_run(session, run_id)
            if run is None:
                return
            analysis.fail_run(session, run, error, stderr, retry=retry)

    def _abandon(self, run_id: int) -> None:
        """A cancelled worker gives its run back to the queue rather than stranding it."""
        with self.sessions() as session:
            run = analysis.get_run(session, run_id)
            if run is not None:
                analysis.abandon_run(session, run)


def _stderr_of(adapter: Any) -> str | None:
    tail = getattr(adapter, "stderr_tail", None)
    if tail is None:
        return None
    try:
        return tail()
    except Exception:
        return None


def _message(exc: BaseException) -> str:
    text = str(exc).strip()
    return f"{type(exc).__name__}: {text}" if text else type(exc).__name__


async def drain(
    settings: Settings | None = None,
    *,
    sessions: sessionmaker[Session] | None = None,
    timeout: float = 3600.0,
) -> None:
    """Run the queue down to empty and stop. This is `blunderbase analyze` headless."""
    workers = AnalysisWorkers(settings=settings, sessions=sessions)
    await workers.start()
    try:
        await workers.wait_idle(timeout)
    finally:
        await workers.stop()

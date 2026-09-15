"""Practice replies on the two hosts an engine can live on.

`services/practice.py` owns the rules; this module owns the machinery, split the way the
analysis board's is:

- **Here.** A reply takes a slot out of the workers' `EnginePool`, so a practice game and
  the analysis queue share one count of engine processes. The rating is part of the pool
  key (`spec_for` with overrides), so a process held to 1500 is its own warm process and is
  never handed to an analysis pass.
- **On a runner.** `move_request` down the socket and `move_result` back, holding one of the
  runner's slots for the length of the search. A person is waiting, so the slot is taken
  the way an analysis board takes one — preempting the most recently started run, which
  goes back with its attempt refunded.

Both are bounded. A reply that has not come back in the think time plus a margin is a
sentence, never a request that hangs: a runner that dropped mid-search has no
`move_result` left to send.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from backend.runners import protocol
from backend.services import practice as practice_service
from backend.services.practice import Destination, PracticeUnavailableError
from backend.workers.runner_gateway import WEBSOCKET

if TYPE_CHECKING:  # pragma: no cover - typing only
    from backend.adapters.pool import EnginePool
    from backend.workers.runner_gateway import RunnerGateway

logger = logging.getLogger(__name__)

# How long a reply may wait for a slot and a process to start, on top of the think time.
# Sized for an engine starting and a preempted run letting go, not for a queue.
MARGIN_SECONDS = 20.0
NO_SLOT = "every engine slot on this host is busy right now; try again in a moment"


class LocalMoveBackend:
    """A reply from a binary on this host, on a warm process out of the shared pool."""

    name = practice_service.LOCAL

    def __init__(self, pool: EnginePool, *, margin: float = MARGIN_SECONDS) -> None:
        self.pool = pool
        self.margin = margin

    def refusal(self, runner_id: int | None) -> str | None:
        return None

    async def play(self, target: Destination, fen: str, movetime_ms: int) -> str | None:
        if target.spec is None:  # pragma: no cover - the broker always builds one here
            raise PracticeUnavailableError(f"{target.engine!r} has no local process to start")

        def work(adapter: Any) -> str | None:
            import chess
            import chess.engine

            board = chess.Board(fen)
            result = adapter.engine.play(board, chess.engine.Limit(time=movetime_ms / 1000))
            return None if result.move is None else result.move.uci()

        try:
            return await asyncio.wait_for(
                self.pool.run(target.spec, work), movetime_ms / 1000 + self.margin
            )
        except TimeoutError:
            raise PracticeUnavailableError(NO_SLOT) from None
        except PracticeUnavailableError:
            raise
        except Exception as exc:
            raise PracticeUnavailableError(
                f"{target.engine!r} could not play a move: {_message(exc)}"
            ) from exc


@dataclass(slots=True)
class _Pending:
    runner_id: int
    answer: asyncio.Future[Mapping[str, Any]]


class RemoteMoveBackend:
    """A reply from an engine on a runner, relayed as one request and one answer."""

    name = practice_service.REMOTE

    def __init__(self, gateway: RunnerGateway, *, margin: float = MARGIN_SECONDS) -> None:
        self.gateway = gateway
        self.margin = margin
        self._pending: dict[str, _Pending] = {}
        self._cancel: Callable[[], None] | None = None

    def install(self) -> Callable[[], None]:
        """Start listening for `move_result`. Returns the way to stop."""
        if self._cancel is None:
            self._cancel = self.gateway.register_handler(protocol.MOVE_RESULT, self._on_result)
        return self.uninstall

    def uninstall(self) -> None:
        if self._cancel is not None:
            self._cancel()
            self._cancel = None

    def refusal(self, runner_id: int | None) -> str | None:
        if runner_id is None:  # pragma: no cover - the broker only asks this about a runner
            return "that engine is not on a runner"
        state = self.gateway.state(runner_id)
        if state is None:
            return "its runner is not connected"
        if state.transport != WEBSOCKET:
            return f"{state.name!r} is connected over polling, which carries queue work only"
        if protocol.FEATURE_PLAY_MOVE not in state.features:
            return f"{state.name!r} runs a version that cannot play practice moves; update it"
        return None

    async def play(self, target: Destination, fen: str, movetime_ms: int) -> str | None:
        runner_id = target.runner_id
        if runner_id is None:  # pragma: no cover - the broker resolves one before it gets here
            raise PracticeUnavailableError(f"{target.engine!r} belongs to no runner")
        reason = self.refusal(runner_id)
        if reason is not None:
            raise PracticeUnavailableError(reason)
        request = practice_service.request_id()
        if not self.gateway.reserve_slot(runner_id, request):
            raise PracticeUnavailableError(f"{target.runner} has no slot free for a move")
        loop = asyncio.get_running_loop()
        pending = _Pending(runner_id=runner_id, answer=loop.create_future())
        self._pending[request] = pending
        try:
            sent = await self.gateway.send(
                runner_id,
                protocol.move_request(
                    request_id=request,
                    engine=target.engine,
                    fen=fen,
                    movetime_ms=movetime_ms,
                    options=target.options,
                ),
            )
            if not sent:
                raise PracticeUnavailableError(f"the link to {target.runner} would not take it")
            try:
                frame = await asyncio.wait_for(
                    pending.answer, movetime_ms / 1000 + self.margin
                )
            except TimeoutError:
                raise PracticeUnavailableError(
                    f"{target.runner} did not answer with a move in time"
                ) from None
        finally:
            self._pending.pop(request, None)
            self.gateway.release_slot(runner_id, request)
        error = frame.get("error")
        if error:
            raise PracticeUnavailableError(str(error))
        uci = frame.get("uci")
        return None if not uci else str(uci)

    async def _on_result(self, runner_id: int, frame: Mapping[str, Any]) -> None:
        request = frame.get("request_id")
        pending = self._pending.get(request) if isinstance(request, str) else None
        if pending is None or pending.runner_id != runner_id:
            logger.debug("runner %s answered %r, which nobody is waiting for", runner_id, request)
            return
        if not pending.answer.done():
            pending.answer.set_result(frame)


def _message(exc: BaseException) -> str:
    text = str(exc).strip()
    return f"{type(exc).__name__}: {text}" if text else type(exc).__name__

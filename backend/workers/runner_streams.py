"""The analysis board on a binary that lives on somebody else's machine.

Everything the local backend does with a thread and a pool slot, this one does with three
frames: `stream_open`, `stream_restart`, `stream_close` down the runner's socket, and
`stream_snapshot` back. The runner throttles at its end, so what arrives here is already
two pictures a second and is relayed to the broker untouched — re-throttling a stream that
crossed a network would only add latency to something that was already thinned out.

Two things are worth knowing:

- **The slot is the gateway's, and a stream outranks queue work.** `reserve_slot` takes one
  from the runner's count, preempting the most recently started run if it has to (D6):
  somebody is sitting at a board, and a deep pass can wait a minute and start again with
  its attempt refunded. `release_slot` gives it back and wakes the dispatcher.
- **Nothing here edits the gateway.** The frames a runner sends about a session have no
  built-in handler; `register_handler` is the seam, and this module is the only thing that
  knows what a `stream_snapshot` means.

A runner that vanishes does not reach this module at all: `services/streams.py` watches for
`runner.disconnected` and ends the sessions itself, because a link that has gone has no
`stream_close` to be sent down it.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from backend.config import Settings, get_settings
from backend.runners import protocol
from backend.services import streams as streams_service
from backend.services.streams import StreamSession, StreamUnavailableError
from backend.workers.runner_gateway import WEBSOCKET

if TYPE_CHECKING:  # pragma: no cover - typing only
    from backend.workers.runner_gateway import RunnerGateway

logger = logging.getLogger(__name__)

# The frames a runner sends about a session. None of them has a built-in handler in the
# gateway, so a registered one is the only one they reach.
HANDLED = (protocol.STREAM_STARTED, protocol.STREAM_SNAPSHOT, protocol.STREAM_CLOSED)


@dataclass(slots=True)
class _Held:
    """One session's slot on one runner, and whether that runner has already let go."""

    runner_id: int
    reported: bool = False


class RemoteStreamBackend:
    """An analysis board served by a runner, relayed frame for frame."""

    name = streams_service.REMOTE

    def __init__(
        self,
        gateway: RunnerGateway,
        broker: streams_service.StreamBroker,
        *,
        settings: Settings | None = None,
    ) -> None:
        self.gateway = gateway
        self.broker = broker
        self.settings = settings or get_settings()
        self._held: dict[str, _Held] = {}
        self._cancels: list[Callable[[], None]] = []

    # --- the gateway seam ----------------------------------------------------

    def install(self) -> Callable[[], None]:
        """Start listening for what runners say about sessions. Returns the way to stop."""
        if not self._cancels:
            self._cancels = [
                self.gateway.register_handler(protocol.STREAM_STARTED, self._on_started),
                self.gateway.register_handler(protocol.STREAM_SNAPSHOT, self._on_snapshot),
                self.gateway.register_handler(protocol.STREAM_CLOSED, self._on_closed),
            ]
        return self.uninstall

    def uninstall(self) -> None:
        for cancel in self._cancels:
            cancel()
        self._cancels = []

    # --- the backend interface -----------------------------------------------

    async def open(self, session: StreamSession) -> None:
        runner_id = session.runner_id
        if runner_id is None:  # pragma: no cover - the broker resolves one before it gets here
            raise StreamUnavailableError(f"{session.engine!r} belongs to no runner")
        state = self.gateway.state(runner_id)
        if state is None:
            # The row said connected when the engine was resolved and the link has gone
            # since. Refusing here is what keeps the board from waiting on a socket that
            # nobody is on.
            raise StreamUnavailableError(f"{session.runner!r} is not connected")
        if state.transport != WEBSOCKET:
            # A poll response carries jobs and nothing else: there is no way down to the
            # runner for a `stream_open` and no way back up for a snapshot. Said now,
            # rather than as a board that never draws and a slot nobody gets back.
            raise StreamUnavailableError(
                f"{session.runner!r} is connected over polling, which carries queue work "
                f"but no analysis board"
            )
        if not self.gateway.reserve_slot(runner_id, session.id):
            raise StreamUnavailableError(
                f"{session.runner!r} has no slot free for an analysis board"
            )
        self._held[session.id] = _Held(runner_id=runner_id)
        sent = await self.gateway.send(
            runner_id,
            protocol.stream_open(
                session_id=session.id,
                engine=session.engine,
                fen=session.fen,
                multipv=session.multipv,
                interval_ms=self._interval_ms(),
            ),
        )
        if not sent:
            self._release(session.id)
            raise StreamUnavailableError(f"the link to {session.runner!r} would not take it")

    async def restart(self, session: StreamSession) -> None:
        held = self._held.get(session.id)
        if held is None:
            raise StreamUnavailableError(f"{session.runner!r} is no longer searching")
        sent = await self.gateway.send(
            held.runner_id,
            protocol.stream_restart(
                session_id=session.id, fen=session.fen, multipv=session.multipv
            ),
        )
        if not sent:
            raise StreamUnavailableError(f"the link to {session.runner!r} would not take it")

    async def close(self, session: StreamSession, reason: str) -> None:
        held = self._held.get(session.id)
        if held is None:
            return
        if not held.reported:
            # It is still searching as far as it knows. A runner that has already said the
            # session is over does not need to be told again.
            await self.gateway.send(
                held.runner_id, protocol.stream_close(session_id=session.id, reason=reason)
            )
        self._release(session.id)

    # --- what the runner says ------------------------------------------------

    async def _on_started(self, runner_id: int, frame: Mapping[str, Any]) -> None:
        session_id = self._owned(runner_id, frame)
        if session_id is not None:
            self.broker.mark_running(session_id)

    async def _on_snapshot(self, runner_id: int, frame: Mapping[str, Any]) -> None:
        session_id = self._owned(runner_id, frame)
        if session_id is not None:
            # Relayed as it arrived: the runner threw away the raw UCI and did the
            # throttling, and `seq` is the broker's to assign.
            self.broker.snapshot(session_id, frame)

    async def _on_closed(self, runner_id: int, frame: Mapping[str, Any]) -> None:
        session_id = self._owned(runner_id, frame)
        if session_id is None:
            return
        held = self._held.get(session_id)
        if held is not None:
            held.reported = True
        reason = str(frame.get("reason") or streams_service.REASON_CLOSED)
        error = frame.get("error")
        await self.broker.backend_ended(
            session_id, reason=reason, error=None if error is None else str(error)
        )

    def _owned(self, runner_id: int, frame: Mapping[str, Any]) -> str | None:
        """The session this frame is about, if it really is this runner's to speak for."""
        session_id = frame.get("session_id")
        if not isinstance(session_id, str) or not session_id:
            return None
        held = self._held.get(session_id)
        if held is None or held.runner_id != runner_id:
            logger.debug(
                "runner %s said something about %r, which is not its", runner_id, session_id
            )
            return None
        return session_id

    def _release(self, session_id: str) -> None:
        held = self._held.pop(session_id, None)
        if held is not None:
            self.gateway.release_slot(held.runner_id, session_id)

    def _interval_ms(self) -> int:
        return max(1, int(self.settings.stream_snapshot_interval * 1000))

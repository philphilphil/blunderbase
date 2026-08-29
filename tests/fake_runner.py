"""A runner that is not a process: the real protocol, over the real socket, in-process.

`FakeRunner` wraps a `TestClient` websocket and speaks exactly what `backend/runners/
protocol.py` defines — no shortcuts through the gateway's internals, so a test that passes
here is a test the `blunderbase-runner` client will pass too. `poll_once` is the same
thing over the fallback's three REST endpoints.

Nothing here is a fixture: a test builds its own app, registers its own runners and hands
the token over. Stages 3 to 5 reuse the same helper.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from typing import Any

import httpx
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession
from starlette.websockets import WebSocketDisconnect

from backend.runners import protocol

WS_PATH = "/runner/ws"
POLL_PATH = "/runner/poll"

THREADS = {
    "name": "Threads",
    "type": "spin",
    "default": 1,
    "min": 1,
    "max": 128,
    "var": [],
    "managed": False,
}

# No `tier`. A runner cannot claim a job — the owner assigns Quick, Deep and Human moves on
# the server — and the key is only still tolerated so that a runner built before that keeps
# connecting. `test_runners_service` is where an ad that still carries one is covered.
STOCKFISH_AD: dict[str, Any] = {
    "name": "sf-remote",
    "kind": "uci",
    "path": "/usr/games/stockfish",
    "version": "Stockfish 17",
    "options": {"Threads": 8},
    "declared_options": [THREADS],
    "streams": True,
}

# A browser tab's engine: no binary anywhere, so its "path" is an identifier behind a
# scheme and only the tab that advertised it can start it.
WASM_AD: dict[str, Any] = {
    "name": "wasm-sf",
    "kind": "uci",
    "path": "wasm:stockfish-18",
    "version": "Stockfish 18 (WASM)",
    "options": {"Threads": 4},
    "declared_options": [THREADS],
    "streams": True,
}

MAIA_AD: dict[str, Any] = {
    "name": "maia-remote",
    "kind": "maia",
    "path": "/usr/games/lc0",
    "version": "lc0 v0.30",
    "options": {},
    "declared_options": [],
    "streams": False,
}


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def eval_row(ply: int, **changes: Any) -> dict[str, Any]:
    """One `MoveEval` payload as a runner hands it back — unattached, no `run_id`."""
    row: dict[str, Any] = {
        "ply": ply,
        "position_id": None,
        "move_uci": None,
        "move_san": None,
        "eval_before_cp": 20,
        "eval_before_mate": None,
        "eval_after_cp": -10,
        "eval_after_mate": None,
        "win_before": 51.84,
        "win_after": 49.08,
        "win_loss": 2.76,
        "classification": "good",
        "best_move_uci": "e2e4",
        "best_lines": [{"multipv": 1, "cp": 20, "mate": None, "pv": ["e2e4", "e7e5"]}],
        "maia_policy": None,
    }
    return {**row, **changes}


class FakeRunner:
    """One connection, from the runner's side of it."""

    def __init__(
        self,
        socket: WebSocketTestSession,
        *,
        name: str = "gpu-box",
        slots: int = 2,
        version: str = "0.1.0",
        engines: Sequence[Mapping[str, Any]] = (STOCKFISH_AD,),
    ) -> None:
        self.socket = socket
        self.name = name
        self.slots = slots
        self.version = version
        self.engines = [dict(engine) for engine in engines]
        self.welcome: dict[str, Any] | None = None
        self.pings = 0

    # --- the handshake ----------------------------------------------------

    def hello(
        self,
        *,
        active_runs: Sequence[Mapping[str, Any]] = (),
        engines: Sequence[Mapping[str, Any]] | None = None,
        proto: int | None = None,
        slots: int | None = None,
        browser: bool = False,
    ) -> dict[str, Any]:
        """Announce, and hand back the `welcome`. `proto=` is how a mismatch is staged."""
        frame = protocol.hello(
            runner=self.name,
            version=self.version,
            slots=self.slots if slots is None else slots,
            engines=self.engines if engines is None else engines,
            active_runs=active_runs,
            browser=browser,
        )
        if proto is not None:
            frame["proto"] = proto
        self.send(frame)
        self.welcome = self.recv(protocol.WELCOME)
        return self.welcome

    @property
    def engine_ids(self) -> dict[str, int | None]:
        """What the server called each advertised engine, from the welcome it answered."""
        welcome = self.welcome or {}
        return {entry["name"]: entry.get("engine_id") for entry in welcome.get("engines", [])}

    # --- frames -----------------------------------------------------------

    def send(self, frame: Mapping[str, Any]) -> None:
        self.socket.send_text(protocol.encode(frame))

    def recv(self, kind: str | None = None) -> dict[str, Any]:
        """The next frame, answering keepalives on the way so a test never sees one."""
        while True:
            frame = protocol.decode(self.socket.receive_text())
            if frame.get("type") == protocol.PING:
                self.pings += 1
                self.send(protocol.pong(frame.get("t", 0.0)))
                continue
            if kind is None or frame.get("type") == kind:
                return frame

    def closed(self) -> tuple[int, str]:
        """Read until the server closes, and say with which code. Fails if it does not."""
        try:
            while True:
                self.recv()
        except WebSocketDisconnect as exc:
            return exc.code, exc.reason

    # --- the job conversation ---------------------------------------------

    def progress(self, dispatch: Mapping[str, Any], done: int, total: int) -> None:
        self.send(
            protocol.run_progress(
                run_id=dispatch["run_id"],
                attempt_token=dispatch["attempt_token"],
                done=done,
                total=total,
            )
        )

    def complete(
        self,
        dispatch: Mapping[str, Any],
        evals: Sequence[Mapping[str, Any]] = (),
        *,
        note: str | None = None,
        token: str | None = None,
    ) -> dict[str, Any]:
        self.send(
            protocol.run_complete(
                run_id=dispatch["run_id"],
                attempt_token=dispatch["attempt_token"] if token is None else token,
                evals=evals,
                note=note,
            )
        )
        return self.recv(protocol.RUN_ACK)

    def fail(
        self,
        dispatch: Mapping[str, Any],
        error: str,
        *,
        stderr: str | None = None,
        retry: bool = True,
    ) -> dict[str, Any]:
        self.send(
            protocol.run_failed(
                run_id=dispatch["run_id"],
                attempt_token=dispatch["attempt_token"],
                error=error,
                stderr=stderr,
                retry=retry,
            )
        )
        return self.recv(protocol.RUN_ACK)


@contextmanager
def connect(
    client: TestClient, token: str, *, say_hello: bool = True, **kwargs: Any
) -> Iterator[FakeRunner]:
    """A runner on the wire, welcomed unless the test wants to stage the handshake itself."""
    with client.websocket_connect(WS_PATH, headers=bearer(token)) as socket:
        runner = FakeRunner(socket, **kwargs)
        if say_hello:
            runner.hello()
        yield runner


def poll_once(
    client: TestClient,
    token: str,
    *,
    name: str = "gpu-box",
    slots: int = 2,
    free_slots: int | None = None,
    engines: Sequence[Mapping[str, Any]] | None = (STOCKFISH_AD,),
    active_runs: Sequence[Mapping[str, Any]] = (),
    proto: int = protocol.PROTO_VERSION,
) -> httpx.Response:
    """One `POST /runner/poll`. `engines=None` re-announces nothing, as a later poll does."""
    body: dict[str, Any] = {
        "proto": proto,
        "runner": name,
        "version": "0.1.0",
        "slots": slots,
        "free_slots": slots if free_slots is None else free_slots,
        "active_runs": [dict(entry) for entry in active_runs],
    }
    if engines is not None:
        body["engines"] = [dict(engine) for engine in engines]
    return client.post(POLL_PATH, json=body, headers=bearer(token))


def poll_heartbeat(
    client: TestClient, token: str, dispatch: Mapping[str, Any], *, done: int = 0, total: int = 0
) -> httpx.Response:
    return client.post(
        f"/runner/runs/{dispatch['run_id']}/heartbeat",
        json={"attempt_token": dispatch["attempt_token"], "done": done, "total": total},
        headers=bearer(token),
    )


def poll_complete(
    client: TestClient,
    token: str,
    dispatch: Mapping[str, Any],
    *,
    evals: Sequence[Mapping[str, Any]] | None = None,
    note: str | None = None,
    error: str | None = None,
    stderr: str | None = None,
    retry: bool = True,
) -> httpx.Response:
    body: dict[str, Any] = {"attempt_token": dispatch["attempt_token"], "retry": retry}
    if error is None:
        body |= {"evals": [dict(row) for row in evals or ()], "note": note}
    else:
        body |= {"error": error, "stderr": stderr}
    return client.post(
        f"/runner/runs/{dispatch['run_id']}/complete", json=body, headers=bearer(token)
    )

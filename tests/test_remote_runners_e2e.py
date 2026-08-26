"""`blunderbase-runner` as a process: no fakes left anywhere in the path.

`test_runner_client.py` drives a `RunnerClient` object against a real server. This file
starts the console script the operator actually runs — its own interpreter, its own
`asyncio.run`, its own signal handlers — reading a `runner.yaml` off disk and dialling a
Blunderbase on a real port. The only scripted thing left is the UCI binary, which is
`tests/fake_uci.py` doing what a fake UCI engine has to do here: be a subprocess on the
other end of a pipe.

What that catches and nothing else does: the entrypoint's argument parsing and exit codes,
the console script's registration in `pyproject.toml`, config loading from a file rather
than a mapping, and a clean SIGTERM giving the work back.
"""

from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml
from sqlalchemy import select

from backend.api.app import create_app
from backend.config import Settings
from backend.db.enums import RunStatus, Tier
from backend.db.models import Engine
from backend.db.session import get_sessionmaker
from backend.runners.client import EXIT_CONFIG, EXIT_OK
from backend.services import analysis
from backend.services import runners as runners_service
from tests.fake_uci import STOCKFISH_OPTIONS, fake_engine_command
from tests.test_runner_client import serving

ROOT = Path(__file__).resolve().parents[1]
STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

# A whole process has to start, probe a binary, dial a socket and search a position.
SETTLE_SECONDS = 60.0
STOP_SECONDS = 30.0


@pytest.fixture()
def server(settings: Settings) -> Iterator[str]:
    """A Blunderbase with no local workers: every run in here belongs to the runner."""
    settings.analysis_workers = False
    settings.runner_heartbeat_seconds = 1.0
    settings.runner_stale_sweep_seconds = 60.0
    with serving(create_app(settings)) as base_url:
        yield base_url


@pytest.fixture(autouse=True)
def _fresh_limiter() -> Iterator[None]:
    runners_service.reset_limiter()
    yield
    runners_service.reset_limiter()


class RunnerProcess:
    """One `blunderbase-runner`, its output kept so a failure can say what it printed."""

    def __init__(self, argv: list[str], log: Path) -> None:
        self.argv = argv
        self.log = log
        self.handle: subprocess.Popen[bytes] | None = None

    def start(self) -> None:
        self.log.touch()
        with open(self.log, "wb") as sink:
            self.handle = subprocess.Popen(
                self.argv, stdout=sink, stderr=subprocess.STDOUT, env=_child_env()
            )

    def output(self) -> str:
        return self.log.read_text(encoding="utf-8", errors="replace")

    def stop(self, sig: int = signal.SIGTERM) -> int:
        """Ask it to finish, and say with which code. Killed if it will not."""
        handle = self.handle
        if handle is None:  # pragma: no cover - only a test that never started it
            return 0
        if handle.poll() is None:
            handle.send_signal(sig)
        try:
            return handle.wait(timeout=STOP_SECONDS)
        except subprocess.TimeoutExpired as expired:  # pragma: no cover - it will not stop
            handle.kill()
            handle.wait(timeout=STOP_SECONDS)
            raise AssertionError(
                f"the runner ignored {sig}; it printed:\n{self.output()}"
            ) from expired


def _child_env() -> dict[str, str]:
    """The parent's environment plus a path to `backend`, for the `-m` fallback."""
    env = dict(os.environ)
    existing = env.get("PYTHONPATH")
    env["PYTHONPATH"] = str(ROOT) if not existing else f"{ROOT}{os.pathsep}{existing}"
    return env


def _argv(config: Path, *flags: str) -> list[str]:
    """The console script if it is installed, the module behind it if it is not."""
    script = shutil.which("blunderbase-runner")
    launcher = [script] if script else [sys.executable, "-m", "backend.runners.entrypoint"]
    return [*launcher, "--config", str(config), *flags]


def write_config(tmp_path: Path, server: str, token: str, **changes: Any) -> Path:
    """A real `runner.yaml` on disk, with one scripted binary in it."""
    path = fake_engine_command(tmp_path, name="FakeFish 1", options=STOCKFISH_OPTIONS)
    document: dict[str, Any] = {
        "server": server,
        "token": token,
        "name": "gpu-box",
        "slots": 2,
        "log_level": "info",
        "poll_seconds": 1.0,
        "reconnect": {"initial_seconds": 0.1, "max_seconds": 0.5},
        "engines": [{"name": "sf-remote", "path": path, "tier": "deep"}],
        **changes,
    }
    config = tmp_path / "runner.yaml"
    config.write_text(yaml.safe_dump(document, sort_keys=False), encoding="utf-8")
    return config


def register(settings: Settings, name: str = "gpu-box", slots: int = 2) -> str:
    with get_sessionmaker(settings)() as session:
        _runner, token = runners_service.create_runner(session, name, slots=slots)
        return token


def eventually(check: Any, what: str, printed: Any = None, timeout: float = SETTLE_SECONDS) -> Any:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        answer = check()
        if answer:
            return answer
        time.sleep(0.1)
    tail = "" if printed is None else f"\nthe runner printed:\n{printed()}"
    raise AssertionError(f"{what} never happened{tail}")


def engine_row(settings: Settings, name: str) -> Engine | None:
    with get_sessionmaker(settings)() as session:
        return session.scalars(select(Engine).where(Engine.name == name)).first()


def runner_row(settings: Settings, name: str) -> Any:
    with get_sessionmaker(settings)() as session:
        return runners_service.runner_by_name(session, name)


def enqueue(settings: Settings, engine_id: int) -> int:
    with get_sessionmaker(settings)() as session:
        run = analysis.request_analysis(
            session, fen=STARTING_FEN, tier=Tier.DEEP, engine_id=engine_id, settings=settings
        )
        return run.id


def run_row(settings: Settings, run_id: int) -> Any:
    with get_sessionmaker(settings)() as session:
        return analysis.require_run(session, run_id)


# --- the tests -----------------------------------------------------------------


def test_the_installed_command_probes_connects_and_exits(
    server: str, settings: Settings, tmp_path: Path
) -> None:
    """`--check` is the operator's first move on a new machine, and it is a whole process."""
    config = write_config(tmp_path, server, register(settings))

    finished = subprocess.run(
        _argv(config, "--check"),
        capture_output=True,
        text=True,
        timeout=SETTLE_SECONDS,
        env=_child_env(),
    )

    printed = finished.stdout + finished.stderr
    assert finished.returncode == EXIT_OK, printed
    assert "welcomed 'gpu-box'" in printed
    assert "sf-remote: accepted as engine" in printed
    # A check is a look, not a shift: nothing is left dialled in behind it.
    assert eventually(
        lambda: runner_row(settings, "gpu-box").connected is False, "the check's link closed"
    )


def test_a_configuration_the_process_cannot_read_is_exit_one(tmp_path: Path) -> None:
    finished = subprocess.run(
        _argv(tmp_path / "nothing.yaml", "--check"),
        capture_output=True,
        text=True,
        timeout=SETTLE_SECONDS,
        env=_child_env(),
    )

    assert finished.returncode == EXIT_CONFIG
    assert "nothing.yaml" in finished.stderr


def test_the_runner_process_drains_a_run_and_gives_its_slots_back_on_a_signal(
    server: str, settings: Settings, tmp_path: Path
) -> None:
    """The whole thing: a yaml on disk, a process, a socket, an engine, and rows written."""
    config = write_config(tmp_path, server, register(settings))
    runner = RunnerProcess(_argv(config), tmp_path / "runner.log")
    runner.start()
    try:
        engine = eventually(
            lambda: engine_row(settings, "sf-remote"),
            "the runner advertised its engine",
            runner.output,
        )
        assert engine.runner_id is not None
        assert engine.version == "FakeFish 1", "the runner's own probe named the binary"
        row = runner_row(settings, "gpu-box")
        assert row.connected is True
        assert row.version

        run_id = enqueue(settings, engine.id)
        eventually(
            lambda: run_row(settings, run_id).status is RunStatus.DONE,
            f"run {run_id} finished",
            runner.output,
        )

        with get_sessionmaker(settings)() as session:
            evals = analysis.get_move_evals(session, run_id)
        assert len(evals) == 1
        assert evals[0].best_move_uci == "e2e4"
        assert evals[0].best_lines == [
            {"multipv": 1, "cp": 21, "mate": None, "pv": ["e2e4", "e7e5"]}
        ]

        # A second run is queued and the process is asked to stop before it can be
        # answered. It has to come back to the queue rather than sit `running` for a minute.
        second = enqueue(settings, engine.id)
        eventually(
            lambda: run_row(settings, second).status is not RunStatus.QUEUED,
            f"run {second} was picked up",
            runner.output,
        )
        assert runner.stop() == EXIT_OK, runner.output()
    finally:
        runner.stop(signal.SIGKILL)

    printed = runner.output()
    assert "SIGTERM received" in printed
    assert "runner 'gpu-box' stopped" in printed
    assert eventually(
        lambda: runner_row(settings, "gpu-box").connected is False, "the row says it left"
    )
    finished = run_row(settings, second)
    assert finished.status in (RunStatus.QUEUED, RunStatus.DONE)
    if finished.status is RunStatus.QUEUED:
        # Taken away, not failed: a stopped runner does not spend one of the run's attempts.
        assert finished.attempts == 0

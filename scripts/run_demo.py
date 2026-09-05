"""Serve the demo library from this checkout, on the ports `make run` uses.

The public demo, locally: the same two processes as `make run` — backend on 8765, Vite on
5273 — pointed at ``data/demo.db`` with ``BLUNDERBASE_RUNTIME_MODE=demo``. Same ports on
purpose: the demo is meant to be looked at in the browser that is already open on
localhost:5273, and this is what that address is showing while it runs. It therefore
replaces `make run` rather than sitting beside it, and says so plainly if one is already up.

Its own script rather than three lines of shell because two of the checks are worth making
before anything binds a port: a demo library from before the engines came out of it would
serve a broken Engines page, and "port already in use" out of uvicorn or Vite reads like a
crash rather than "your own dev server is running".
"""

from __future__ import annotations

import os
import signal
import socket
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "data" / "demo.db"
# `make run`'s ports, and the defaults in Settings and vite.config.ts.
API_PORT = 8765
WEB_PORT = 5273


def check_demo(path: Path) -> int:
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as connection:
        count = connection.execute("select count(*) from games").fetchone()[0]
        engines = connection.execute("select count(*) from engines").fetchone()[0]
        if engines:
            raise RuntimeError(
                "This demo contains engine configuration from an older build. Rebuild it with "
                "`uv run blunderbase demo create --force` before running the demo."
            )
        return count


def check_ports() -> None:
    """The demo takes over `make run`'s ports, so something on them is a running dev server
    (or another demo) rather than a conflict worth working around."""
    for port in (API_PORT, WEB_PORT):
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(("127.0.0.1", port))
            except OSError as exc:
                raise RuntimeError(
                    f"port {port} is already in use — the demo runs on the same ports as "
                    "`make run`. Stop that (or an earlier demo) and try again."
                ) from exc


def main() -> int:
    try:
        games = check_demo(DEMO)
        check_ports()
    except (RuntimeError, sqlite3.Error) as exc:
        print(f"demo: {exc}", file=sys.stderr)
        return 1
    print(f"Demo: {DEMO} ({games:,} games, no server engines)", flush=True)
    print(f"Open http://127.0.0.1:{WEB_PORT} — read-only, and analysis runs in the tab.")
    sys.stdout.flush()
    # The workers are off because a read-only library never queues anything; the runtime
    # mode is what opens the door without a password and refuses every write.
    env = {
        **os.environ,
        "BLUNDERBASE_DB_PATH": str(DEMO),
        "BLUNDERBASE_RUNTIME_MODE": "demo",
        "BLUNDERBASE_ANALYSIS_WORKERS": "false",
    }
    children: list[subprocess.Popen] = []

    def interrupted(_signum: int, _frame: object) -> None:
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        serve = [sys.executable, "-m", "backend.cli", "serve"]
        serve += ["--host", "127.0.0.1", "--port", str(API_PORT)]
        children.append(subprocess.Popen(serve, cwd=ROOT, env=env, start_new_session=True))
        # `--strictPort` so Vite fails loudly instead of quietly moving to 5274 and serving
        # a page whose `/api` proxy still points at 8765.
        web = ["pnpm", "dev", "--host", "127.0.0.1", "--port", str(WEB_PORT), "--strictPort"]
        children.append(
            subprocess.Popen(web, cwd=ROOT / "web", env=env, start_new_session=True)
        )
        while True:
            for child in children:
                code = child.poll()
                if code is not None:
                    print(f"demo: a server exited ({code}); stopping the demo.", file=sys.stderr)
                    return code or 1
            time.sleep(0.2)
    except KeyboardInterrupt:
        return 0
    finally:
        for child in children:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()


if __name__ == "__main__":
    raise SystemExit(main())

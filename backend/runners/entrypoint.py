"""`blunderbase-runner` — the console script the other machine runs.

Deliberately thin: read the arguments, read the yaml, set up logging and signals, and hand
over to `RunnerClient`. The only judgement here is the exit code, which the spec asks to be
readable from a supervisor's logs without a stack trace:

- `0` the runner was asked to stop and did
- `1` the configuration is wrong, or not one engine could be started
- `2` the server refused this runner's protocol version

A container restarting on `2` for ever is the failure this separation is for: the operator
needs to see "your runner is older than your server", not "it keeps crashing".
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging
import signal
import sys
from collections.abc import Sequence

from backend import __version__
from backend.runners.client import EXIT_CONFIG, EXIT_OK, RunnerClient
from backend.runners.config import CONFIG_ENV, RunnerConfig, RunnerConfigError

PROG = "blunderbase-runner"
LOG_FORMAT = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"

logger = logging.getLogger(__name__)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog=PROG, description="Run chess engines for a Blunderbase server on this machine"
    )
    parser.add_argument("--version", action="version", version=f"{PROG} {__version__}")
    parser.add_argument(
        "--config",
        metavar="PATH",
        help=f"the runner.yaml to read (default: ${CONFIG_ENV}, else the environment alone)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="probe every engine, open one connection, print what was accepted, and exit",
    )
    parser.add_argument(
        "--log-level",
        choices=("debug", "info", "warning", "error"),
        help="overrides log_level in the yaml",
    )
    return parser


def configure_logging(level: str) -> None:
    logging.basicConfig(level=getattr(logging, level.upper()), format=LOG_FORMAT, force=True)


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    # Enough logging to report a bad yaml before there is a yaml to read the level from.
    configure_logging(args.log_level or "info")
    try:
        config = RunnerConfig.load(args.config)
    except RunnerConfigError as exc:
        print(f"{PROG}: {exc}", file=sys.stderr)
        return EXIT_CONFIG
    configure_logging(args.log_level or config.log_level)

    client = RunnerClient(config)
    try:
        return asyncio.run(_serve(client, check=args.check))
    except KeyboardInterrupt:  # pragma: no cover - a terminal, not a test
        return EXIT_OK


async def _serve(client: RunnerClient, *, check: bool) -> int:
    """Run the client with the signals a supervisor sends it wired up."""
    if check:
        return await client.check()
    _install_signals(client)
    return await client.run()


def _install_signals(client: RunnerClient) -> None:
    """SIGINT and SIGTERM ask for a clean stop rather than killing a search mid-frame.

    Not every platform has them, and a signal handler is a nicety rather than a
    requirement: without one the process still stops, just less politely.
    """
    loop = asyncio.get_running_loop()
    for name in ("SIGINT", "SIGTERM"):
        received = getattr(signal, name, None)
        if received is None:  # pragma: no cover - Windows
            continue
        with contextlib.suppress(NotImplementedError, RuntimeError):
            loop.add_signal_handler(
                received, lambda name=name: _stop(client, name)  # type: ignore[misc]
            )


def _stop(client: RunnerClient, name: str) -> None:
    logger.info("%s received; finishing up", name)
    asyncio.ensure_future(client.stop())


if __name__ == "__main__":  # pragma: no cover - exercised as a console script
    raise SystemExit(main())

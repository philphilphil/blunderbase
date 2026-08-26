"""A scripted UCI engine that really is a process.

The adapters exist to drive a subprocess over a pipe, so the honest test drives a
subprocess over a pipe. This module is both the engine — run it as
`python fake_uci.py <scenario.json>` — and the helpers tests use to write a scenario.

A scenario is JSON so the engine stays a plain script with no import of the code it is
standing in for:

    {"name": "FakeFish 1", "options": [...], "go": [{"info": [...], "bestmove": "e2e4"}]}

Keys: `name`, `author`, `options` (dicts or raw `option name …` lines), `no_uciok`,
`exit_before_uciok`, `uciok_delay`, `go` (one reply per `go`, then `go_default`),
`go_default`, `stderr` (written to stderr on start; a `go` reply may carry its own, which
is how a crash gets last words for `AnalysisRun.stderr`), `log` (a path every command is
appended to as JSON, with the pid and a timestamp, which is what lets a pool test see two
processes overlap or not).

A `go` reply may also carry `hold`: print the info lines and then wait for `stop` before
answering `bestmove`, which is what `go infinite` looks like from the driver's side.
"""

from __future__ import annotations

import json
import os
import shlex
import sys
import time
from itertools import count
from pathlib import Path
from typing import Any

DEFAULT_GO = {"info": ["depth 10 score cp 21 nodes 1000 pv e2e4 e7e5"], "bestmove": "e2e4"}
STOCKFISH_OPTIONS = [
    {"name": "Threads", "type": "spin", "default": 1, "min": 1, "max": 8},
    {"name": "Hash", "type": "spin", "default": 16, "min": 1, "max": 1024},
    {"name": "UCI_ShowWDL", "type": "check", "default": False},
    {"name": "Style", "type": "combo", "default": "solid", "var": ["solid", "wild"]},
    {"name": "SyzygyPath", "type": "string", "default": "<empty>"},
    {"name": "MultiPV", "type": "spin", "default": 1, "min": 1, "max": 5},
]
MAIA_OPTIONS = [
    {"name": "MultiPV", "type": "spin", "default": 1, "min": 1, "max": 10},
    {"name": "SelfElo", "type": "spin", "default": 1500, "min": 1100, "max": 2000},
    {"name": "OppoElo", "type": "spin", "default": 1500, "min": 1100, "max": 2000},
    {"name": "VerboseMoveStats", "type": "check", "default": False},
]

_names = count()


# --- test-side helpers ----------------------------------------------------


def option(name: str, type: str, **fields: Any) -> dict[str, Any]:
    return {"name": name, "type": type, **fields}


def fake_engine(tmp_path: Path, **scenario: Any) -> list[str]:
    """The argv for one scripted engine process."""
    path = tmp_path / f"scenario-{next(_names)}.json"
    path.write_text(json.dumps(scenario), encoding="utf-8")
    return [sys.executable, str(Path(__file__).resolve()), str(path)]


def fake_engine_command(tmp_path: Path, **scenario: Any) -> str:
    """The same engine as one command line, the way an `Engine` row stores a path."""
    return shlex.join(fake_engine(tmp_path, **scenario))


def read_log(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def commands(path: Path, prefix: str = "") -> list[str]:
    return [entry["cmd"] for entry in read_log(path) if entry["cmd"].startswith(prefix)]


def overlapped(path: Path) -> bool:
    """Whether two `go` commands were ever being served at the same time."""
    spans = []
    starts: dict[int, float] = {}
    for entry in read_log(path):
        if entry["cmd"] == "go-start":
            starts[entry["pid"]] = entry["t"]
        elif entry["cmd"] == "go-end" and entry["pid"] in starts:
            spans.append((starts.pop(entry["pid"]), entry["t"]))
    spans.sort()
    return any(later[0] < earlier[1] for earlier, later in zip(spans, spans[1:], strict=False))


# --- the engine itself ----------------------------------------------------


def _say(text: str) -> None:
    sys.stdout.write(text + "\n")
    sys.stdout.flush()


def _complain(text: str | None) -> None:
    """Write to stderr, which is where a real engine puts its dying words."""
    if not text:
        return
    sys.stderr.write(text + "\n")
    sys.stderr.flush()


def _option_line(declared: Any) -> str:
    if isinstance(declared, str):
        return declared
    parts = [f"option name {declared['name']} type {declared['type']}"]
    default = declared.get("default")
    if isinstance(default, bool):
        parts.append(f"default {'true' if default else 'false'}")
    elif default is not None:
        parts.append(f"default {default}")
    for key in ("min", "max"):
        if declared.get(key) is not None:
            parts.append(f"{key} {declared[key]}")
    for value in declared.get("var") or []:
        parts.append(f"var {value}")
    return " ".join(parts)


def _logger(scenario: dict[str, Any]):
    target = scenario.get("log")

    def log(cmd: str) -> None:
        if not target:
            return
        entry = {"pid": os.getpid(), "t": time.time(), "cmd": cmd}
        with open(target, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry) + "\n")
            handle.flush()

    return log


def _may_crash(scenario: dict[str, Any]) -> bool:
    """`crash_once` is a file: the first process to die creates it, later ones behave.

    A replacement process re-reads the same scenario, so without this a test of "the pool
    replaces a dead engine" could only ever watch it die again.
    """
    marker = scenario.get("crash_once")
    if not marker:
        return True
    if os.path.exists(marker):
        return False
    Path(marker).write_text("crashed", encoding="utf-8")
    return True


def _held(log) -> bool:
    """Keep the search open until the driver says `stop`, as `go infinite` really does.

    A reply marked `hold` has printed its info lines and then simply does not answer: that
    is what an infinite search looks like from the outside, and it is what lets a test stop
    one, restart it at another position, or watch it hold a slot. False means `quit` came
    instead and there is no `bestmove` left to give.
    """
    while True:
        raw = sys.stdin.readline()
        if not raw:
            return False
        command = raw.strip()
        if not command:
            continue
        log(command)
        if command == "isready":
            _say("readyok")
        elif command == "stop":
            return True
        elif command == "quit":
            return False


def main(argv: list[str]) -> int:
    scenario: dict[str, Any] = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    log = _logger(scenario)
    log("start")
    _complain(scenario.get("stderr"))
    replies = list(scenario.get("go") or [])

    for raw in sys.stdin:
        command = raw.strip()
        if not command:
            continue
        log(command)
        if command == "uci":
            if scenario.get("exit_before_uciok"):
                return 0
            _say(f"id name {scenario.get('name', 'FakeFish 1')}")
            _say(f"id author {scenario.get('author', 'blunderbase tests')}")
            for declared in scenario.get("options") or []:
                _say(_option_line(declared))
            time.sleep(float(scenario.get("uciok_delay") or 0))
            if scenario.get("no_uciok"):
                continue
            _say("uciok")
        elif command == "isready":
            _say("readyok")
        elif command.startswith("go"):
            reply = replies.pop(0) if replies else (scenario.get("go_default") or DEFAULT_GO)
            if reply.get("crash") and not _may_crash(scenario):
                reply = scenario.get("go_default") or DEFAULT_GO
            log("go-start")
            time.sleep(float(reply.get("delay") or 0))
            _complain(reply.get("stderr"))
            if reply.get("crash"):
                log("go-crash")
                os._exit(1)
            for info in reply.get("info") or []:
                _say(f"info {info}")
            if reply.get("hold") and not _held(log):
                return 0
            _say(f"bestmove {reply.get('bestmove', 'e2e4')}")
            log("go-end")
        elif command == "quit":
            return 0
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised as a subprocess
    raise SystemExit(main(sys.argv))

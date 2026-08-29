"""`runner.yaml`: everything the runner process knows before it dials out.

The file is small on purpose. A runner is not a second deployment — it has no database, no
web app and no opinions about analysis — so its configuration is the address to dial, the
token to present, how many jobs it will hold at once, and which binaries live on that
machine.

Two rules shape the reading of it:

- **A key nobody recognises is a refusal, not a shrug.** The same posture as the `Input`
  request models: a typo in `slots` that silently left the default in place would show up
  as a runner that is mysteriously slow, hours later and on somebody else's machine. Every
  refusal names the field *and* the file it came from, because the person reading the log
  is not necessarily the person who wrote the yaml.
- **The environment beats the file.** A token in a compose `environment:` block wins over
  one in a mounted yaml, so the secret can stay out of the file that gets copied around.

The engine list is this machine's truth: the server records what is advertised here, and
the Engines page shows those rows read-only. Nothing in this module talks to a server, a
database or an engine — `RunnerConfig` is a value, and `client.py` is what acts on it.
"""

from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, NoReturn
from urllib.parse import urlsplit, urlunsplit

from backend.runners.protocol import ENGINE_KINDS, TIERS

# Where the runner looks when no `--config` is given, and the three values a container is
# most likely to want to set without rewriting a mounted file.
CONFIG_ENV = "BLUNDERBASE_RUNNER_CONFIG"
ENV_OVERRIDES = {
    "server": "BLUNDERBASE_RUNNER_SERVER",
    "token": "BLUNDERBASE_RUNNER_TOKEN",
    "name": "BLUNDERBASE_RUNNER_NAME",
    "slots": "BLUNDERBASE_RUNNER_SLOTS",
}
ENVIRONMENT = "<environment>"

UCI_KIND = "uci"
MAIA_KIND = "maia"

LOG_LEVELS = ("debug", "info", "warning", "error")
SCHEMES = {"http": "ws", "https": "wss"}

WS_PATH = "/runner/ws"
POLL_PATH = "/runner/poll"
RUNS_PATH = "/runner/runs"

# How a runner that cannot set a header presents its token. The browser's `WebSocket`
# constructor takes a URL and a list of subprotocols and nothing else, so a tab offers two
# of them — this sentinel, which names the scheme, and the token itself as the second
# entry — and the server echoes the sentinel back on the accept. The definition lives here
# because both halves of the handshake have to spell it identically, and this module is
# already where the paths a runner dials are written down.
#
# Deliberately **not** a query parameter, which is the obvious thing to reach for next: a
# bearer token in a URL is written into every access log and proxy log the request passes
# through, and there is no taking it back out of them.
WS_SUBPROTOCOL = "blunderbase.runner.v1"

TOP_LEVEL = frozenset(
    {
        "server",
        "token",
        "name",
        "slots",
        "verify_tls",
        "poll_seconds",
        "log_level",
        "reconnect",
        "engines",
    }
)
RECONNECT_KEYS = frozenset(
    {"initial_seconds", "max_seconds", "websocket_failures", "retry_websocket_seconds"}
)
ENGINE_KEYS = frozenset({"name", "path", "kind", "tier", "options", "streams", "instances"})


class RunnerConfigError(ValueError):
    """The configuration is wrong, said with the field and the file that carried it."""


@dataclass(frozen=True, slots=True)
class EngineConfig:
    """One binary on this machine, as the advertisement will describe it."""

    name: str
    path: str
    kind: str = UCI_KIND
    # Accepted and ignored, and no longer documented as a thing to set: which engine serves
    # which job is the owner's assignment on the server, not a claim this machine can make.
    # A yaml that still carries `tier:` starts rather than being refused.
    tier: str | None = None
    options: dict[str, Any] = field(default_factory=dict)
    # None means "whatever this kind of engine can do"; a yaml may say otherwise.
    streams: bool | None = None
    # How many of this binary may run at once on this machine. None is the default and means
    # one per slot, which is right for a CPU engine. A Maia holding one GPU is `instances: 1`:
    # a single process, with the slots that want it queueing on it rather than starting a
    # second copy and running the card out of memory.
    instances: int | None = None

    @property
    def streams_enabled(self) -> bool:
        """Whether this engine may drive the analysis board.

        Maia answers with a move policy rather than a search, so it never streams however
        the yaml is written; a UCI engine does unless it is switched off here.
        """
        if self.kind == MAIA_KIND:
            return False
        return True if self.streams is None else bool(self.streams)


@dataclass(frozen=True, slots=True)
class Reconnect:
    """How hard the runner tries, and when it stops trying the socket at all."""

    initial_seconds: float = 1.0
    max_seconds: float = 60.0
    # Consecutive socket failures before the runner starts polling instead. Three, because
    # one is a restart and two is a restart with bad luck.
    websocket_failures: int = 3
    retry_websocket_seconds: float = 60.0


@dataclass(frozen=True, slots=True)
class RunnerConfig:
    """A whole `runner.yaml`, validated."""

    server: str
    token: str
    name: str
    slots: int = 1
    verify_tls: bool = True
    poll_seconds: float = 5.0
    log_level: str = "info"
    reconnect: Reconnect = field(default_factory=Reconnect)
    engines: tuple[EngineConfig, ...] = ()

    # --- reading ----------------------------------------------------------

    @classmethod
    def load(cls, path: str | Path | None = None) -> RunnerConfig:
        """Read the yaml at `path`, then let the environment overrule it.

        With no path and no `BLUNDERBASE_RUNNER_CONFIG` the environment is the whole of the
        configuration, which is what a container that mounts nothing does.
        """
        import yaml

        resolved = _config_path(path)
        if resolved is None:
            return cls.from_mapping(_environment(), source=ENVIRONMENT)
        if not resolved.is_file():
            raise RunnerConfigError(f"{resolved}: no such file")
        try:
            data = yaml.safe_load(resolved.read_text(encoding="utf-8"))
        except (OSError, yaml.YAMLError) as exc:
            raise RunnerConfigError(f"{resolved}: could not be read: {exc}") from exc
        if data is None:
            data = {}
        if not isinstance(data, Mapping):
            raise RunnerConfigError(f"{resolved}: a runner.yaml is a mapping of settings")
        return cls.from_mapping({**data, **_environment()}, source=str(resolved))

    @classmethod
    def from_mapping(cls, data: Mapping[str, Any], *, source: str = "<config>") -> RunnerConfig:
        """One already-read mapping, checked key by key."""
        if not isinstance(data, Mapping):
            raise RunnerConfigError(f"{source}: a runner.yaml is a mapping of settings")
        unknown = sorted(set(data) - TOP_LEVEL)
        if unknown:
            known = ", ".join(sorted(TOP_LEVEL))
            _refuse(source, f"{', '.join(unknown)} is not a runner setting (it knows {known})")
        return cls(
            server=_server(source, data.get("server")),
            token=_required_text(source, "token", data.get("token")),
            name=_required_text(source, "name", data.get("name")),
            slots=_positive_int(source, "slots", data.get("slots"), default=1),
            verify_tls=_boolean(source, "verify_tls", data.get("verify_tls"), default=True),
            poll_seconds=_positive_float(
                source, "poll_seconds", data.get("poll_seconds"), default=5.0
            ),
            log_level=_log_level(source, data.get("log_level")),
            reconnect=_reconnect(source, data.get("reconnect")),
            engines=_engines(source, data.get("engines")),
        )

    # --- where to dial ----------------------------------------------------

    @property
    def ws_url(self) -> str:
        """The socket, derived from the server URL: http becomes ws, https becomes wss."""
        split = urlsplit(self.server)
        return urlunsplit(
            (SCHEMES[split.scheme], split.netloc, _join(split.path, WS_PATH), "", "")
        )

    @property
    def poll_url(self) -> str:
        return self.url(POLL_PATH)

    def run_url(self, run_id: int, action: str) -> str:
        """`/runner/runs/{id}/heartbeat` and `/runner/runs/{id}/complete`."""
        return self.url(f"{RUNS_PATH}/{int(run_id)}/{action}")

    def url(self, path: str) -> str:
        """One of the server's own paths, under whatever prefix the server URL carries."""
        split = urlsplit(self.server)
        return urlunsplit((split.scheme, split.netloc, _join(split.path, path), "", ""))

    @property
    def engines_by_name(self) -> dict[str, EngineConfig]:
        return {engine.name: engine for engine in self.engines}

    def maia_named(self, name: str | None) -> EngineConfig | None:
        """The Maia this machine would use for a dispatch, or None because it has none."""
        if not name:
            return None
        engine = self.engines_by_name.get(name)
        return engine if engine is not None and engine.kind == MAIA_KIND else None


# --- reading one field at a time -------------------------------------------


def _refuse(source: str, message: str) -> NoReturn:
    raise RunnerConfigError(f"{source}: {message}")


def _config_path(path: str | Path | None) -> Path | None:
    chosen = path if path is not None else os.environ.get(CONFIG_ENV, "").strip()
    if not chosen:
        return None
    return Path(chosen).expanduser()


def _environment() -> dict[str, str]:
    """The overrides that are actually set. An empty variable is not one."""
    found: dict[str, str] = {}
    for key, variable in ENV_OVERRIDES.items():
        value = os.environ.get(variable, "").strip()
        if value:
            found[key] = value
    return found


def _required_text(source: str, key: str, value: Any) -> str:
    if value is None or not str(value).strip():
        _refuse(source, f"{key} is required")
    return str(value).strip()


def _server(source: str, value: Any) -> str:
    url = _required_text(source, "server", value).rstrip("/")
    split = urlsplit(url)
    if split.scheme not in SCHEMES:
        _refuse(source, f"server is an http(s) URL, not {url!r}")
    if not split.netloc:
        _refuse(source, f"server names no host: {url!r}")
    return url


def _positive_int(source: str, key: str, value: Any, *, default: int) -> int:
    if value is None:
        return default
    try:
        number = int(value)
    except (TypeError, ValueError):
        _refuse(source, f"{key} is a whole number, not {value!r}")
    if number < 1:
        _refuse(source, f"{key} is at least 1, not {number}")
    return number


def _positive_float(source: str, key: str, value: Any, *, default: float) -> float:
    if value is None:
        return default
    try:
        number = float(value)
    except (TypeError, ValueError):
        _refuse(source, f"{key} is a number of seconds, not {value!r}")
    if number <= 0:
        _refuse(source, f"{key} is above zero, not {number}")
    return number


def _boolean(source: str, key: str, value: Any, *, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in {"true", "yes", "on", "1"}:
        return True
    if text in {"false", "no", "off", "0"}:
        return False
    _refuse(source, f"{key} is true or false, not {value!r}")


def _log_level(source: str, value: Any) -> str:
    if value is None:
        return "info"
    level = str(value).strip().lower()
    if level not in LOG_LEVELS:
        _refuse(source, f"log_level is one of {', '.join(LOG_LEVELS)}, not {value!r}")
    return level


def _reconnect(source: str, value: Any) -> Reconnect:
    if value is None:
        return Reconnect()
    if not isinstance(value, Mapping):
        _refuse(source, "reconnect is a mapping of settings")
    unknown = sorted(set(value) - RECONNECT_KEYS)
    if unknown:
        _refuse(source, f"reconnect carries {', '.join(unknown)}, which it does not know")
    defaults = Reconnect()
    return Reconnect(
        initial_seconds=_positive_float(
            source, "reconnect.initial_seconds", value.get("initial_seconds"),
            default=defaults.initial_seconds,
        ),
        max_seconds=_positive_float(
            source, "reconnect.max_seconds", value.get("max_seconds"),
            default=defaults.max_seconds,
        ),
        websocket_failures=_positive_int(
            source, "reconnect.websocket_failures", value.get("websocket_failures"),
            default=defaults.websocket_failures,
        ),
        retry_websocket_seconds=_positive_float(
            source, "reconnect.retry_websocket_seconds", value.get("retry_websocket_seconds"),
            default=defaults.retry_websocket_seconds,
        ),
    )


def _engines(source: str, value: Any) -> tuple[EngineConfig, ...]:
    if value is None:
        return ()
    if isinstance(value, str | bytes) or not isinstance(value, Sequence):
        _refuse(source, "engines is a list, one entry per binary on this machine")
    engines: list[EngineConfig] = []
    seen: set[str] = set()
    for index, entry in enumerate(value):
        engine = _engine(source, index, entry)
        if engine.name in seen:
            _refuse(source, f"two engines are called {engine.name!r}")
        seen.add(engine.name)
        engines.append(engine)
    return tuple(engines)


def _engine(source: str, index: int, entry: Any) -> EngineConfig:
    where = f"engines[{index}]"
    if not isinstance(entry, Mapping):
        _refuse(source, f"{where} is a mapping of settings")
    unknown = sorted(set(entry) - ENGINE_KEYS)
    if unknown:
        _refuse(source, f"{where} carries {', '.join(unknown)}, which an engine does not know")
    name = _required_text(source, f"{where}.name", entry.get("name"))
    path = _required_text(source, f"{where}.path", entry.get("path"))
    kind = str(entry.get("kind") or UCI_KIND).strip().lower()
    if kind not in ENGINE_KINDS:
        _refuse(source, f"{name}: kind is one of {', '.join(ENGINE_KINDS)}, not {kind!r}")
    tier = entry.get("tier")
    if tier is not None and str(tier) not in TIERS:
        _refuse(source, f"{name}: tier is one of {', '.join(TIERS)}, not {tier!r}")
    options = entry.get("options") or {}
    if not isinstance(options, Mapping):
        _refuse(source, f"{name}: options is a mapping of UCI option names to values")
    streams = entry.get("streams")
    # `_positive_int` needs a default and there is none: an absent `instances` stays None,
    # which is not the same as any number the yaml could have written.
    instances = entry.get("instances")
    return EngineConfig(
        name=name,
        path=path,
        kind=kind,
        tier=None if tier is None else str(tier),
        options=dict(options),
        streams=None if streams is None else _boolean(source, f"{name}.streams", streams,
                                                      default=True),
        instances=None if instances is None else _positive_int(source, f"{name}.instances",
                                                               instances, default=1),
    )


def _join(prefix: str, path: str) -> str:
    """`/bb` + `/runner/ws` — a server behind a path prefix is still reachable."""
    return f"{prefix.rstrip('/')}{path}"

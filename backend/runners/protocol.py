"""The runner wire contract: every frame both halves send, and how a payload is spelled.

One JSON object per message, always carrying a `type`. The protocol version is exchanged
at the handshake and a mismatch is refused there rather than tolerated field by field —
a runner and a server that disagree about the shape of a `RunPlan` must not discover it
halfway through a game.

Three decisions are worth knowing before reading the rest:

- **A frame is a plain dict, not a class per message.** Twenty dataclasses whose only
  purpose is to be turned back into dicts would be twenty places for the two sides to
  drift; instead there is one builder per frame, a `REQUIRED` table naming what each one
  must carry, and `validate` to enforce it on the way in. The receiver's own handler is
  what reads the optional fields, because it is the only one that knows which it needs.
- **`MoveEval` crosses the wire without its `run_id`.** The row is unattached until
  `complete_run` binds it to the run the server thinks is current, which is precisely what
  keeps a replayed payload from writing itself onto somebody else's run.
- **Nothing here opens a database session.** The module is imported by the server gateway
  and by the runner process, and only one of them has a database at all.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from backend.db.enums import Classification, Color, EngineKind, Tier
from backend.db.models import MoveEval

if TYPE_CHECKING:  # pragma: no cover - typing only
    from backend.adapters.stockfish import EngineProbe
    from backend.services.analysis import RunPlan

PROTO_VERSION = 1

# --- message types ---------------------------------------------------------

HELLO = "hello"
WELCOME = "welcome"
ADVERTISE_ENGINES = "advertise_engines"
ENGINES_ACCEPTED = "engines_accepted"
PING = "ping"
PONG = "pong"
ERROR = "error"

RUN_DISPATCH = "run_dispatch"
RUN_PROGRESS = "run_progress"
RUN_COMPLETE = "run_complete"
RUN_FAILED = "run_failed"
RUN_CANCEL = "run_cancel"
RUN_CANCELLED = "run_cancelled"
RUN_ACK = "run_ack"

STREAM_OPEN = "stream_open"
STREAM_STARTED = "stream_started"
STREAM_SNAPSHOT = "stream_snapshot"
STREAM_RESTART = "stream_restart"
STREAM_CLOSE = "stream_close"
STREAM_CLOSED = "stream_closed"

# What a frame of each type has to carry beyond its `type`. Anything else on it is the
# handler's business: a field one side does not know about is ignored, never fatal.
REQUIRED: dict[str, tuple[str, ...]] = {
    HELLO: ("proto", "runner"),
    WELCOME: ("proto", "runner_id"),
    ADVERTISE_ENGINES: ("engines",),
    ENGINES_ACCEPTED: ("engines",),
    PING: (),
    PONG: (),
    ERROR: ("code", "message"),
    RUN_DISPATCH: ("run_id", "attempt_token", "engine", "plan"),
    RUN_PROGRESS: ("run_id", "attempt_token"),
    RUN_COMPLETE: ("run_id", "attempt_token", "evals"),
    RUN_FAILED: ("run_id", "attempt_token", "error"),
    RUN_CANCEL: ("run_id", "reason"),
    RUN_CANCELLED: ("run_id",),
    RUN_ACK: ("run_id", "accepted"),
    STREAM_OPEN: ("session_id", "engine", "fen"),
    STREAM_STARTED: ("session_id",),
    STREAM_SNAPSHOT: ("session_id", "seq"),
    STREAM_RESTART: ("session_id",),
    STREAM_CLOSE: ("session_id", "reason"),
    STREAM_CLOSED: ("session_id", "reason"),
}

# --- error codes -----------------------------------------------------------

ERROR_PROTO_MISMATCH = "proto_mismatch"
ERROR_UNAUTHORIZED = "unauthorized"
ERROR_RATE_LIMITED = "rate_limited"
ERROR_REVOKED = "revoked"
ERROR_DUPLICATE_CONNECTION = "duplicate_connection"
ERROR_UNKNOWN_MESSAGE = "unknown_message"
ERROR_BAD_PAYLOAD = "bad_payload"
ERROR_UNKNOWN_RUN = "unknown_run"
ERROR_STALE_RESULT = "stale_result"
ERROR_UNKNOWN_ENGINE = "unknown_engine"
ERROR_DUPLICATE_ENGINE = "duplicate_engine"
ERROR_SLOTS_EXHAUSTED = "slots_exhausted"
ERROR_STREAM_UNAVAILABLE = "stream_unavailable"

# WebSocket close codes. The 4000 range is the application's own, and these follow
# `api/auth.py`'s `WS_CLOSE_UNAUTHORIZED = 4401`: the HTTP status a refusal would have
# been, plus 4000, so a runner's log line says *why* rather than "the socket closed".
WS_CLOSE_UNAUTHORIZED = 4401
WS_CLOSE_REVOKED = 4403
WS_CLOSE_DUPLICATE = 4409
WS_CLOSE_PROTO_MISMATCH = 4426
WS_CLOSE_RATE_LIMITED = 4429

CLOSE_REASONS: dict[int, str] = {
    WS_CLOSE_UNAUTHORIZED: ERROR_UNAUTHORIZED,
    WS_CLOSE_REVOKED: ERROR_REVOKED,
    WS_CLOSE_DUPLICATE: ERROR_DUPLICATE_CONNECTION,
    WS_CLOSE_PROTO_MISMATCH: ERROR_PROTO_MISMATCH,
    WS_CLOSE_RATE_LIMITED: ERROR_RATE_LIMITED,
}

# Why a stream ended, and why a run was taken away from the runner holding it.
STREAM_REASONS = ("closed", "replaced", "idle", "engine_failed", "runner_gone")
CANCEL_REASONS = ("requeued", "revoked", "preempted", "stolen")

ENGINE_KINDS = tuple(kind.value for kind in EngineKind)
TIERS = tuple(tier.value for tier in Tier)


class ProtocolError(ValueError):
    """A frame that does not decode: bad JSON, no type, or a field that is not there."""


# --- framing ---------------------------------------------------------------


def encode(frame: Mapping[str, Any]) -> str:
    """One frame as the text that goes down the socket."""
    try:
        return json.dumps(dict(frame), separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise ProtocolError(f"frame is not serialisable: {exc}") from exc


def decode(text: str | bytes) -> dict[str, Any]:
    """One frame back out of the text, or a `ProtocolError` naming what was wrong."""
    try:
        frame = json.loads(text)
    except (TypeError, ValueError) as exc:
        raise ProtocolError(f"frame is not JSON: {exc}") from exc
    if not isinstance(frame, dict):
        raise ProtocolError(f"a frame is an object, not {type(frame).__name__}")
    return frame


def message_type(frame: Mapping[str, Any]) -> str:
    """The `type` of a frame, refused rather than defaulted when it is missing."""
    value = frame.get("type")
    if not isinstance(value, str) or not value:
        raise ProtocolError("frame carries no type")
    return value


def validate(frame: Mapping[str, Any]) -> dict[str, Any]:
    """Check a decoded frame against `REQUIRED` and hand it back as a plain dict.

    Unknown keys survive untouched: a newer peer adding a field must not break an older
    one. An unknown *type* does not, because there is nothing sensible to do with it.
    """
    kind = message_type(frame)
    if kind not in REQUIRED:
        raise ProtocolError(f"{kind!r} is not a message this protocol defines")
    missing = [name for name in REQUIRED[kind] if frame.get(name) is None]
    if missing:
        raise ProtocolError(f"{kind} is missing {', '.join(missing)}")
    return dict(frame)


# --- control frames --------------------------------------------------------


def hello(
    *,
    runner: str,
    version: str | None = None,
    slots: int = 1,
    engines: Sequence[Mapping[str, Any]] = (),
    active_runs: Sequence[Mapping[str, Any]] = (),
) -> dict[str, Any]:
    """The runner's first frame. `active_runs` is what a reconnect is still executing."""
    return {
        "type": HELLO,
        "proto": PROTO_VERSION,
        "runner": runner,
        "version": version,
        "slots": int(slots),
        "engines": [dict(engine) for engine in engines],
        "active_runs": [dict(entry) for entry in active_runs],
    }


def welcome(
    *,
    runner_id: int,
    runner: str,
    server_version: str | None = None,
    slots: int = 1,
    heartbeat_seconds: float = 10.0,
    engines: Sequence[Mapping[str, Any]] = (),
    cancelled_runs: Sequence[int] = (),
) -> dict[str, Any]:
    """The server's reply. `runner` and `slots` here are authoritative, not the yaml's."""
    return {
        "type": WELCOME,
        "proto": PROTO_VERSION,
        "runner_id": int(runner_id),
        "runner": runner,
        "server_version": server_version,
        "slots": int(slots),
        "heartbeat_seconds": float(heartbeat_seconds),
        "engines": [dict(engine) for engine in engines],
        "cancelled_runs": [int(run_id) for run_id in cancelled_runs],
    }


def advertise_engines(engines: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    return {"type": ADVERTISE_ENGINES, "engines": [dict(engine) for engine in engines]}


def engines_accepted(engines: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    return {"type": ENGINES_ACCEPTED, "engines": [dict(engine) for engine in engines]}


def ping(t: float) -> dict[str, Any]:
    return {"type": PING, "t": float(t)}


def pong(t: float) -> dict[str, Any]:
    return {"type": PONG, "t": float(t)}


def error(code: str, message: str, *, fatal: bool = False) -> dict[str, Any]:
    """Something the other side has to be told. A fatal one is followed by a close."""
    return {"type": ERROR, "code": code, "message": message, "fatal": bool(fatal)}


# --- job frames ------------------------------------------------------------


def run_dispatch(
    *,
    run_id: int,
    attempt_token: str,
    engine: str,
    plan: Mapping[str, Any],
    maia_engine: str | None = None,
) -> dict[str, Any]:
    """One claimed run, handed to the runner that will execute it."""
    return {
        "type": RUN_DISPATCH,
        "run_id": int(run_id),
        "attempt_token": attempt_token,
        "engine": engine,
        "maia_engine": maia_engine,
        "plan": dict(plan),
    }


def run_progress(*, run_id: int, attempt_token: str, done: int, total: int) -> dict[str, Any]:
    """Progress, and the run's heartbeat: a deep position must not look like a dead runner."""
    return {
        "type": RUN_PROGRESS,
        "run_id": int(run_id),
        "attempt_token": attempt_token,
        "done": int(done),
        "total": int(total),
    }


def run_complete(
    *,
    run_id: int,
    attempt_token: str,
    evals: Sequence[Mapping[str, Any]],
    note: str | None = None,
    stderr: str | None = None,
) -> dict[str, Any]:
    return {
        "type": RUN_COMPLETE,
        "run_id": int(run_id),
        "attempt_token": attempt_token,
        "evals": [dict(row) for row in evals],
        "note": note,
        "stderr": stderr,
    }


def run_failed(
    *,
    run_id: int,
    attempt_token: str,
    error: str,
    stderr: str | None = None,
    retry: bool = True,
) -> dict[str, Any]:
    return {
        "type": RUN_FAILED,
        "run_id": int(run_id),
        "attempt_token": attempt_token,
        "error": error,
        "stderr": stderr,
        "retry": bool(retry),
    }


def run_ack(*, run_id: int, accepted: bool, reason: str | None = None) -> dict[str, Any]:
    """What became of a result. A dropped payload is an ack, not a silence."""
    return {"type": RUN_ACK, "run_id": int(run_id), "accepted": bool(accepted), "reason": reason}


def run_cancel(*, run_id: int, reason: str) -> dict[str, Any]:
    return {"type": RUN_CANCEL, "run_id": int(run_id), "reason": reason}


def run_cancelled(*, run_id: int) -> dict[str, Any]:
    return {"type": RUN_CANCELLED, "run_id": int(run_id)}


# --- stream frames ---------------------------------------------------------


def stream_open(
    *, session_id: str, engine: str, fen: str, multipv: int = 1, interval_ms: int = 500
) -> dict[str, Any]:
    return {
        "type": STREAM_OPEN,
        "session_id": session_id,
        "engine": engine,
        "fen": fen,
        "multipv": int(multipv),
        "interval_ms": int(interval_ms),
    }


def stream_started(*, session_id: str, engine: str) -> dict[str, Any]:
    return {"type": STREAM_STARTED, "session_id": session_id, "engine": engine}


def snapshot_frame(
    session_id: str,
    seq: int,
    *,
    depth: int | None = None,
    nodes: int | None = None,
    nps: int | None = None,
    time_ms: int | None = None,
    lines: Sequence[Mapping[str, Any]] = (),
) -> dict[str, Any]:
    """One throttled picture of a running search.

    `lines` are `MoveEval.best_lines`' own shape — `{"multipv","cp","mate","pv"}`, from the
    side to move's point of view — so a snapshot and a stored evaluation speak one
    vocabulary all the way from the engine to the board. Raw UCI text never leaves the host
    that produced it.
    """
    return {
        "type": STREAM_SNAPSHOT,
        "session_id": session_id,
        "seq": int(seq),
        "depth": depth,
        "nodes": nodes,
        "nps": nps,
        "time_ms": time_ms,
        "lines": [dict(entry) for entry in lines],
    }


def stream_restart(*, session_id: str, fen: str, multipv: int | None = None) -> dict[str, Any]:
    """A position change: stop and go again on the same slot, never a teardown."""
    return {
        "type": STREAM_RESTART,
        "session_id": session_id,
        "fen": fen,
        "multipv": None if multipv is None else int(multipv),
    }


def stream_close(*, session_id: str, reason: str = "closed") -> dict[str, Any]:
    return {"type": STREAM_CLOSE, "session_id": session_id, "reason": reason}


def stream_closed(
    *, session_id: str, reason: str = "closed", error: str | None = None
) -> dict[str, Any]:
    return {"type": STREAM_CLOSED, "session_id": session_id, "reason": reason, "error": error}


# --- payloads: the run plan ------------------------------------------------


def encode_plan(plan: RunPlan) -> dict[str, Any]:
    """A `RunPlan` as JSON: tuples become arrays, enums become their stored string."""
    return {
        "run_id": plan.run_id,
        "tier": Tier(plan.tier).value,
        "game_id": plan.game_id,
        "fen": plan.fen,
        "variant": plan.variant,
        "initial_fen": plan.initial_fen,
        "moves_uci": list(plan.moves_uci),
        "moves_san": list(plan.moves_san),
        # A null in here is meaningful: that ply's position is not stored.
        "position_ids": list(plan.position_ids),
        "ply_start": plan.ply_start,
        "ply_end": plan.ply_end,
        "nodes": plan.nodes,
        "depth": plan.depth,
        "multipv": plan.multipv,
        "thresholds": {
            "inaccuracy": plan.thresholds.inaccuracy,
            "mistake": plan.thresholds.mistake,
            "blunder": plan.thresholds.blunder,
        },
        "owner_color": None if plan.owner_color is None else Color(plan.owner_color).value,
        "owner_rating": plan.owner_rating,
        # The level Maia is asked at is resolved on the runner, not here, so what crosses
        # the wire is what it is resolved from: the target where the deployment configures
        # one, and the owner's rating in this game where it does not. Either way the runner
        # computes the same plies at the same level as this host would have.
        "maia_target_elo": plan.maia_target_elo,
    }


def decode_plan(data: Mapping[str, Any]) -> RunPlan:
    """The inverse of `encode_plan`, field for field."""
    from backend.services.analysis import RunPlan, Thresholds

    thresholds = data.get("thresholds")
    if not isinstance(thresholds, Mapping):
        raise ProtocolError("a plan carries its classification thresholds")
    try:
        return RunPlan(
            run_id=_int(data, "run_id"),
            tier=Tier(_str(data, "tier")),
            game_id=_optional_int(data, "game_id"),
            fen=_optional_str(data, "fen"),
            variant=_str(data, "variant"),
            initial_fen=_optional_str(data, "initial_fen"),
            moves_uci=tuple(str(move) for move in _sequence(data, "moves_uci")),
            moves_san=tuple(
                None if move is None else str(move) for move in _sequence(data, "moves_san")
            ),
            position_ids=tuple(
                None if value is None else int(value)
                for value in _sequence(data, "position_ids")
            ),
            ply_start=_int(data, "ply_start"),
            ply_end=_int(data, "ply_end"),
            nodes=_int(data, "nodes"),
            depth=_optional_int(data, "depth"),
            multipv=_int(data, "multipv"),
            thresholds=Thresholds(
                inaccuracy=float(thresholds["inaccuracy"]),
                mistake=float(thresholds["mistake"]),
                blunder=float(thresholds["blunder"]),
            ),
            owner_color=(
                None
                if data.get("owner_color") is None
                else Color(_str(data, "owner_color"))
            ),
            owner_rating=_optional_int(data, "owner_rating"),
            maia_target_elo=_optional_int(data, "maia_target_elo"),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise ProtocolError(f"plan does not decode: {exc}") from exc


# --- payloads: the evaluations ---------------------------------------------

# Every `MoveEval` column that crosses the wire. `id` and `run_id` deliberately do not:
# the row arrives unattached and `complete_run` binds it to the run it is answering.
EVAL_FIELDS = (
    "ply",
    "position_id",
    "move_uci",
    "move_san",
    "eval_before_cp",
    "eval_before_mate",
    "eval_after_cp",
    "eval_after_mate",
    "win_before",
    "win_after",
    "win_loss",
    "best_move_uci",
    "best_lines",
    "maia_policy",
)


def encode_eval(row: MoveEval) -> dict[str, Any]:
    """One `MoveEval` as JSON, without the run it belongs to."""
    payload: dict[str, Any] = {name: getattr(row, name) for name in EVAL_FIELDS}
    payload["classification"] = (
        None if row.classification is None else Classification(row.classification).value
    )
    return payload


def decode_eval(data: Mapping[str, Any]) -> MoveEval:
    """One unattached `MoveEval`, ready for `complete_run` to claim."""
    payload: dict[str, Any] = {name: data.get(name) for name in EVAL_FIELDS}
    payload["ply"] = _int(data, "ply")
    try:
        row = MoveEval(**payload)
    except (TypeError, ValueError) as exc:
        raise ProtocolError(f"evaluation does not decode: {exc}") from exc
    classification = data.get("classification")
    if classification is not None:
        try:
            row.classification = Classification(classification)
        except ValueError as exc:
            raise ProtocolError(f"{classification!r} is not a classification") from exc
    return row


def encode_evals(rows: Sequence[MoveEval]) -> list[dict[str, Any]]:
    return [encode_eval(row) for row in rows]


def decode_evals(data: Sequence[Mapping[str, Any]]) -> list[MoveEval]:
    if not isinstance(data, Sequence) or isinstance(data, str | bytes):
        raise ProtocolError("evaluations arrive as a list")
    return [decode_eval(entry) for entry in data]


# --- payloads: what an engine declares -------------------------------------


def encode_probe(probe: EngineProbe) -> list[dict[str, Any]]:
    """The options a binary declared, as the runner's advertisement carries them."""
    return [option.as_dict() for option in probe.options]


def decode_probe(
    name: str | None, author: str | None, options: Sequence[Mapping[str, Any]]
) -> EngineProbe:
    """Rebuild an `EngineProbe` from an advertisement, so the server can validate against it.

    A remote binary cannot be probed from here, so the runner's own probe is what the
    stored options are checked against — a bad option is then a rejected engine with a
    reason, rather than a run that fails on another machine an hour later.
    """
    from backend.adapters.stockfish import EngineProbe, UciOption

    declared: list[UciOption] = []
    for entry in options or ():
        if not isinstance(entry, Mapping):
            raise ProtocolError("a declared option is an object")
        option_name = entry.get("name")
        if not isinstance(option_name, str) or not option_name:
            raise ProtocolError("a declared option needs a name")
        try:
            declared.append(
                UciOption(
                    name=option_name,
                    type=str(entry.get("type") or "string"),
                    default=entry.get("default"),
                    min=_as_int(entry.get("min")),
                    max=_as_int(entry.get("max")),
                    var=tuple(str(value) for value in entry.get("var") or ()),
                    managed=bool(entry.get("managed", False)),
                )
            )
        except (TypeError, ValueError) as exc:
            raise ProtocolError(f"{option_name!r} does not decode: {exc}") from exc
    return EngineProbe(name=name, author=author, options=tuple(declared))


@dataclass(frozen=True, slots=True)
class EngineAd:
    """One engine a runner says it can run, as it reaches the registry.

    `path` is a path on the runner's filesystem and is read-only here: the truth about a
    remote engine is the runner's yaml, and the server records rather than configures it.
    """

    name: str
    kind: str = EngineKind.UCI.value
    path: str = ""
    version: str | None = None
    tier: str | None = None
    options: dict[str, Any] = field(default_factory=dict)
    declared_options: tuple[dict[str, Any], ...] = ()
    streams: bool = True

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> EngineAd:
        if not isinstance(data, Mapping):
            raise ProtocolError("an engine advertisement is an object")
        name = data.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ProtocolError("an advertised engine needs a name")
        kind = str(data.get("kind") or EngineKind.UCI.value)
        if kind not in ENGINE_KINDS:
            raise ProtocolError(f"{kind!r} is not an engine kind ({', '.join(ENGINE_KINDS)})")
        path = data.get("path")
        if not isinstance(path, str) or not path.strip():
            raise ProtocolError(f"{name!r} advertises no path on the runner")
        tier = data.get("tier")
        if tier is not None and str(tier) not in TIERS:
            raise ProtocolError(f"{tier!r} is not a tier ({', '.join(TIERS)})")
        options = data.get("options") or {}
        if not isinstance(options, Mapping):
            raise ProtocolError(f"{name!r} advertises options that are not an object")
        declared = data.get("declared_options") or ()
        if isinstance(declared, str | bytes) or not isinstance(declared, Sequence):
            raise ProtocolError(f"{name!r} advertises declared options that are not a list")
        if any(not isinstance(entry, Mapping) for entry in declared):
            raise ProtocolError(f"{name!r} advertises a declared option that is not an object")
        streams = data.get("streams")
        version = data.get("version")
        return cls(
            name=name.strip(),
            kind=kind,
            path=path.strip(),
            version=None if version is None else str(version),
            tier=None if tier is None else str(tier),
            options=dict(options),
            declared_options=tuple(dict(entry) for entry in declared),
            # Maia answers with a policy rather than a search, so it never streams.
            streams=(kind == EngineKind.UCI.value) if streams is None else bool(streams),
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "kind": self.kind,
            "path": self.path,
            "version": self.version,
            "tier": self.tier,
            "options": dict(self.options),
            "declared_options": [dict(entry) for entry in self.declared_options],
            "streams": self.streams,
        }

    def probe(self) -> EngineProbe:
        """What the runner's own probe said, in the shape the option validator wants."""
        return decode_probe(self.version, None, self.declared_options)


def decode_ads(data: Sequence[Mapping[str, Any]]) -> list[EngineAd]:
    """Every advertisement in a `hello` or an `advertise_engines`, or a named refusal."""
    if isinstance(data, str | bytes) or not isinstance(data, Sequence):
        raise ProtocolError("engines arrive as a list")
    return [EngineAd.from_dict(entry) for entry in data]


def accepted_engine(
    name: str, engine_id: int | None, accepted: bool, reason: str | None = None
) -> dict[str, Any]:
    """One entry of a `welcome` or `engines_accepted` engine list."""
    return {"name": name, "engine_id": engine_id, "accepted": bool(accepted), "reason": reason}


# --- reading fields --------------------------------------------------------


def _str(data: Mapping[str, Any], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str):
        raise ProtocolError(f"{key} is missing or is not a string")
    return value


def _optional_str(data: Mapping[str, Any], key: str) -> str | None:
    value = data.get(key)
    return None if value is None else str(value)


def _int(data: Mapping[str, Any], key: str) -> int:
    value = data.get(key)
    if isinstance(value, bool) or not isinstance(value, int | float | str):
        raise ProtocolError(f"{key} is missing or is not a number")
    return int(value)


def _optional_int(data: Mapping[str, Any], key: str) -> int | None:
    return None if data.get(key) is None else _int(data, key)


def _sequence(data: Mapping[str, Any], key: str) -> Sequence[Any]:
    value = data.get(key)
    if value is None:
        return ()
    if isinstance(value, str | bytes) or not isinstance(value, Sequence):
        raise ProtocolError(f"{key} is not a list")
    return value


def _as_int(value: Any) -> int | None:
    return None if value is None else int(value)

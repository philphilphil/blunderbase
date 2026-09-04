"""The runner registry: who may dial in, what they are called, and what they may run.

A `Runner` row is a machine the owner has granted engine work to. Three decisions shape
this module:

- **The token is the identity, the name is a label.** A runner authenticates with a bearer
  token minted here and shown exactly once; the yaml on that machine may call it whatever
  it likes. Renaming a runner in the UI therefore cannot brick it, and revoking one is
  deleting a row rather than editing a file on someone else's computer.
- **The token is stored hashed and compared in constant time.** SHA-256, not scrypt: the
  same reasoning as `AuthSession` in `services/auth.py` — 32 random bytes have nothing to
  brute-force, and the hash is what the lookup keys on, so the token itself never appears
  in a query.
- **Runner authentication has its own rate limiter, per presented token.** Deliberately not
  the owner's: a stranger hammering `/runner/ws` with guessed tokens must not be able to
  lock the owner out of their own browser. And deliberately not one counter for the whole
  door either — that stranger, or anyone sending no token at all, would then be shutting
  every registered runner out of a server it is entitled to, and one runner's good poll
  would forgive the backoff somebody else's guessing had earned. The state is module-level
  for the same reason the owner's is a column: there is one process, and a counter that
  resets on restart is exactly the behaviour a bearer-token limiter wants.

`connected` is a persisted flag, which means a process that died leaves it lying. A
starting one calls `disconnect_all` the way it calls `requeue_stale_runs`.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
import threading
from collections import OrderedDict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from backend.db.enums import RunStatus
from backend.db.models import AnalysisRun, Engine, Runner
from backend.db.types import utcnow
from backend.services import engines as engines_service
from backend.services import events as events_service

logger = logging.getLogger(__name__)

# `bb_rnr_` so a token found in a log or a compose file says what it opens. 32 random
# bytes behind it, url-safe because it travels in an `Authorization` header.
TOKEN_PREFIX = "bb_rnr_"
TOKEN_BYTES = 32

MAX_NAME_LENGTH = 64
LOCAL_NAME = "local"

# Ten wrong presentations of the same token and that token's door shuts for a second,
# doubling to a minute. Higher than the owner's threshold and shorter than its cap on
# purpose: a flapping runner with a stale token is a nuisance to be slowed down, not an
# intruder to be locked out.
LOCKOUT_THRESHOLD = 10
LOCKOUT_BASE = timedelta(seconds=1)
LOCKOUT_MAX = timedelta(seconds=60)
# How many tokens are remembered at once, oldest evicted. A bound rather than a policy:
# the counters are per token and a caller inventing a new one every time is not something
# a counter can slow down anyway, so the only thing to protect is this process's memory.
LOCKOUT_TRACKED = 512

EVENT_RUNNER_CONNECTED = "runner.connected"
EVENT_RUNNER_DISCONNECTED = "runner.disconnected"
EVENT_RUNNER_UPDATED = "runner.updated"

@dataclass(slots=True)
class _Attempt:
    """One presented token's run of failures, and how long its door is shut for."""

    failures: int = 0
    locked_until: datetime | None = None


_LIMITER_LOCK = threading.Lock()
_ATTEMPTS: OrderedDict[str, _Attempt] = OrderedDict()

# "Not given" for an update, so that `name=None` could mean something one day and does not
# have to mean "leave it alone" today.
_KEEP: Any = object()


class RunnerError(RuntimeError):
    """Anything the runner surface reports instead of a stack trace."""


class RunnerValidationError(RunnerError, ValueError):
    """The request itself is wrong: no name, a name already taken, a slot count below one."""


class DuplicateRunnerError(RunnerValidationError):
    """A runner of that name is already registered."""


class UnknownRunnerError(RunnerError, LookupError):
    """No runner with that id."""


class RunnerAuthError(RunnerError):
    """A bearer token that is not a registered runner's."""


class RunnerLockedOutError(RunnerAuthError):
    """Too many failed tokens; the backoff is still in force."""

    def __init__(self, retry_after: int) -> None:
        self.retry_after = retry_after
        super().__init__(f"too many failed runner tokens; try again in {retry_after} seconds")


# --- the registry ----------------------------------------------------------


def list_runners(session: Session) -> list[Runner]:
    """Every registered runner, registration order."""
    return list(session.scalars(select(Runner).order_by(Runner.id)))


def get_runner(session: Session, runner_id: int) -> Runner | None:
    return session.get(Runner, runner_id)


def require_runner(session: Session, runner_id: int) -> Runner:
    runner = get_runner(session, runner_id)
    if runner is None:
        raise UnknownRunnerError(f"no runner with id {runner_id}")
    return runner


def runner_by_name(session: Session, name: str) -> Runner | None:
    return session.scalars(select(Runner).where(Runner.name == name.strip())).first()


def create_runner(session: Session, name: str, slots: int = 1) -> tuple[Runner, str]:
    """Register a runner and mint its token. The token is returned here and never again."""
    checked = _valid_name(session, name)
    token = mint_token()
    runner = Runner(
        name=checked,
        token_hash=token_hash(token),
        slots=_valid_slots(slots),
        connected=False,
    )
    session.add(runner)
    session.commit()
    return runner, token


def update_runner(
    session: Session, runner_id: int, *, name: str = _KEEP, slots: int = _KEEP
) -> Runner:
    """Rename a runner or change its slot cap. Only what is passed is changed.

    A cap lowered below what is in flight is honoured for new dispatches; work already
    running finishes, because taking a search away to enforce a number nobody is waiting on
    would spend an attempt for nothing.
    """
    runner = require_runner(session, runner_id)
    if name is not _KEEP:
        runner.name = _valid_name(session, name, exclude=runner.id)
    if slots is not _KEEP:
        runner.slots = _valid_slots(slots)
    session.commit()
    return runner


def delete_runner(session: Session, runner_id: int) -> bool:
    """Revoke a runner: its token, its engine rows and its place in the queue.

    Its engines go through `delete_engine` with `unqueue=False`, which nulls the
    `AnalysisRun.engine_id` of every run that named one — a remote engine row is an
    advertisement owned by the runner, not configuration the owner deleted on purpose, so a
    run still queued for it keeps its place rather than being dropped with the row.
    """
    runner = get_runner(session, runner_id)
    if runner is None:
        return False
    for engine in engines_service.engines_of_runner(session, runner_id):
        engines_service.delete_engine(session, engine.id, unqueue=False)
    session.delete(runner)
    session.commit()
    return True


def mint_token() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(TOKEN_BYTES)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# --- authentication --------------------------------------------------------


def authenticate(session: Session, token: str | None) -> Runner:
    """The runner this bearer token is, or a typed reason it is nobody.

    The limiter is keyed on the token that was presented, so what a stranger's guesses shut
    is that guess's door and never a registered runner's.
    """
    digest = token_hash(token or "")
    locked = _locked_for(digest, utcnow())
    if locked:
        raise RunnerLockedOutError(locked)
    runner = (
        None
        if not token
        else session.scalars(select(Runner).where(Runner.token_hash == digest)).first()
    )
    # The digest is what is stored, so the comparison never touches the token itself; the
    # constant-time one is what keeps a near-miss from being measurably nearer.
    if runner is None or not hmac.compare_digest(runner.token_hash, digest):
        note_failure(digest)
        raise RunnerAuthError("that is not a registered runner token")
    note_success(digest)
    return runner


def note_failure(digest: str) -> None:
    """Count one refusal of this token, and shut its door once there have been enough."""
    with _LIMITER_LOCK:
        attempt = _ATTEMPTS.get(digest)
        if attempt is None:
            attempt = _ATTEMPTS.setdefault(digest, _Attempt())
            while len(_ATTEMPTS) > LOCKOUT_TRACKED:
                _ATTEMPTS.popitem(last=False)
        _ATTEMPTS.move_to_end(digest, last=True)
        attempt.failures += 1
        if attempt.failures >= LOCKOUT_THRESHOLD:
            attempt.locked_until = utcnow() + _backoff(attempt.failures)


def note_success(digest: str) -> None:
    """This token is somebody's after all: forget its failures, and nobody else's."""
    with _LIMITER_LOCK:
        _ATTEMPTS.pop(digest, None)


def reset_limiter() -> None:
    """Forget every failure. A shutting-down process and the tests call this."""
    with _LIMITER_LOCK:
        _ATTEMPTS.clear()


def _locked_for(digest: str, now: datetime) -> int:
    with _LIMITER_LOCK:
        attempt = _ATTEMPTS.get(digest)
        until = None if attempt is None else attempt.locked_until
    if until is None or until <= now:
        return 0
    return max(1, int((until - now).total_seconds() + 0.999))


def _backoff(failures: int) -> timedelta:
    steps = min(failures - LOCKOUT_THRESHOLD, 20)
    return min(LOCKOUT_BASE * (2**steps), LOCKOUT_MAX)


# --- connection state ------------------------------------------------------


def mark_connected(
    session: Session,
    runner: Runner,
    *,
    transport: str = "websocket",
    version: str | None = None,
    slots: int | None = None,
    browser: bool = False,
) -> Runner:
    """Record that a runner is here, and announce it.

    The reported slot count is not written onto the row: `slots` is the owner's cap, and a
    yaml that asks for more does not get it. It is taken to *lower* the number for this
    connection, though — see `effective_slots` — because a runner that says it has two
    slots must not be handed four jobs.

    `browser` *is* written, every time: what kind of host is dialling in is a fact about
    this connection rather than a setting the owner made, and the same token could open a
    tab today and start a script tomorrow. `analysis.requeue_stale_runs` is what reads it.
    """
    runner.connected = True
    runner.browser = bool(browser)
    runner.version = None if version is None else str(version)[:32]
    runner.last_seen_at = utcnow()
    session.commit()
    if slots is not None and int(slots) != runner.slots:
        logger.info(
            "runner %r reports %s slots; this deployment allows %s",
            runner.name,
            int(slots),
            runner.slots,
        )
    names = [engine.name for engine in engines_service.engines_of_runner(session, runner.id)]
    events_service.emit(
        {
            "event": EVENT_RUNNER_CONNECTED,
            "runner_id": runner.id,
            "name": runner.name,
            "slots": effective_slots(runner, slots),
            "version": runner.version,
            "transport": transport,
            "engines": names,
            "at": utcnow().isoformat(),
        }
    )
    return runner


def mark_disconnected(session: Session, runner_id: int, *, reason: str = "socket_closed") -> None:
    """Record that a runner is gone. Its engines go with it, and its runs are not this
    module's business — the gateway hands those back through `analysis.abandon_run`."""
    runner = get_runner(session, runner_id)
    if runner is None:
        return
    runner.connected = False
    runner.last_seen_at = utcnow()
    session.commit()
    engines_service.disable_runner_engines(session, runner_id)
    events_service.emit(
        {
            "event": EVENT_RUNNER_DISCONNECTED,
            "runner_id": runner.id,
            "name": runner.name,
            "reason": reason,
            "at": utcnow().isoformat(),
        }
    )


def touch(session: Session, runner_id: int) -> None:
    """Say a runner is still there. One UPDATE, called on every beat."""
    session.execute(update(Runner).where(Runner.id == runner_id).values(last_seen_at=utcnow()))
    session.commit()


def disconnect_all(session: Session) -> int:
    """Clear the `connected` flag a dead process left set. How many rows it was lying about."""
    cleared = session.execute(
        update(Runner).where(Runner.connected.is_(True)).values(connected=False)
    ).rowcount
    session.commit()
    return int(cleared)


def effective_slots(runner: Runner, reported: int | None = None) -> int:
    """How many jobs this connection may hold: the lower of the cap and the claim."""
    if reported is None:
        return int(runner.slots)
    return max(0, min(int(runner.slots), int(reported)))


def announce(row: Mapping[str, Any]) -> None:
    """Say that a runner changed, from the payload `runner_rows` has already built.

    The gateway announces the changes that are its own — a slot taken, a slot freed. This is
    for the ones that are the owner's doing, a rename or a new cap, so that a second browser
    is not left showing a machine by a name nobody calls it any more.
    """
    events_service.emit(
        {
            "event": EVENT_RUNNER_UPDATED,
            "runner_id": int(row["id"]),
            "name": row["name"],
            "slots": int(row["slots"]),
            "connected": bool(row["connected"]),
            "busy": int(row.get("busy", 0)),
            "streams": int(row.get("streams", 0)),
            "free_slots": int(row.get("free_slots", 0)),
            "at": utcnow().isoformat(),
        }
    )




# --- reading ---------------------------------------------------------------


def runner_payload(
    runner: Runner,
    *,
    engines: list[Engine],
    live: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """One runner as the API and the CLI report it: the row, plus the gateway's live half.

    Everything the row cannot know — which transport the link is using, how many slots are
    in use — comes in through `live`. With no live picture the runner is simply not
    connected, which is the honest answer for a row nobody has dialled in for.
    """
    live = live or {}
    return {
        "id": runner.id,
        "name": runner.name,
        "slots": runner.slots,
        "version": runner.version,
        "connected": runner.connected,
        # What kind of host last dialled in. A browser tab is listed differently and is
        # forgiven differently, so the page has to be able to tell.
        "browser": runner.browser,
        "transport": live.get("transport"),
        "last_seen_at": None if runner.last_seen_at is None else runner.last_seen_at.isoformat(),
        "created_at": runner.created_at.isoformat(),
        "busy": int(live.get("busy", 0)),
        "streams": int(live.get("streams", 0)),
        "free_slots": int(live.get("free_slots", 0)),
        "queued_eligible": int(live.get("queued_eligible", 0)),
        "engines": [engine_payload(engine) for engine in engines],
    }


def engine_payload(engine: Engine) -> dict[str, Any]:
    """A runner-bound engine row, as the Engines page shows it: read-mostly, path and all."""
    return {
        "id": engine.id,
        "name": engine.name,
        "kind": engine.kind.value,
        "version": engine.version,
        "path": engine.path,
        # Not every engine is a file. A browser tab advertises `wasm:stockfish-18`, and
        # the page has to say "in this browser" rather than render that as a path.
        "path_scheme": engines_service.path_scheme(engine.path),
        "enabled": engine.enabled,
        # What the host said it will answer, and only then what the kind allows: a Maia
        # answers with a policy rather than a search, so it never drives a stream whatever
        # it claims. The stored flag is the runner's own word — a host that implements
        # queue work and no analysis boards says so in its advertisement, and inferring
        # `true` from the kind here is what let the picker offer a board nobody answers.
        "streams": engine.streams and engine.kind.value == "uci",
    }


def runner_rows(
    session: Session,
    *,
    live: Mapping[int, Mapping[str, Any]] | None = None,
    breakdown: Sequence[Mapping[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Every runner as `/runners` lists it: the row, its engines, and the gateway's half.

    `live` is `RunnerGateway.status()` keyed by runner id. A process that has no gateway to
    ask — the coach, or a CLI — passes nothing and gets the database's own answer, which is
    why `connected` is a column at all.
    """
    queued = {
        row["runner_id"]: row["queued"]
        for row in _breakdown(session, breakdown)
        if row["runner_id"] is not None
    }
    rows: list[dict[str, Any]] = []
    for runner in list_runners(session):
        merged = dict((live or {}).get(runner.id) or {})
        merged.setdefault("queued_eligible", queued.get(runner.id, 0))
        rows.append(
            runner_payload(
                runner,
                engines=engines_service.engines_of_runner(session, runner.id),
                live=merged,
            )
        )
    return rows


def local_row(
    session: Session,
    *,
    live: Mapping[str, Any] | None = None,
    breakdown: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """This host as one more destination, so the two are read side by side.

    `live` is what only the process serving the queue knows: whether its workers are
    running, how many slots they have and how many are in use. Everything else is a row.
    """
    live = dict(live or {})
    local = next(
        (row for row in _breakdown(session, breakdown) if row["runner_id"] is None),
        {"queued": 0, "running": 0},
    )
    return {
        "name": LOCAL_NAME,
        "slots": live.get("slots"),
        "busy": int(live.get("busy", 0)),
        "streams": int(live.get("streams", 0)),
        "workers": bool(live.get("workers", False)),
        "queued": int(local["queued"]),
        "running": int(local["running"]),
        # An engine with no `runner_id` is one whose binary is on this machine.
        "engines": [
            engine_payload(engine)
            for engine in engines_service.list_engines(session)
            if engine.runner_id is None
        ],
    }


def status_payload(
    session: Session,
    *,
    live: Mapping[int, Mapping[str, Any]] | None = None,
    local: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Where engine work can run right now, whole: this host, every runner, the backlog.

    One read behind `/runners/status`, the Engines page and the coach's `runners_status`,
    so the three cannot drift into three different accounts of the same deployment.
    """
    breakdown = queue_breakdown(session)
    return {
        "runners": runner_rows(session, live=live, breakdown=breakdown),
        "local": local_row(session, live=local, breakdown=breakdown),
        "queue": {
            "queued": sum(int(row["queued"]) for row in breakdown),
            "running": sum(int(row["running"]) for row in breakdown),
        },
    }


def queue_destinations(
    session: Session,
    *,
    live: Mapping[int, Mapping[str, Any]] | None = None,
    local: Mapping[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """`/analysis/queue`'s breakdown: the counts, and who is actually working them.

    The counts say where the backlog will be drained rather than where it was queued: a
    run on a local engine that has since been switched off is still local work, and one on
    a runner's engine is still that runner's, connected or not.
    """
    live = live or {}
    local = local or {}
    rows: list[dict[str, Any]] = []
    for row in queue_breakdown(session):
        merged = dict(row)
        if row["runner_id"] is None:
            merged["slots"] = local.get("slots")
            merged["streams"] = int(local.get("streams", 0))
        else:
            seen = live.get(int(row["runner_id"])) or {}
            merged["streams"] = int(seen.get("streams", 0))
        rows.append(merged)
    return rows


def _breakdown(
    session: Session, breakdown: Sequence[Mapping[str, Any]] | None
) -> Sequence[Mapping[str, Any]]:
    """The caller's breakdown if it already read one, so a status answer is one query."""
    return queue_breakdown(session) if breakdown is None else breakdown


def queue_breakdown(session: Session) -> list[dict[str, Any]]:
    """Where the outstanding work will actually be done: local first, then each runner.

    A run with no engine, or one on a **local** engine that has been switched off, counts
    as local — that is where `_prepare`'s fallback will send it. A run on a runner's engine
    stays that runner's even while the runner is away: the local worker claims with every
    remote engine excluded, disabled ones included, so nothing here will ever drain it.
    Counting it as local would show a backlog against a host that cannot touch it.

    The counts are the whole of what the database knows; slots in use and the transport are
    the gateway's to merge in.
    """
    rows = session.execute(
        select(AnalysisRun.status, Engine.runner_id, func.count())
        .select_from(AnalysisRun)
        .outerjoin(Engine, AnalysisRun.engine_id == Engine.id)
        .where(AnalysisRun.status.in_([RunStatus.QUEUED, RunStatus.RUNNING]))
        .group_by(AnalysisRun.status, Engine.runner_id)
    ).all()

    counts: dict[int | None, dict[str, int]] = {}
    for status, runner_id, total in rows:
        bucket = counts.setdefault(runner_id, {"queued": 0, "running": 0})
        bucket["queued" if RunStatus(status) is RunStatus.QUEUED else "running"] += int(total)

    local = counts.get(None, {"queued": 0, "running": 0})
    breakdown: list[dict[str, Any]] = [
        {
            "destination": LOCAL_NAME,
            "runner_id": None,
            "name": LOCAL_NAME,
            "connected": True,
            # The local cap is `analysis_concurrency`, which is the caller's to fill in.
            "slots": None,
            "queued": local["queued"],
            "running": local["running"],
        }
    ]
    for runner in list_runners(session):
        bucket = counts.get(runner.id, {"queued": 0, "running": 0})
        breakdown.append(
            {
                "destination": "runner",
                "runner_id": runner.id,
                "name": runner.name,
                "connected": runner.connected,
                "slots": runner.slots,
                "queued": bucket["queued"],
                "running": bucket["running"],
            }
        )
    return breakdown


def config_yaml(runner: Runner, token: str, *, server_url: str) -> str:
    """The `runner.yaml` the create-runner flow hands over, with the token already in it.

    Paste-ready rather than exemplary: the one thing that cannot be looked up later is the
    token, so it is written here in the file that needs it. The engine entry is a
    placeholder — the paths are on the runner's own filesystem and nobody here knows them.
    """
    return "\n".join(
        [
            "# blunderbase runner — blunderbase-runner --config runner.yaml",
            "# The token below is shown once. Keep this file readable only by the runner.",
            f"server: {_scalar(server_url)}",
            f"token: {_scalar(token)}",
            f"name: {_scalar(runner.name)}",
            f"slots: {runner.slots}",
            "engines:",
            "  # One entry per engine on THIS machine. Edit the paths before starting.",
            "  - name: sf-remote",
            "    path: /usr/games/stockfish",
            "    options:",
            "      Threads: 8",
            "",
        ]
    )


def _scalar(value: str) -> str:
    """A string as a YAML scalar. JSON's quoting is valid YAML and escapes everything."""
    return json.dumps(str(value))


def _valid_name(session: Session, name: str, *, exclude: int | None = None) -> str:
    checked = (name or "").strip()
    if not checked:
        raise RunnerValidationError("a runner needs a name")
    if len(checked) > MAX_NAME_LENGTH:
        raise RunnerValidationError(f"a runner name is at most {MAX_NAME_LENGTH} characters")
    if checked == LOCAL_NAME:
        raise RunnerValidationError(f"{LOCAL_NAME!r} is what this host is called")
    statement = select(Runner.id).where(Runner.name == checked)
    if exclude is not None:
        statement = statement.where(Runner.id != exclude)
    if session.scalar(statement) is not None:
        raise DuplicateRunnerError(f"a runner named {checked!r} is already registered")
    return checked


def _valid_slots(slots: Any) -> int:
    try:
        value = int(slots)
    except (TypeError, ValueError) as exc:
        raise RunnerValidationError("a slot count is a whole number") from exc
    if value < 1:
        raise RunnerValidationError("a runner needs at least one slot")
    return value

"""Engine management: register a binary, keep its options honest, tell a role what it has.

Engines are rows, not configuration, so this module is what the Engines screen
and the MCP coach both talk to. Three rules shape it:

- A bad binary is rejected when it is added, not when an analysis run reaches for it. Every
  write path probes the process and validates the stored options against what the engine
  itself declared.
- An engine advertises what kind of thing it is and never claims a job. The owner assigns
  one engine to each of Quick, Deep and Human moves (`EngineRole`), stored as three
  settings, and **nothing falls back**: if the engine chosen for a role cannot run, that
  role does not run and the caller is told which engine and why. The alternative — the
  old `default_tier` preference, which quietly handed a switched-off engine's work to
  whichever UCI engine happened to be first — meant the engine doing the work was
  routinely one the owner had never picked and the UI could not name.
- A missing or disabled engine degrades. `engine_for_role` returns None and `role_status`
  explains why in words a UI can show; only `require_engine_for_tier` raises, and it raises
  `TierUnavailableError` rather than whatever the process layer threw.

An engine row with a `runner_id` bends the first rule and keeps the rest. Its binary is
on another machine, so there is nothing here to probe and nothing to `stat`: the row is
written from the runner's own advertisement, its options are validated against the probe
the runner did, and "is it available" becomes "is that runner connected". Everything else
— the roles, the pool key — treats it exactly like a local engine, which is the point.

Some of those rows are not a binary on *any* filesystem: a browser tab running as a runner
advertises the WASM build it loads inside itself, and spells its path with a scheme —
`wasm:stockfish-18`. `is_binary_path` is the one place that distinction is drawn, and
every question of the form "can this host start it" goes through it.

Adapter modules are imported inside the functions that need them: importing this module
must not pull python-chess and an engine process into a server that only wanted to list
engines.
"""

from __future__ import annotations

import shutil
import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import TYPE_CHECKING, Any

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from backend.db.enums import EngineKind, EngineRole, RunStatus, Tier
from backend.db.models import AnalysisRun, Engine, Runner
from backend.services import app_settings as app_settings_service

if TYPE_CHECKING:  # pragma: no cover - typing only
    from collections.abc import Callable, Mapping, Sequence

    from backend.adapters.pool import EngineSpec
    from backend.adapters.stockfish import EngineProbe, UciOption
    from backend.runners.protocol import EngineAd

    ProbeFn = Callable[..., EngineProbe]

# Maia loads weights before it answers `uciok`; Stockfish answers immediately.
UCI_PROBE_TIMEOUT = 10.0
MAIA_PROBE_TIMEOUT = 300.0
# A test run is a button in the UI, so it is budgeted for a person waiting on it.
SAMPLE_NODES = 200_000
SAMPLE_MULTIPV = 3
STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

EDITABLE = frozenset({"name", "path", "kind", "options", "enabled"})

# The kind of engine each role can be served by, and nothing else. A search role asked of a
# Maia would answer a policy where an evaluation was wanted; a human-move role asked of
# Stockfish would answer the best move rather than the likely one.
ROLE_KINDS: dict[EngineRole, EngineKind] = {
    EngineRole.QUICK: EngineKind.UCI,
    EngineRole.DEEP: EngineKind.UCI,
    EngineRole.HUMAN: EngineKind.MAIA,
}

# How each role is named in a sentence the owner has to act on.
ROLE_LABELS: dict[EngineRole, str] = {
    EngineRole.QUICK: "the quick tier",
    EngineRole.DEEP: "the deep tier",
    EngineRole.HUMAN: "human moves",
}

# An engine path that names a scheme instead of a file. `wasm:stockfish-18` is a build a
# browser tab loads inside itself: there is no binary anywhere on any filesystem, and the
# string is an identifier only the runner that advertised it understands. The column stays
# `NOT NULL` and the row stays a row like any other — a remote engine's `path` was already
# opaque here (it is a path on somebody else's disk), and this is the same fact said out
# loud, so nothing on this host is tempted to `stat`, split or start it.
PATH_SCHEMES = ("wasm",)
SCHEME_SEPARATOR = ":"


class EngineServiceError(RuntimeError):
    """Anything the engine screen has to show the owner instead of a stack trace."""


class EngineProbeError(EngineServiceError):
    """The binary did not answer as a UCI engine, so it is rejected at setup time."""


class EngineValidationError(EngineServiceError, ValueError):
    """The edit itself is wrong: a missing field, a name already taken, a bad option."""


class EngineOptionError(EngineValidationError):
    """An option this engine does not declare, or a value it will not accept."""


class DuplicateEngineError(EngineValidationError):
    """An engine of that name is already registered."""


class UnknownEngineError(EngineServiceError, LookupError):
    """No engine with that id."""


class EngineRunError(EngineServiceError):
    """The engine started but could not produce the analysis that was asked for."""


class TierUnavailableError(EngineServiceError):
    """A tier has no usable engine. Callers degrade; nothing crashes."""

    def __init__(self, tier: Tier, reason: str) -> None:
        super().__init__(f"the {tier.value} tier is unavailable: {reason}")
        self.tier = tier
        self.reason = reason


@dataclass(frozen=True, slots=True)
class AcceptedEngine:
    """What became of one advertised engine, in the words the runner is told them in."""

    name: str
    engine_id: int | None = None
    accepted: bool = False
    reason: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "engine_id": self.engine_id,
            "accepted": self.accepted,
            "reason": self.reason,
        }


@dataclass(frozen=True, slots=True)
class TierStatus:
    """What a tier can do right now, and why it cannot do more."""

    tier: Tier
    engine_id: int | None = None
    engine_name: str | None = None
    available: bool = False
    reason: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "tier": self.tier.value,
            "engine_id": self.engine_id,
            "engine_name": self.engine_name,
            "available": self.available,
            "reason": self.reason,
        }


@dataclass(frozen=True, slots=True)
class RoleStatus:
    """What one role can do right now, and why it cannot do more.

    `configured` and `available` are two different questions and a UI draws them
    differently. `configured` is "the owner has chosen an engine for this"; `available` is
    "that engine can run this second". Unconfigured is not a fault — a deployment with no
    human-move model has one fewer column, not a broken role — while configured and
    unavailable is one, and it always names the engine that was chosen and what is wrong
    with it.
    """

    role: EngineRole
    engine_id: int | None = None
    engine_name: str | None = None
    available: bool = False
    configured: bool = False
    reason: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "role": self.role.value,
            "engine_id": self.engine_id,
            "engine_name": self.engine_name,
            "available": self.available,
            "configured": self.configured,
            "reason": self.reason,
        }


def list_engines(session: Session, enabled_only: bool = False) -> list[Engine]:
    """Every configured engine."""
    statement = select(Engine).order_by(Engine.id)
    if enabled_only:
        statement = statement.where(Engine.enabled.is_(True))
    return list(session.scalars(statement))


def get_engine(session: Session, engine_id: int) -> Engine | None:
    """One engine."""
    return session.get(Engine, engine_id)


def require_engine(session: Session, engine_id: int) -> Engine:
    engine = get_engine(session, engine_id)
    if engine is None:
        raise UnknownEngineError(f"no engine with id {engine_id}")
    return engine


def add_engine(
    session: Session,
    name: str,
    path: str,
    kind: EngineKind = EngineKind.UCI,
    options: Mapping[str, Any] | None = None,
    enabled: bool = True,
    *,
    probe: ProbeFn | None = None,
) -> Engine:
    """Register a binary after probing it. A bad binary is rejected here, not at analysis time.

    A role nobody has chosen an engine for yet is filled with this one where its kind fits
    — see `assign_default_roles`, which is what makes the first engine on a fresh install
    do some work without a visit to the roles form.
    """
    name = name.strip()
    path = path.strip()
    if not name:
        raise EngineValidationError("an engine needs a name")
    if not path:
        raise EngineValidationError("an engine needs a path")
    if session.scalar(select(Engine.id).where(Engine.name == name)) is not None:
        raise DuplicateEngineError(f"an engine named {name!r} is already registered")

    probed = probe_engine(path, kind, probe=probe)
    engine = Engine(
        name=name,
        kind=kind,
        path=path,
        version=_version(probed),
        options=validate_options(probed, options),
        enabled=enabled,
    )
    session.add(engine)
    session.commit()
    assign_default_roles(session, engine)
    return engine


def update_engine(
    session: Session, engine_id: int, *, probe: ProbeFn | None = None, **changes: Any
) -> Engine:
    """Change a stored engine's name, path, kind, options or enabled flag.

    A change that could invalidate the stored options — a new path, a new kind, new options
    — re-probes the binary and validates against what it declares now. Renaming or
    disabling does not: an engine whose binary has gone missing must still be editable.

    Which role it serves is not among the fields: that is the owner's assignment, not a
    property of the engine, and it is written by `set_role_engine`.

    A runner's engine is not editable at all. The row is an advertisement from another
    machine — its `path` is a path over there, written by that machine — and the re-probe
    this function does would start whatever *this* host happens to find at it. The same
    reasoning as `sample_eval`'s refusal, and the same answer: the yaml on the runner is
    where a remote engine is changed.
    """
    unknown = sorted(set(changes) - EDITABLE)
    if unknown:
        raise EngineValidationError(f"cannot change {', '.join(unknown)}")
    engine = require_engine(session, engine_id)
    if engine.runner_id is not None:
        raise EngineValidationError(
            f"{engine.name!r} is on {engine_host(session, engine)} and is edited there; "
            f"this row is that machine's advertisement, and it is rewritten every time it "
            f"connects"
        )

    name = changes.get("name", engine.name)
    if isinstance(name, str):
        name = name.strip()
    if not name:
        raise EngineValidationError("an engine needs a name")
    taken = session.scalar(select(Engine.id).where(Engine.name == name, Engine.id != engine.id))
    if taken is not None:
        raise DuplicateEngineError(f"an engine named {name!r} is already registered")

    path = str(changes.get("path", engine.path)).strip()
    if not path:
        raise EngineValidationError("an engine needs a path")
    kind = EngineKind(changes.get("kind", engine.kind))
    options = changes.get("options", None)

    if options is not None or path != engine.path or kind != engine.kind:
        probed = probe_engine(path, kind, probe=probe)
        engine.version = _version(probed)
        engine.options = validate_options(probed, engine.options if options is None else options)

    engine.name = name
    engine.path = path
    engine.kind = kind
    if "enabled" in changes:
        engine.enabled = bool(changes["enabled"])
    session.commit()
    return engine


def delete_engine(session: Session, engine_id: int, *, unqueue: bool = True) -> tuple[bool, int]:
    """Remove an engine. A run that already started or finished keeps its row, with its
    reference set to NULL.

    A queued run bound to it has nothing left to run on. By default (`unqueue=True`, what
    the owner gets from Settings) it is dropped rather than left behind. `delete_runner`
    passes `unqueue=False`: its engine rows are the runner's own advertisement, not
    configuration the owner deleted on purpose, and a run still queued for one is nobody's
    job yet — `_prepare` stands its tier's own engine in where this host has one, same as
    it would if the runner had merely gone offline.

    Any role the engine was assigned to becomes unassigned. A setting pointing at a row
    that is gone would be a role that cannot run and cannot name what it was waiting for.
    """
    engine = get_engine(session, engine_id)
    if engine is None:
        return False, 0
    clear_role_engine(session, engine_id)
    unqueued = 0
    if unqueue:
        unqueued = session.execute(
            delete(AnalysisRun).where(
                AnalysisRun.engine_id == engine_id, AnalysisRun.status == RunStatus.QUEUED
            )
        ).rowcount
    session.execute(
        update(AnalysisRun).where(AnalysisRun.engine_id == engine_id).values(engine_id=None)
    )
    session.delete(engine)
    session.commit()
    return True, unqueued


# --- where an engine lives -------------------------------------------------


def local_engine_ids(session: Session, *, enabled_only: bool = True) -> list[int]:
    """The engines whose binary is on this host."""
    return _engine_ids(session, Engine.runner_id.is_(None), enabled_only=enabled_only)


def remote_engine_ids(session: Session, *, enabled_only: bool = False) -> list[int]:
    """Every engine that belongs to a runner.

    Disabled ones count by default, because this is what the local worker set excludes
    itself from claiming: a run bound to a remote engine that has been switched off is
    still not work this host should pick up behind the runner's back.
    """
    return _engine_ids(session, Engine.runner_id.is_not(None), enabled_only=enabled_only)


def runner_engine_ids(session: Session, runner_id: int, *, enabled_only: bool = True) -> list[int]:
    """The engines one runner advertises — what its dispatcher may claim runs for."""
    return _engine_ids(session, Engine.runner_id == runner_id, enabled_only=enabled_only)


def browser_engine_ids(session: Session) -> set[int]:
    """Every engine advertised by a runner that is a browser tab.

    Disabled ones count: a tab that went away has had its engines switched off by
    `mark_disconnected`, and it is precisely the runs it left behind that this answers for.
    """
    return set(
        session.scalars(
            select(Engine.id)
            .join(Runner, Engine.runner_id == Runner.id)
            .where(Runner.browser.is_(True))
        )
    )


def engines_of_runner(session: Session, runner_id: int) -> list[Engine]:
    """One runner's engine rows, advertisement order."""
    return list(
        session.scalars(select(Engine).where(Engine.runner_id == runner_id).order_by(Engine.id))
    )


def maia_engine_for_host(session: Session, runner_id: int | None) -> Engine | None:
    """The human-move model on one host, if it has one. Its absence is not an error.

    A run's Stockfish and Maia passes execute in the same process, so the model has to be
    where the search is. A host without one runs the evaluation and notes the skipped pass
    rather than refusing the run — the alternative would refuse every remote run on a
    deployment whose only Maia is local.

    "The model" is the one the owner assigned to the human-move role and no other: a second
    Maia sitting on this host is a model nobody chose, and standing it in would give a run
    a human-move pass at a level the roles form does not show.
    """
    engine = engine_for_role(session, EngineRole.HUMAN)
    if engine is None or engine.runner_id != runner_id:
        return None
    return engine


def stranded_maia(session: Session, engine: Engine) -> Engine | None:
    """The Maia a run on this engine could never reach, when one exists on another host.

    V1's rule is that a run's evaluation and its human-move passes live on the same
    machine: the two engines run in one process, and there is no way to ship a board to
    Stockfish here and to Maia there. So a search engine on a host with no Maia, in a
    deployment whose only Maia is somewhere else, describes a run that cannot be computed
    as configured — and `request_analysis` refuses it by name rather than quietly producing
    a game with no human-move data in it.

    None means there is nothing mixed about it: the chosen model is on this engine's host,
    or no model is chosen at all and the pass simply does not happen.
    """
    if engine.kind is EngineKind.MAIA:
        return None
    human = engine_for_role(session, EngineRole.HUMAN)
    if human is None or human.runner_id == engine.runner_id:
        return None
    return human


def engine_host(session: Session, engine: Engine) -> str:
    """Where an engine's binary is, phrased for a message an owner has to act on."""
    if engine.runner_id is None:
        return "this host"
    runner = session.get(Runner, engine.runner_id)
    return f"runner {runner.name!r}" if runner is not None else "a runner that is gone"


def sync_runner_engines(
    session: Session, runner: Runner, ads: Sequence[EngineAd]
) -> list[AcceptedEngine]:
    """Write one runner's advertisement into the engine table, and say what was taken.

    An advertised engine is the runner's, not the owner's: the yaml on that machine is the
    truth, so a row that already belongs to this runner is overwritten from the ad rather
    than merged with what the UI last saw. A name that belongs to another host is refused
    by name — the alternative is two engines called `stockfish` and a dispatcher that
    cannot tell which machine a run meant.

    Engines this runner advertised before and no longer does are disabled rather than
    deleted: an `AnalysisRun` may still point at one, and its history is worth keeping.

    An engine the deployment had never seen before fills any role that is still unassigned
    and that its kind fits, which is what makes a first-time runner do work without a visit
    to the roles form. Only a new row does: a runner re-advertising the engines it has
    always had must not re-fill a role the owner deliberately emptied.
    """
    from backend.runners.protocol import decode_probe

    existing = {engine.name: engine for engine in engines_of_runner(session, runner.id)}
    results: list[AcceptedEngine] = []
    kept: set[str] = set()
    fresh: list[Engine] = []

    for ad in ads:
        taken = session.scalars(select(Engine).where(Engine.name == ad.name)).first()
        if taken is not None and taken.runner_id != runner.id:
            where = "this host" if taken.runner_id is None else "another runner"
            results.append(
                AcceptedEngine(
                    name=ad.name,
                    reason=f"an engine named {ad.name!r} is already registered on {where}",
                )
            )
            continue
        probed = decode_probe(ad.version, None, ad.declared_options)
        try:
            options = validate_options(probed, ad.options)
        except EngineValidationError as exc:
            results.append(AcceptedEngine(name=ad.name, reason=str(exc)))
            continue

        engine = taken or Engine(name=ad.name)
        engine.kind = EngineKind(ad.kind)
        engine.path = ad.path
        engine.version = (ad.version or "")[:64] or None
        engine.options = options
        # The runner's own word about `stream_open`, not what its kind implies: a host may
        # run queue work and answer no analysis board, and a board offered to one that
        # never answers is a board that hangs.
        engine.streams = ad.streams
        engine.enabled = True
        engine.runner_id = runner.id
        if taken is None:
            session.add(engine)
            fresh.append(engine)
        session.flush()
        kept.add(ad.name)
        results.append(AcceptedEngine(name=ad.name, engine_id=engine.id, accepted=True))

    for name, engine in existing.items():
        if name not in kept:
            engine.enabled = False
    session.commit()
    # After the commit, so the assignment can never name a row the advertisement did not
    # keep: `set_role_engine_id` commits on its own, and a role pointing at a half-written
    # engine is worse than a role nobody filled.
    for engine in fresh:
        assign_default_roles(session, engine)
    return results


def disable_runner_engines(session: Session, runner_id: int) -> int:
    """Mark a gone runner's engines unavailable. How many were still enabled."""
    disabled = session.execute(
        update(Engine)
        .where(Engine.runner_id == runner_id, Engine.enabled.is_(True))
        .values(enabled=False)
    ).rowcount
    session.commit()
    return int(disabled)


def _engine_ids(session: Session, *where: Any, enabled_only: bool) -> list[int]:
    statement = select(Engine.id).where(*where).order_by(Engine.id)
    if enabled_only:
        statement = statement.where(Engine.enabled.is_(True))
    return [int(engine_id) for engine_id in session.scalars(statement)]


def probe_engine(
    path: str, kind: EngineKind = EngineKind.UCI, *, probe: ProbeFn | None = None
) -> EngineProbe:
    """Start the binary, read its name, version and declared UCI options, and stop it.

    Returns the adapter's `EngineProbe`; `as_dict()` on it is what the API and the UI want.
    """
    from backend.adapters.stockfish import EngineError
    from backend.adapters.stockfish import probe_engine as probe_binary

    if not is_binary_path(path):
        raise EngineProbeError(
            f"{path} names an engine that lives inside a runner, not a binary on a "
            f"filesystem; there is nothing here to start and ask"
        )
    runner = probe or probe_binary
    timeout = MAIA_PROBE_TIMEOUT if kind is EngineKind.MAIA else UCI_PROBE_TIMEOUT
    try:
        return runner(path, timeout=timeout)
    except EngineError as exc:
        raise EngineProbeError(f"{path} is not a usable {kind.value} engine: {exc}") from exc
    except OSError as exc:
        raise EngineProbeError(f"{path} could not be started: {exc}") from exc


def validate_options(probed: EngineProbe, options: Mapping[str, Any] | None) -> dict[str, Any]:
    """Every option the engine declares, coerced to the type it declared it with."""
    from backend.adapters.stockfish import UciOptionError

    validated: dict[str, Any] = {}
    for name, value in (options or {}).items():
        declared = probed.option(str(name))
        if declared is None:
            raise EngineOptionError(
                f"{name!r} is not an option of this engine (it declares {_names(probed.options)})"
            )
        try:
            validated[declared.name] = declared.parse(value)
        except UciOptionError as exc:
            raise EngineOptionError(str(exc)) from exc
    return validated


# --- the three roles -------------------------------------------------------


def engine_for_role(session: Session, role: EngineRole) -> Engine | None:
    """The engine assigned to this role, if it can serve it. Never anything else.

    None where the owner has assigned nothing, where what they assigned has been deleted or
    switched off, or where it is the wrong kind of engine for the job. There is deliberately
    no substitute: a role served by an engine nobody chose is work the owner cannot account
    for, and `role_status` is where the reason is put into words.
    """
    role = EngineRole(role)
    engine_id = app_settings_service.get_role_engine_id(session, role)
    if engine_id is None:
        return None
    engine = session.get(Engine, engine_id)
    if engine is None or not engine.enabled or engine.kind is not ROLE_KINDS[role]:
        return None
    return engine


def role_status(session: Session, role: EngineRole) -> RoleStatus:
    """Whether a role can run, phrased for the warning a UI shows when it cannot.

    Every way it fails gets its own sentence, because they call for different actions:
    choosing an engine, switching one back on, starting a runner, or putting a binary back
    where it was.
    """
    role = EngineRole(role)
    label = ROLE_LABELS[role]
    engine_id = app_settings_service.get_role_engine_id(session, role)
    if engine_id is None:
        # Not a fault, and not to be shown as one on a deployment that has nothing to
        # assign yet: `configured=False` is how a UI tells "you have not chosen one" from
        # "the one you chose is down".
        return RoleStatus(role=role, reason=f"no engine is assigned to {label}")

    engine = session.get(Engine, engine_id)
    if engine is None:
        return RoleStatus(
            role=role,
            engine_id=engine_id,
            configured=True,
            reason=f"the engine assigned to {label} is no longer registered",
        )
    status = RoleStatus(role=role, engine_id=engine.id, engine_name=engine.name, configured=True)
    if engine.kind is not ROLE_KINDS[role]:
        return replace(status, reason=_kind_mismatch(engine, role))
    if not engine.enabled:
        return replace(status, reason=f"{engine.name!r} is assigned to {label} and is switched off")
    if engine.runner_id is not None:
        # `binary_present` is meaningless for a path on another machine, so availability
        # is the one thing this host can actually know: whether that runner is dialled in.
        runner = session.get(Runner, engine.runner_id)
        if runner is None or not runner.connected:
            where = "its runner" if runner is None else repr(runner.name)
            return replace(
                status, reason=f"{engine.name!r} runs on {where}, which is not connected"
            )
        return replace(status, available=True)
    if not binary_present(engine.path):
        what = "the model" if engine.kind is EngineKind.MAIA else "the binary"
        return replace(status, reason=f"{what} for {engine.name!r} is no longer at {engine.path}")
    return replace(status, available=True)


def set_role_engine(session: Session, role: EngineRole, engine_id: int | None) -> Engine | None:
    """Assign an engine to a role, or unassign it with None. The engine, afterwards.

    Refused rather than clamped: an id that names nothing, or an engine of a kind the role
    cannot use, is a form that would leave the deployment quietly not running that role.
    """
    role = EngineRole(role)
    engine = _checked_role_engine(session, role, engine_id)
    app_settings_service.set_role_engine_id(session, role, None if engine is None else engine.id)
    return engine


def set_role_engines(
    session: Session, assignments: Mapping[EngineRole, int | None]
) -> list[RoleStatus]:
    """Assign several roles at once, all of them or none. Every role's status afterwards.

    The whole set is checked before any of it is written: a form that saves three dropdowns
    and refuses the third must not leave the first two applied, or the deployment ends up
    wired differently from the page that wired it.
    """
    checked = {
        EngineRole(role): _checked_role_engine(session, EngineRole(role), engine_id)
        for role, engine_id in assignments.items()
    }
    for role, engine in checked.items():
        engine_id = None if engine is None else engine.id
        app_settings_service.set_role_engine_id(session, role, engine_id)
    return [role_status(session, role) for role in EngineRole]


def assign_default_roles(session: Session, engine: Engine) -> list[EngineRole]:
    """Fill every still-unassigned role this engine's kind fits. Which ones were filled.

    A fresh install and a first-time runner have to do useful work before anybody opens the
    roles form, and with nothing falling back that can only be a real write: the first UCI
    engine takes Quick and Deep, the first Maia takes Human moves, and the choice then shows
    up in the dropdown as the owner's own rather than hiding in a resolution rule.

    It never overwrites an assignment, so a second engine steals nothing.
    """
    filled: list[EngineRole] = []
    for role, kind in ROLE_KINDS.items():
        if engine.kind is not kind:
            continue
        if app_settings_service.get_role_engine_id(session, role) is not None:
            continue
        app_settings_service.set_role_engine_id(session, role, engine.id)
        filled.append(role)
    return filled


def clear_role_engine(session: Session, engine_id: int) -> list[EngineRole]:
    """Unassign this engine from every role it holds. Which ones it held."""
    cleared: list[EngineRole] = []
    for role in EngineRole:
        if app_settings_service.get_role_engine_id(session, role) != engine_id:
            continue
        app_settings_service.set_role_engine_id(session, role, None)
        cleared.append(role)
    return cleared


def role_for_tier(tier: Tier) -> EngineRole:
    """The role that serves a tier's runs. They share their spelling, and only that."""
    return EngineRole(Tier(tier).value)


def _checked_role_engine(
    session: Session, role: EngineRole, engine_id: int | None
) -> Engine | None:
    """The engine an assignment names, or a typed refusal. None is a real answer: unassign."""
    if engine_id is None:
        return None
    engine = get_engine(session, int(engine_id))
    if engine is None:
        raise EngineValidationError(
            f"no engine with id {engine_id} to assign to {ROLE_LABELS[role]}"
        )
    if engine.kind is not ROLE_KINDS[role]:
        raise EngineValidationError(_kind_mismatch(engine, role))
    return engine


def _kind_mismatch(engine: Engine, role: EngineRole) -> str:
    """Why this engine cannot do this job, said in terms of what the job needs."""
    if ROLE_KINDS[EngineRole(role)] is EngineKind.MAIA:
        return (
            f"{engine.name!r} is a UCI engine, which answers with its own best move; "
            f"{ROLE_LABELS[role]} needs a human-move model"
        )
    return (
        f"{engine.name!r} is a human-move model, which answers with a policy rather than "
        f"a search; {ROLE_LABELS[role]} needs a UCI engine"
    )


def engine_for_tier(session: Session, tier: Tier, *, local_only: bool = False) -> Engine | None:
    """The engine assigned to this tier's role, or None if it cannot serve it.

    `local_only` is what the local worker set asks with, and it narrows rather than
    substitutes: an assigned engine that lives on a runner is a binary this host cannot
    start, and answering with a different one would run the tier on an engine nobody chose.
    """
    engine = engine_for_role(session, role_for_tier(tier))
    if engine is None or (local_only and engine.runner_id is not None):
        return None
    return engine


def require_engine_for_tier(session: Session, tier: Tier, *, local_only: bool = False) -> Engine:
    """The tier's engine, or a typed reason it has none.

    `local_only` is what a caller that starts the binary itself asks with. A one-shot
    evaluation is computed in this process — tunnelling a single position to a runner is
    deliberately not part of the runner protocol — so a remote engine's `path` is a path on
    a machine this one cannot see, and starting it here would at best be a different
    binary. Such a caller is told plainly that the tier's own engine is somewhere else,
    rather than being handed a different engine that happens to be here.
    """
    status = tier_status(session, tier)
    if not status.available or status.engine_id is None:
        raise TierUnavailableError(tier, status.reason or "no engine is available")
    engine = require_engine(session, status.engine_id)
    if not local_only or engine.runner_id is None:
        return engine
    raise TierUnavailableError(
        tier,
        f"the engine assigned to the {tier.value} tier, {engine.name!r}, is on "
        f"{engine_host(session, engine)}, and this is worked out here",
    )


def tier_status(session: Session, tier: Tier) -> TierStatus:
    """Whether a tier can run, phrased for the warning a UI shows when it cannot.

    The tier-typed half of `role_status`, for a caller that only has a `Tier` in hand.
    """
    status = role_status(session, role_for_tier(tier))
    return TierStatus(
        tier=Tier(tier),
        engine_id=status.engine_id,
        engine_name=status.engine_name,
        available=status.available,
        reason=status.reason,
    )


def maia_status(session: Session) -> RoleStatus:
    """Which human-move model the deployment uses, and why it has none.

    The human-move role, under the name every caller of the Maia half already knows it by.
    A model assigned but sitting on a runner is available exactly when that runner is: it
    is doing real work — every run dispatched to that machine gets its human-move pass —
    and `stranded_maia` is what refuses the runs that could never reach it.
    """
    return role_status(session, EngineRole.HUMAN)


def path_scheme(path: str) -> str | None:
    """The scheme an engine path names, or None because it names a file.

    Only the schemes in `PATH_SCHEMES` count. A Windows path (`C:\\engines\\sf.exe`) and a
    command line with a colon in it are still paths, which is why this is a lookup against
    a known vocabulary rather than "does it contain a colon".
    """
    scheme, separator, rest = (path or "").strip().partition(SCHEME_SEPARATOR)
    if not separator or not rest.strip():
        return None
    scheme = scheme.strip().casefold()
    return scheme if scheme in PATH_SCHEMES else None


def is_binary_path(path: str) -> bool:
    """Whether this path is meant to name a real binary on some filesystem.

    The single answer to that question, asked wherever the server is about to treat a
    stored path as one — `binary_present`, `spec_for`, `probe_engine`, `sample_eval`, and
    `command_for` in the adapter itself. False means the engine lives inside the runner
    that advertised it, and this host has nothing to look for.
    """
    return path_scheme(path) is None


def binary_present(path: str) -> bool:
    """Whether a stored path still resolves to something runnable, without starting it."""
    from backend.adapters.stockfish import EngineStartError, command_for

    if not is_binary_path(path):
        # Not a filesystem path at all, so there is nothing present and nothing missing.
        # Answering "no" is the honest one: no run on this host can ever start it.
        return False
    try:
        command = command_for(path)
    except EngineStartError:
        return False
    candidate = Path(command[0]).expanduser()
    if candidate.is_file():
        return True
    return shutil.which(command[0]) is not None


def spec_for(engine: Engine) -> EngineSpec:
    """The pool key for an engine row. Editing its options makes it a different process.

    A pool key is a promise that this host can start the thing, so an engine that is not a
    binary is refused here rather than handed on as a key that would fail at `popen`. Every
    caller already asks where the engine lives first; this is the backstop for the one that
    forgets.
    """
    from backend.adapters.pool import EngineSpec

    if not is_binary_path(engine.path):
        raise EngineRunError(
            f"{engine.name!r} is not a binary on this host: {engine.path!r} names an "
            f"engine that only the runner advertising it can start"
        )
    return EngineSpec.build(
        engine.path,
        kind=engine.kind.value,
        options=engine.options or {},
        name=engine.name,
        engine_id=engine.id,
    )


def sample_eval(
    session: Session,
    engine_id: int,
    fen: str | None = None,
    *,
    nodes: int = SAMPLE_NODES,
    multipv: int = SAMPLE_MULTIPV,
    ratings: Sequence[int] | None = None,
) -> dict[str, Any]:
    """Run the engine on one position and hand back what it said — the test-run button.

    Works on a disabled engine too: the point of the button is to decide whether to enable
    it. A UCI engine answers with an evaluation, a Maia engine with its move policy.

    It does not work on a runner's engine, and says so rather than starting whatever this
    host happens to have at that path: the row is an advertisement from another machine,
    and the only thing that can start it is the runner itself. An engine that is not a
    binary at all — a browser tab's `wasm:…` build — is refused first and by its own name,
    because for that one there is nothing to start on either machine.
    """
    import chess

    from backend.adapters.stockfish import EngineError

    engine_row = require_engine(session, engine_id)
    if not is_binary_path(engine_row.path):
        # Said before the runner check, because for this row the runner one would be
        # slightly wrong: there is no binary on that machine either, only a build the
        # runner loads inside itself.
        raise EngineRunError(
            f"{engine_row.name!r} is not a binary anywhere: {engine_row.path!r} names an "
            f"engine inside {engine_host(session, engine_row)}, and only that runner can "
            f"run a position through it"
        )
    if engine_row.runner_id is not None:
        raise EngineRunError(
            f"{engine_row.name!r} is on {engine_host(session, engine_row)}, and a test run "
            f"starts the binary here; {engine_row.path!r} is a path on that machine"
        )
    position = (fen or STARTING_FEN).strip()
    try:
        board = chess.Board(position)
    except ValueError as exc:
        raise EngineRunError(f"{position!r} is not a valid FEN: {exc}") from exc

    started = time.monotonic()
    try:
        payload = (
            _maia_sample(engine_row, board, ratings, multipv)
            if engine_row.kind is EngineKind.MAIA
            else _uci_sample(engine_row, board, nodes, multipv)
        )
    except EngineError as exc:
        raise EngineRunError(f"{engine_row.name} could not analyse the position: {exc}") from exc
    return {
        "engine_id": engine_row.id,
        "engine_name": engine_row.name,
        "kind": engine_row.kind.value,
        "fen": board.fen(),
        "elapsed_ms": int((time.monotonic() - started) * 1000),
        **payload,
    }


def _uci_sample(engine_row: Engine, board: Any, nodes: int, multipv: int) -> dict[str, Any]:
    import chess.engine

    from backend.adapters.stockfish import StockfishAdapter

    with StockfishAdapter(engine_row.path, options=engine_row.options or {}) as adapter:
        result = adapter.analyse(board, chess.engine.Limit(nodes=nodes), multipv=max(1, multipv))
    best = result.best
    return {
        "depth": result.depth,
        "nodes": result.nodes,
        "cp": result.score.stored_cp,
        "mate": result.score.mate_in,
        "best_move": None if best is None else {"uci": best.uci, "san": best.san},
        "lines": result.best_lines(),
    }


def _maia_sample(
    engine_row: Engine, board: Any, ratings: Sequence[int] | None, multipv: int
) -> dict[str, Any]:
    from backend.adapters.maia import MaiaAdapter

    with MaiaAdapter(engine_row.path, options=engine_row.options or {}) as adapter:
        if ratings:
            policy = adapter.policy_at(board, list(ratings), multipv=multipv)
        else:
            moves = adapter.policy(board, multipv=multipv)
            policy = {"any": moves}
    return {
        "policy": {level: [move.as_dict() for move in moves] for level, moves in policy.items()}
    }


def _version(probed: EngineProbe) -> str | None:
    name = (probed.name or "").strip()
    return name[:64] or None


def _names(options: Sequence[UciOption], limit: int = 12) -> str:
    names = [option.name for option in options]
    shown = ", ".join(names[:limit])
    return f"{shown}, …" if len(names) > limit else shown or "no options"

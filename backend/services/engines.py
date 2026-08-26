"""Engine management: register a binary, keep its options honest, tell a tier what it has.

Engines are rows, not configuration, so this module is what the Settings → Engines screen
and the MCP coach both talk to. Two rules shape it:

- A bad binary is rejected when it is added, not when an analysis run reaches for it. Every
  write path probes the process and validates the stored options against what the engine
  itself declared.
- A missing or disabled engine degrades. `engine_for_tier` returns None and `tier_status`
  explains why in words a UI can show; only `require_engine_for_tier` raises, and it raises
  `TierUnavailableError` rather than whatever the process layer threw.

An engine row with a `runner_id` bends the first rule and keeps the second. Its binary is
on another machine, so there is nothing here to probe and nothing to `stat`: the row is
written from the runner's own advertisement, its options are validated against the probe
the runner did, and "is it available" becomes "is that runner connected". Everything else
— tiers, Maia, the pool key — treats it exactly like a local engine, which is the point.

Adapter modules are imported inside the functions that need them: importing this module
must not pull python-chess and an engine process into a server that only wanted to list
engines.
"""

from __future__ import annotations

import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from backend.db.enums import EngineKind, Tier
from backend.db.models import AnalysisRun, Engine, Runner

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

EDITABLE = frozenset({"name", "path", "kind", "options", "enabled", "default_tier"})


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
    default_tier: Tier | None = None,
    enabled: bool = True,
    *,
    probe: ProbeFn | None = None,
) -> Engine:
    """Register a binary after probing it. A bad binary is rejected here, not at analysis time."""
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
        default_tier=default_tier,
    )
    session.add(engine)
    session.commit()
    return engine


def update_engine(
    session: Session, engine_id: int, *, probe: ProbeFn | None = None, **changes: Any
) -> Engine:
    """Change a stored engine's name, path, options, tier default or enabled flag.

    A change that could invalidate the stored options — a new path, a new kind, new options
    — re-probes the binary and validates against what it declares now. Renaming, disabling
    or re-tiering does not: an engine whose binary has gone missing must still be editable.

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
    if "default_tier" in changes:
        tier = changes["default_tier"]
        engine.default_tier = None if tier is None else Tier(tier)
    session.commit()
    return engine


def delete_engine(session: Session, engine_id: int) -> bool:
    """Remove an engine. Existing runs keep their reference as NULL."""
    engine = get_engine(session, engine_id)
    if engine is None:
        return False
    session.execute(
        update(AnalysisRun).where(AnalysisRun.engine_id == engine_id).values(engine_id=None)
    )
    session.delete(engine)
    session.commit()
    return True


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
    """
    return session.scalars(
        select(Engine)
        .where(
            Engine.enabled.is_(True),
            Engine.kind == EngineKind.MAIA,
            Engine.runner_id.is_(None) if runner_id is None else Engine.runner_id == runner_id,
        )
        .order_by(Engine.id)
    ).first()


def stranded_maia(session: Session, engine: Engine) -> Engine | None:
    """The Maia a run on this engine could never reach, when one exists on another host.

    V1's rule is that a run's evaluation and its human-move passes live on the same
    machine: the two engines run in one process, and there is no way to ship a board to
    Stockfish here and to Maia there. So a search engine on a host with no Maia, in a
    deployment whose only Maia is somewhere else, describes a run that cannot be computed
    as configured — and `request_analysis` refuses it by name rather than quietly producing
    a game with no human-move data in it.

    None means there is nothing mixed about it: this host has its own Maia, or the
    deployment has none at all and the pass simply does not happen.
    """
    if engine.kind is EngineKind.MAIA:
        return None
    if maia_engine_for_host(session, engine.runner_id) is not None:
        return None
    return session.scalars(
        select(Engine)
        .where(Engine.enabled.is_(True), Engine.kind == EngineKind.MAIA)
        .order_by(Engine.id)
    ).first()


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
    """
    from backend.runners.protocol import decode_probe

    existing = {engine.name: engine for engine in engines_of_runner(session, runner.id)}
    results: list[AcceptedEngine] = []
    kept: set[str] = set()

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
        engine.default_tier = None if ad.tier is None else Tier(ad.tier)
        engine.enabled = True
        engine.runner_id = runner.id
        if taken is None:
            session.add(engine)
        session.flush()
        kept.add(ad.name)
        results.append(AcceptedEngine(name=ad.name, engine_id=engine.id, accepted=True))

    for name, engine in existing.items():
        if name not in kept:
            engine.enabled = False
    session.commit()
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


def engine_for_tier(session: Session, tier: Tier, *, local_only: bool = False) -> Engine | None:
    """The engine a tier should use, or None if its engine is missing or disabled.

    `local_only` is what the local worker set asks with: a run whose engine has gone away
    falls back to something this host can actually start, not to a binary on a machine that
    may not even be connected.
    """
    enabled = list_engines(session, enabled_only=True)
    if local_only:
        enabled = [engine for engine in enabled if engine.runner_id is None]
    for engine in enabled:
        if engine.default_tier is tier:
            return engine
    # No engine claims the tier: fall back to a plain UCI engine, never to Maia, whose
    # output is a human-move guess rather than an evaluation.
    return next((engine for engine in enabled if engine.kind is EngineKind.UCI), None)


def require_engine_for_tier(session: Session, tier: Tier, *, local_only: bool = False) -> Engine:
    """The tier's engine, or a typed reason it has none.

    `local_only` is what a caller that starts the binary itself asks with. A one-shot
    evaluation is computed in this process — tunnelling a single position to a runner is
    deliberately not part of the runner protocol — so a remote engine's `path` is a path on
    a machine this one cannot see, and starting it here would at best be a different
    binary. Such a caller falls back to something this host can really run, and says so
    plainly when there is nothing.
    """
    status = tier_status(session, tier)
    if not status.available or status.engine_id is None:
        raise TierUnavailableError(tier, status.reason or "no engine is available")
    engine = require_engine(session, status.engine_id)
    if not local_only or engine.runner_id is None:
        return engine
    here = engine_for_tier(session, tier, local_only=True)
    if here is None:
        raise TierUnavailableError(
            tier,
            f"the {tier.value} tier's engine, {engine.name!r}, is on "
            f"{engine_host(session, engine)}, and this is worked out here; no engine on "
            f"this host is available for it",
        )
    return here


def tier_status(session: Session, tier: Tier) -> TierStatus:
    """Whether a tier can run, phrased for the warning a UI shows when it cannot."""
    engine = engine_for_tier(session, tier)
    if engine is None:
        registered = session.scalar(select(Engine.id).limit(1))
        reason = (
            "every registered engine is disabled or is a Maia model"
            if registered is not None
            else "no engine is registered yet"
        )
        return TierStatus(tier=tier, available=False, reason=reason)
    if engine.runner_id is not None:
        # `binary_present` is meaningless for a path on another machine, so availability
        # is the one thing this host can actually know: whether that runner is dialled in.
        runner = session.get(Runner, engine.runner_id)
        if runner is None or not runner.connected:
            where = "its runner" if runner is None else repr(runner.name)
            return TierStatus(
                tier=tier,
                engine_id=engine.id,
                engine_name=engine.name,
                available=False,
                reason=f"{engine.name!r} runs on {where}, which is not connected",
            )
        return TierStatus(tier=tier, engine_id=engine.id, engine_name=engine.name, available=True)
    if not binary_present(engine.path):
        return TierStatus(
            tier=tier,
            engine_id=engine.id,
            engine_name=engine.name,
            available=False,
            reason=f"the binary for {engine.name!r} is no longer at {engine.path}",
        )
    return TierStatus(tier=tier, engine_id=engine.id, engine_name=engine.name, available=True)


def binary_present(path: str) -> bool:
    """Whether a stored path still resolves to something runnable, without starting it."""
    from backend.adapters.stockfish import EngineStartError, command_for

    try:
        command = command_for(path)
    except EngineStartError:
        return False
    candidate = Path(command[0]).expanduser()
    if candidate.is_file():
        return True
    return shutil.which(command[0]) is not None


def spec_for(engine: Engine) -> EngineSpec:
    """The pool key for an engine row. Editing its options makes it a different process."""
    from backend.adapters.pool import EngineSpec

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
    and the only thing that can start it is the runner itself.
    """
    import chess

    from backend.adapters.stockfish import EngineError

    engine_row = require_engine(session, engine_id)
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

"""Engine management: register a binary, keep its options honest, tell a tier what it has.

Engines are rows, not configuration, so this module is what the Settings → Engines screen
and the MCP coach both talk to. Two rules shape it:

- A bad binary is rejected when it is added, not when an analysis run reaches for it. Every
  write path probes the process and validates the stored options against what the engine
  itself declared.
- A missing or disabled engine degrades. `engine_for_tier` returns None and `tier_status`
  explains why in words a UI can show; only `require_engine_for_tier` raises, and it raises
  `TierUnavailableError` rather than whatever the process layer threw.

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
from backend.db.models import AnalysisRun, Engine

if TYPE_CHECKING:  # pragma: no cover - typing only
    from collections.abc import Callable, Mapping, Sequence

    from backend.adapters.pool import EngineSpec
    from backend.adapters.stockfish import EngineProbe, UciOption

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
    """
    unknown = sorted(set(changes) - EDITABLE)
    if unknown:
        raise EngineValidationError(f"cannot change {', '.join(unknown)}")
    engine = require_engine(session, engine_id)

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


def engine_for_tier(session: Session, tier: Tier) -> Engine | None:
    """The engine a tier should use, or None if its engine is missing or disabled."""
    enabled = list_engines(session, enabled_only=True)
    for engine in enabled:
        if engine.default_tier is tier:
            return engine
    # No engine claims the tier: fall back to a plain UCI engine, never to Maia, whose
    # output is a human-move guess rather than an evaluation.
    return next((engine for engine in enabled if engine.kind is EngineKind.UCI), None)


def require_engine_for_tier(session: Session, tier: Tier) -> Engine:
    """The tier's engine, or a typed reason it has none."""
    status = tier_status(session, tier)
    if not status.available or status.engine_id is None:
        raise TierUnavailableError(tier, status.reason or "no engine is available")
    return require_engine(session, status.engine_id)


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
    """
    import chess

    from backend.adapters.stockfish import EngineError

    engine_row = require_engine(session, engine_id)
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

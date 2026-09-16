"""Practice: the computer's side of a game played out from a position.

The reader picks a position on the game board, a colour and an opponent, and plays on. The
board and its moves are the browser's — nothing here writes a row, the same promise
`live.py` and `streams.py` make — so what the server contributes is one answer, over and
over: *what does this engine play here*.

Three decisions shape it:

- **A move, not a search.** The analysis board already streams an engine's lines, and the
  obvious build would take its top line as the reply. That is wrong for the one thing
  practice most needs, a weaker opponent: Stockfish's `UCI_LimitStrength` does not weaken
  its search, it weakens the move it *picks* at the end — the `info` lines stay full
  strength and only `bestmove` changes. So a reply is a bounded search that answers with
  the move played, and a stream is the wrong tool.
- **Strength is the engine's own word.** `UCI_LimitStrength` plus `UCI_Elo`, between the
  bounds the binary declared at its last probe (`Engine.declared_options`). An engine that
  declares neither plays at full strength and the picker offers no slider; nothing here
  emulates a rating an engine does not claim to play at.
- **Two hosts, one interface.** Like the analysis board, a reply is served by whichever
  host the engine lives on — `workers/practice_moves.py` has a pool-backed backend for a
  binary here and a gateway-backed one for a runner — and the rules are in this module,
  so a runner's refusal reads the same as a local one.

Maia is not here. Its human-move policy is already a live query (`maia_live.py`), and the
reply the reader faces is a *sample* from that policy — which the board draws from the
answer it already fetches, so the server never has to know the game is being played.
"""

from __future__ import annotations

import asyncio
import secrets
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

from sqlalchemy.orm import Session, sessionmaker

from backend.config import Settings, get_settings
from backend.db.enums import EngineKind, EngineRole
from backend.db.session import get_sessionmaker
from backend.services import engines as engines_service

if TYPE_CHECKING:  # pragma: no cover - typing only
    import chess

    from backend.adapters.pool import EngineSpec
    from backend.db.models import Engine

LOCAL = "local"
REMOTE = "runner"

# How long the engine thinks. A second is what a rating-limited Stockfish is calibrated
# around; ten is the most a person should sit waiting for a practice reply.
DEFAULT_MOVETIME_MS = 1000
MIN_MOVETIME_MS = 100
MAX_MOVETIME_MS = 10_000

LIMIT_STRENGTH = "UCI_LimitStrength"
ELO = "UCI_Elo"

REQUEST_PREFIX = "mv_"
REQUEST_BYTES = 8


class PracticeError(RuntimeError):
    """Anything practice reports instead of a stack trace."""


class PracticeRequestError(PracticeError, ValueError):
    """The request itself is wrong: not a position, a finished game, a Maia asked to search."""


class PracticeUnavailableError(PracticeError):
    """The engine cannot answer right now, and the sentence says why."""


@dataclass(frozen=True, slots=True)
class Strength:
    """The ratings an engine says it can be held to, as its own options spell them."""

    min: int
    max: int
    default: int
    limit_option: str = LIMIT_STRENGTH
    elo_option: str = ELO

    def clamp(self, elo: int) -> int:
        return max(self.min, min(self.max, int(elo)))

    def options(self, elo: int) -> dict[str, Any]:
        return {self.limit_option: True, self.elo_option: self.clamp(elo)}

    def as_dict(self) -> dict[str, int]:
        return {"min": self.min, "max": self.max, "default": self.default}


def strength_of(declared: Sequence[Mapping[str, Any]] | None) -> Strength | None:
    """Whether a declared option list can play at a rating, and between which.

    Both options have to be there and `UCI_Elo` has to be a spin with bounds: a check with
    nothing to set a rating by, or a rating with no switch to turn it on, is a slider that
    would do nothing.
    """
    by_name = {
        str(entry.get("name", "")).casefold(): entry
        for entry in declared or ()
        if isinstance(entry, Mapping)
    }
    limit = by_name.get(LIMIT_STRENGTH.casefold())
    elo = by_name.get(ELO.casefold())
    if limit is None or elo is None:
        return None
    if str(limit.get("type")) != "check" or str(elo.get("type")) != "spin":
        return None
    try:
        low, high = int(elo["min"]), int(elo["max"])
    except (KeyError, TypeError, ValueError):
        return None
    if low > high:
        return None
    try:
        default = int(elo.get("default"))
    except (TypeError, ValueError):
        default = low
    return Strength(
        min=low,
        max=high,
        default=max(low, min(high, default)),
        limit_option=str(limit["name"]),
        elo_option=str(elo["name"]),
    )


@dataclass(frozen=True, slots=True)
class Destination:
    """Which engine, on which host, set up how — read off the database once per reply."""

    engine_id: int
    engine: str
    destination: str = LOCAL
    runner_id: int | None = None
    runner: str | None = None
    options: Mapping[str, Any] | None = None
    elo: int | None = None
    spec: EngineSpec | None = None


class MoveBackend(Protocol):
    """What a host has to do to answer a practice reply. Two implement it."""

    name: str

    def refusal(self, runner_id: int | None) -> str | None:
        """Why this host cannot answer at all right now, or None. Asked by the picker."""

    async def play(self, target: Destination, fen: str, movetime_ms: int) -> str | None:
        """The move the engine plays, in UCI, or None when it has none to play.

        Raises `PracticeUnavailableError` with a sentence when the host cannot answer.
        """


class PracticeBroker:
    """The one place a practice reply is asked for, whichever host has the engine."""

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        sessions: sessionmaker[Session] | None = None,
        backends: Mapping[str, MoveBackend] | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self._sessions = sessions
        self._backends: dict[str, MoveBackend] = dict(backends or {})

    @property
    def sessions(self) -> sessionmaker[Session]:
        if self._sessions is None:
            self._sessions = get_sessionmaker(self.settings)
        return self._sessions

    def register_backend(self, name: str, backend: MoveBackend) -> None:
        self._backends[name] = backend

    # --- what the picker offers ---------------------------------------------

    def opponents(self, session: Session) -> dict[str, Any]:
        """Every engine a reader could practise against, and whether it can answer now.

        A UCI engine that is switched on is listed whether or not it can answer this
        second, with the reason when it cannot: the picker greys it with the sentence
        rather than hiding an engine the owner knows they have. Maia is one entry of its
        own, because it answers through the live policy query and has levels, not a
        rating to be held to.
        """
        analysis = engines_service.engine_for_role(session, EngineRole.ANALYSIS)
        engines: list[dict[str, Any]] = []
        for engine in engines_service.list_engines(session, enabled_only=True):
            if engine.kind is not EngineKind.UCI:
                continue
            strength = strength_of(engines_service.declared_options(session, engine))
            reason = self._refusal(session, engine)
            engines.append(
                {
                    "engine_id": engine.id,
                    "name": engine.name,
                    "runner_id": engine.runner_id,
                    "available": reason is None,
                    "reason": reason,
                    "strength": None if strength is None else strength.as_dict(),
                }
            )
        return {
            "engines": engines,
            "default_engine_id": None if analysis is None else analysis.id,
            "maia": self._maia(session),
            "movetime_ms": {
                "default": DEFAULT_MOVETIME_MS,
                "min": MIN_MOVETIME_MS,
                "max": MAX_MOVETIME_MS,
            },
        }

    def _refusal(self, session: Session, engine: Engine) -> str | None:
        if engine.runner_id is None:
            if self.settings.demo:
                return "the demo does not run engines on the server"
            if not engines_service.binary_present(engine.path):
                return f"{engine.name!r} is not at {engine.path} any more"
            backend = self._backends.get(LOCAL)
        else:
            backend = self._backends.get(REMOTE)
            if backend is None:
                where = engines_service.engine_host(session, engine)
                return f"{engine.name!r} is on {where}, which this process does not reach"
        if backend is None:
            return "this process does not serve practice"
        return backend.refusal(engine.runner_id)

    def _maia(self, session: Session) -> dict[str, Any]:
        """Whether the live policy query can answer, in `maia_live`'s own words."""
        if self.settings.demo:
            return {"available": False, "reason": "the demo does not run engines on the server"}
        if engines_service.maia_engine_for_host(session, None) is not None:
            return {"available": True, "reason": None}
        chosen = engines_service.engine_for_role(session, EngineRole.HUMAN)
        if chosen is not None:
            return {
                "available": False,
                "reason": (
                    f"the model chosen for human moves, {chosen.name!r}, is on "
                    f"{engines_service.engine_host(session, chosen)}, and a live query is "
                    f"answered here"
                ),
            }
        return {"available": False, "reason": "no human-move model is chosen"}

    # --- a reply ------------------------------------------------------------

    async def move(
        self,
        *,
        fen: str,
        engine_id: int | None = None,
        elo: int | None = None,
        movetime_ms: int = DEFAULT_MOVETIME_MS,
    ) -> dict[str, Any]:
        """The engine's reply in this position, at a rating if it was given one."""
        board = _board(fen)
        if board.is_game_over():
            raise PracticeRequestError("the game is over in this position; there is no move")
        movetime = _movetime(movetime_ms)
        target = await asyncio.to_thread(self._resolve, engine_id, elo)
        backend = self._backends.get(target.destination)
        if backend is None:
            raise PracticeUnavailableError("this process does not serve practice")
        uci = await backend.play(target, board.fen(), movetime)
        if uci is None:
            raise PracticeUnavailableError(f"{target.engine!r} had no move to play")
        try:
            move = board.parse_uci(uci)
        except ValueError:
            move = None
        if move is None or move not in board.legal_moves:
            raise PracticeUnavailableError(
                f"{target.engine!r} answered {uci!r}, which is not a legal move here"
            )
        return {
            "uci": board.uci(move),
            "san": board.san(move),
            "engine_id": target.engine_id,
            "engine": target.engine,
            "runner_id": target.runner_id,
            "elo": target.elo,
            "movetime_ms": movetime,
        }

    def _resolve(self, engine_id: int | None, elo: int | None) -> Destination:
        with self.sessions() as session:
            if engine_id is None:
                engine = engines_service.engine_for_role(session, EngineRole.ANALYSIS)
                if engine is None:
                    status = engines_service.role_status(session, EngineRole.ANALYSIS)
                    raise PracticeUnavailableError(
                        status.reason or "no engine is available to practise against"
                    )
            else:
                try:
                    engine = engines_service.require_engine(session, engine_id)
                except engines_service.UnknownEngineError as exc:
                    raise PracticeRequestError(str(exc)) from None
            if engine.kind is not EngineKind.UCI:
                raise PracticeRequestError(
                    f"{engine.name!r} is a human-move model; practise against it through its "
                    f"policy, not a search"
                )
            if not engine.enabled:
                raise PracticeUnavailableError(f"{engine.name!r} is switched off")
            reason = self._refusal(session, engine)
            if reason is not None:
                raise PracticeUnavailableError(reason)

            options: dict[str, Any] = {}
            played_at: int | None = None
            if elo is not None:
                strength = strength_of(engines_service.declared_options(session, engine))
                if strength is None:
                    raise PracticeRequestError(
                        f"{engine.name!r} does not declare UCI_LimitStrength and UCI_Elo, so "
                        f"it cannot be held to a rating"
                    )
                options = strength.options(elo)
                played_at = strength.clamp(elo)

            if engine.runner_id is None:
                return Destination(
                    engine_id=engine.id,
                    engine=engine.name,
                    destination=LOCAL,
                    options=options,
                    elo=played_at,
                    spec=engines_service.spec_for(engine, options),
                )
            runner = engines_service.engine_host(session, engine)
            return Destination(
                engine_id=engine.id,
                engine=engine.name,
                destination=REMOTE,
                runner_id=engine.runner_id,
                runner=runner,
                options=options,
                elo=played_at,
            )


# --- reading a request ---------------------------------------------------------


def _board(fen: str) -> chess.Board:
    """The position as a standard board where it is one, so castling reads `e1g1`.

    `read_fen` reads everything as chess960 so that every castling spelling parses; a reply
    on such a board would castle as king-takes-rook, which the browser's board does not
    play. A position that genuinely needs chess960 stays one.
    """
    import chess

    from backend.services.explorer import read_fen

    text = (fen or "").strip()
    if not text:
        raise PracticeRequestError("practice needs a position")
    try:
        wide = read_fen(text)
    except ValueError as exc:
        raise PracticeRequestError(str(exc)) from None
    try:
        board = chess.Board(wide.fen())
    except ValueError:
        return wide
    return board if board.is_valid() else wide


def _movetime(value: int) -> int:
    number = int(value)
    if number < MIN_MOVETIME_MS or number > MAX_MOVETIME_MS:
        raise PracticeRequestError(
            f"the engine thinks for {MIN_MOVETIME_MS} to {MAX_MOVETIME_MS} ms, not {value}"
        )
    return number


def request_id() -> str:
    """A reply's name on the runner link, so its answer can find the request it answers."""
    return f"{REQUEST_PREFIX}{secrets.token_hex(REQUEST_BYTES)}"

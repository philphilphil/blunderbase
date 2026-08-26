"""Maia: what a human of a given rating would actually play here.

Ported from the predecessor's Maia-3 adapter and re-reviewed. Maia is an lc0 build, so it
speaks UCI and reuses `stockfish.py` for command handling, option probing and errors.

What changed on the way in:

- The predecessor recorded rank and the human-outcome head only, because Maia-3 does not
  expose a policy probability through MultiPV. `MoveEval.maia_policy` stores probabilities,
  so the adapter now also reads lc0's verbose move stats — the one place a real policy
  figure is published — and streams the analysis instead of taking the merged result, since
  `info string` lines do not survive python-chess's per-PV merge. Where the engine publishes
  no figure the probability stays `None`; the adapter still never invents one.
- Ratings: Maia-2/Maia-3 take `SelfElo`/`OppoElo`, while a classic `maia-1500.pb.gz` *is*
  its rating and declares neither. `supports_rating` tells the two apart, and asking a
  fixed-weights engine for a rating it cannot honour raises instead of quietly answering
  as some other rating.
- The engine command comes from the engine row rather than a `Settings` field.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import chess
import chess.engine

from backend.adapters.stockfish import (
    START_ERRORS,
    STDERR_TAIL,
    EngineError,
    StderrCapture,
    UciOption,
    open_engine,
    quit_engine,
)

# Maia loads its weights on start, which is slow enough to need its own patience.
MAIA_START_TIMEOUT = 300.0
DEFAULT_MULTIPV = 5
# One node: Maia's whole point is its raw policy, not a search on top of it.
POLICY_NODES = 1

SELF_ELO = "SelfElo"
OPPO_ELO = "OppoElo"
VERBOSE_MOVE_STATS = "VerboseMoveStats"

# lc0's verbose move stats, e.g.
# `e2e4  (322 ) N:      0 (+ 0) (P: 12.34%) (WL: 0.03) (D: 0.4) (Q: 0.03) (V: 0.04)`
POLICY_PATTERN = re.compile(
    r"^\s*(?P<uci>[a-h][1-8][a-h][1-8][qrbnQRBN]?)\b.*?\(P:\s*(?P<percent>-?[\d.]+)%\)"
)


class HumanModelUnavailableError(EngineError):
    """The human move model could not provide trustworthy output."""


@dataclass(frozen=True, slots=True)
class PolicyMove:
    """One policy entry: an ordering, the policy probability where the engine publishes
    one, and the human-game WDL head in permille where it has one."""

    rank: int
    uci: str
    san: str
    probability: float | None = None
    win_permille: int | None = None
    draw_permille: int | None = None
    loss_permille: int | None = None
    expected_score: float | None = None

    def as_dict(self) -> dict[str, Any]:
        """The shape `MoveEval.maia_policy` stores, with absent figures left out."""
        entry: dict[str, Any] = {"uci": self.uci, "san": self.san, "rank": self.rank}
        if self.probability is not None:
            entry["p"] = self.probability
        if self.expected_score is not None:
            entry["expected_score"] = self.expected_score
        if self.win_permille is not None:
            entry["wdl"] = [self.win_permille, self.draw_permille, self.loss_permille]
        return entry


def _wdl(value: Any, color: chess.Color) -> tuple[int | None, int | None, int | None, float | None]:
    if value is None:
        return None, None, None, None
    relative = value.pov(color) if hasattr(value, "pov") else value
    try:
        wins = int(relative.wins)
        draws = int(relative.draws)
        losses = int(relative.losses)
    except (AttributeError, TypeError, ValueError):
        try:
            wins, draws, losses = (int(part) for part in relative)
        except (TypeError, ValueError):
            return None, None, None, None
    total = wins + draws + losses
    expected = (wins + draws / 2) / total if total else 0.5
    return wins, draws, losses, round(expected, 4)


def policy_probability(info: Mapping[str, Any]) -> tuple[str, float] | None:
    """The move and policy share of one verbose-move-stats line, if it is one."""
    text = info.get("string")
    if not isinstance(text, str):
        return None
    match = POLICY_PATTERN.match(text)
    if match is None:
        return None
    try:
        percent = float(match.group("percent"))
    except ValueError:
        return None
    return match.group("uci").lower(), round(percent / 100.0, 6)


def _lookup(
    probabilities: Mapping[str, float], board: chess.Board, move: chess.Move
) -> float | None:
    """Castling is `e1g1` to one build and `e1h1` to another, so try both spellings."""
    for spelling in (board.uci(move), move.uci()):
        found = probabilities.get(spelling.lower())
        if found is not None:
            return found
    return None


class MaiaAdapter:
    """Elo-conditioned human move observations from a Maia (lc0) process."""

    def __init__(
        self,
        path: str | Sequence[str] | None = None,
        *,
        options: Mapping[str, Any] | None = None,
        engine: chess.engine.SimpleEngine | Any | None = None,
        multipv: int = DEFAULT_MULTIPV,
        timeout: float = MAIA_START_TIMEOUT,
        capture_stderr: bool = True,
    ) -> None:
        self.options = dict(options or {})
        self.multipv = max(1, int(multipv))
        self._owned = engine is None
        self._stderr: StderrCapture | None = None
        if engine is None:
            if path is None:
                raise HumanModelUnavailableError("no Maia command configured")
            self._stderr = StderrCapture() if capture_stderr else None
            try:
                engine = open_engine(
                    path, options=self.options, timeout=timeout, stderr=self._stderr
                )
            except EngineError as exc:
                self._close_stderr()
                raise HumanModelUnavailableError(f"could not start Maia: {exc}") from exc
        self.engine = engine
        self._enable_verbose_stats()

    @property
    def name(self) -> str | None:
        return dict(getattr(self.engine, "id", {}) or {}).get("name")

    def stderr_tail(self, limit: int = STDERR_TAIL) -> str | None:
        """What this process wrote to stderr, for the run that has to explain a crash."""
        return None if self._stderr is None else self._stderr.tail(limit)

    def declared_options(self) -> tuple[UciOption, ...]:
        declared = getattr(self.engine, "options", {}) or {}
        return tuple(UciOption.from_engine(option) for option in declared.values())

    @property
    def supports_rating(self) -> bool:
        """True for Maia-2/3, which take a rating; False for one-rating weights files."""
        return self._declares(SELF_ELO)

    def policy(
        self,
        board: chess.Board,
        *,
        rating: int | None = None,
        opponent_rating: int | None = None,
        multipv: int | None = None,
    ) -> list[PolicyMove]:
        """The moves this engine expects a human to play here, best first."""
        self._condition(rating, opponent_rating)
        wanted = max(1, int(multipv or self.multipv))
        infos, probabilities = self._stream(board, wanted)
        moves: list[PolicyMove] = []
        for index, info in enumerate(infos, 1):
            pv = list(info.get("pv") or [])
            if not pv or pv[0] not in board.legal_moves:
                continue
            win, draw, loss, expected = _wdl(info.get("wdl"), board.turn)
            moves.append(
                PolicyMove(
                    rank=int(info.get("multipv") or index),
                    uci=board.uci(pv[0]),
                    san=board.san(pv[0]),
                    probability=_lookup(probabilities, board, pv[0]),
                    win_permille=win,
                    draw_permille=draw,
                    loss_permille=loss,
                    expected_score=expected,
                )
            )
        moves.sort(key=lambda move: move.rank)
        if not moves and not board.is_game_over():
            raise HumanModelUnavailableError("Maia returned no legal policy moves")
        return moves

    def policy_at(
        self,
        board: chess.Board,
        ratings: Sequence[int],
        *,
        opponent_rating: int | None = None,
        multipv: int | None = None,
    ) -> dict[str, list[PolicyMove]]:
        """One policy per rating level, keyed as `MoveEval.maia_policy` keys them.

        A fixed-weights Maia is its own rating level: it answers for exactly one, and
        being asked for several is a configuration error, not something to paper over.
        """
        levels = [int(rating) for rating in ratings]
        if not levels:
            raise HumanModelUnavailableError("no rating level requested")
        if not self.supports_rating:
            if len(levels) > 1:
                raise HumanModelUnavailableError(
                    "this engine plays one rating only; register one engine per Maia "
                    "weights file to cover several"
                )
            return {str(levels[0]): self.policy(board, multipv=multipv)}
        return {
            str(rating): self.policy(
                board,
                rating=rating,
                opponent_rating=opponent_rating if opponent_rating is not None else rating,
                multipv=multipv,
            )
            for rating in levels
        }

    def close(self) -> None:
        if not self._owned:
            return
        quit_engine(self.engine)
        self._close_stderr()

    def _close_stderr(self) -> None:
        capture, self._stderr = self._stderr, None
        if capture is not None:
            capture.close()

    def __enter__(self) -> MaiaAdapter:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _declares(self, option: str) -> bool:
        declared = getattr(self.engine, "options", {}) or {}
        return option in declared

    def _enable_verbose_stats(self) -> None:
        """Ask for per-move policy shares where the build publishes them."""
        if not self._declares(VERBOSE_MOVE_STATS) or VERBOSE_MOVE_STATS in self.options:
            return
        try:
            self.engine.configure({VERBOSE_MOVE_STATS: True})
        except START_ERRORS:
            # Ranks without probabilities are still useful; a build that refuses the
            # option is not a reason to refuse the engine.
            pass

    def _condition(self, rating: int | None, opponent_rating: int | None) -> None:
        if rating is None and opponent_rating is None:
            return
        if not self.supports_rating:
            raise HumanModelUnavailableError(
                "this engine cannot be conditioned on a rating; register one engine per "
                "Maia weights file"
            )
        settings: dict[str, Any] = {}
        if rating is not None:
            settings[SELF_ELO] = int(rating)
        if opponent_rating is not None and self._declares(OPPO_ELO):
            settings[OPPO_ELO] = int(opponent_rating)
        try:
            self.engine.configure(settings)
        except START_ERRORS as exc:
            raise HumanModelUnavailableError(f"Maia rejected {settings!r}: {exc}") from exc

    def _stream(
        self, board: chess.Board, multipv: int
    ) -> tuple[list[dict[str, Any]], dict[str, float]]:
        """One policy query, read line by line so verbose stats are not merged away."""
        limit = chess.engine.Limit(nodes=POLICY_NODES)
        probabilities: dict[str, float] = {}
        try:
            with self.engine.analysis(board, limit, multipv=multipv) as analysis:
                for info in analysis:
                    entry = policy_probability(info)
                    if entry is not None:
                        uci, share = entry
                        probabilities.setdefault(uci, share)
                infos = [dict(info) for info in analysis.multipv]
        except START_ERRORS as exc:
            raise HumanModelUnavailableError(f"Maia query failed: {exc}") from exc
        return infos, probabilities

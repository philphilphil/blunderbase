"""The UCI core: starting a binary, reading what it declares, and analysing a board.

Ported from the predecessor's `backend/adapters/stockfish.py` and re-reviewed. Every UCI
engine Blunderbase drives comes through here — `maia.py` is an lc0 build and reuses this
module's command handling, option model and error taxonomy rather than repeating them.

What changed on the way in:

- The predecessor read node budgets and thread counts off `Settings` and exposed one method
  per tier of its puzzle detector. Engines are database rows here, so the adapter takes a
  path plus the UCI options that row stores and nothing else; budgets belong to the caller.
- Ranks now come from the engine's own `multipv` field. Ranking by enumeration silently
  renumbered every line below one that had to be skipped.
- A command is only `shlex.split` when it is not an existing file, so a binary living under
  a path with a space in it starts instead of being torn into two arguments.
- Every failure mode is a `EngineError` subclass. The caller of an adapter is a worker that
  has to write `failed` on a run and move on, not one that can afford a stray `KeyError`.
- An owned process writes its stderr into a `StderrCapture` instead of the server's own,
  because `AnalysisRun.stderr` is where a crashed engine has to be able to explain itself.
"""

from __future__ import annotations

import os
import shlex
import shutil
import tempfile
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import chess
import chess.engine

# A mate folded onto the centipawn scale, so one integer can order every evaluation.
MATE_SCORE = 10_000
# How much of a principal variation is worth keeping: enough for the engine-lines panel,
# short enough that a multi-PV run does not bloat one `MoveEval` row.
PV_PLIES = 12
START_TIMEOUT = 20.0
PROBE_TIMEOUT = 10.0
# How much of a dead engine's stderr is worth keeping on the run that hit it: the last
# words of a crash, not a whole search log.
STDERR_TAIL = 4000

# `popen_uci` raises `OSError` for a missing or unrunnable file, `TimeoutError` when the
# handshake never finishes, and `chess.engine.EngineError` (which `EngineTerminatedError`
# extends) when the process answers with something other than UCI.
START_ERRORS = (OSError, ValueError, TimeoutError, chess.engine.EngineError)
IS_WINDOWS = os.name == "nt"


class EngineError(RuntimeError):
    """The engine could not be started, or did not answer usably."""


class EngineStartError(EngineError):
    """The binary is missing, is not runnable, or does not speak UCI."""


class UciOptionError(EngineError):
    """An option the engine does not declare, or a value it will not accept."""


class StderrCapture:
    """A file the engine's stderr is written to, so a crash can be quoted back.

    An unlinked temporary file rather than a pipe: nothing in this process reads the
    engine's stderr while it runs, and a pipe nobody drains deadlocks the engine the
    moment it becomes chatty.
    """

    def __init__(self) -> None:
        self._file = tempfile.TemporaryFile(mode="w+b")

    def fileno(self) -> int:
        return self._file.fileno()

    def tail(self, limit: int = STDERR_TAIL) -> str | None:
        """The last `limit` bytes the engine wrote, or None if it wrote nothing."""
        try:
            size = self._file.seek(0, os.SEEK_END)
            self._file.seek(max(0, size - limit))
            text = self._file.read().decode("utf-8", "replace").strip()
        except (OSError, ValueError):
            return None
        return text or None

    def close(self) -> None:
        try:
            self._file.close()
        except OSError:
            pass


@dataclass(frozen=True, slots=True)
class UciOption:
    """One option the engine declared during its handshake."""

    name: str
    type: str
    default: Any = None
    min: int | None = None
    max: int | None = None
    var: tuple[str, ...] = ()
    # python-chess sets MultiPV, Ponder and friends per call; a stored value is ignored.
    managed: bool = False

    @classmethod
    def from_engine(cls, option: chess.engine.Option) -> UciOption:
        return cls(
            name=option.name,
            type=option.type,
            default=option.default,
            min=option.min,
            max=option.max,
            var=tuple(option.var or ()),
            managed=option.is_managed(),
        )

    def parse(self, value: Any) -> Any:
        """Coerce `value` to what the engine declared, or say why it cannot be."""
        if self.managed:
            raise UciOptionError(
                f"{self.name!r} is set per analysis and cannot be stored as an option"
            )
        native = chess.engine.Option(
            self.name, self.type, self.default, self.min, self.max, list(self.var)
        )
        try:
            return native.parse(value)
        except chess.engine.EngineError as exc:
            raise UciOptionError(str(exc)) from exc

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "type": self.type,
            "default": self.default,
            "min": self.min,
            "max": self.max,
            "var": list(self.var),
            "managed": self.managed,
        }


@dataclass(frozen=True, slots=True)
class EngineProbe:
    """What a binary said about itself when it was asked to identify."""

    name: str | None = None
    author: str | None = None
    options: tuple[UciOption, ...] = ()

    def option(self, name: str) -> UciOption | None:
        folded = name.casefold()
        return next((option for option in self.options if option.name.casefold() == folded), None)

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "author": self.author,
            "options": [option.as_dict() for option in self.options],
        }


@dataclass(frozen=True, slots=True)
class Score:
    """An evaluation from White's point of view, as the schema stores it."""

    cp: int | None
    mate_in: int | None
    folded_cp: int

    @classmethod
    def from_pov(cls, score: chess.engine.PovScore) -> Score:
        white = score.white()
        return cls(
            cp=white.score(),
            mate_in=white.mate(),
            folded_cp=int(white.score(mate_score=MATE_SCORE)),
        )

    @property
    def stored_cp(self) -> int | None:
        """`cp` as the schema stores it, with a delivered mate folded into it.

        `Mate(0)` (White is mated) and `MateGiven` (Black is mated) both report
        `mate_in = 0`, so that column alone cannot carry the sign. Writing the folded
        ±MATE_SCORE into `cp` keeps the pair unambiguous.
        """
        if self.cp is not None or self.mate_in != 0:
            return self.cp
        return self.folded_cp

    def pov(self, color: chess.Color) -> Score:
        if color == chess.WHITE:
            return self
        return Score(
            cp=None if self.cp is None else -self.cp,
            mate_in=None if self.mate_in is None else -self.mate_in,
            folded_cp=-self.folded_cp,
        )


@dataclass(frozen=True, slots=True)
class Candidate:
    """One principal variation of one analysis, ranked as the engine ranked it."""

    rank: int
    uci: str
    san: str
    score: Score
    pv_uci: list[str] = field(default_factory=list)
    pv_san: list[str] = field(default_factory=list)

    def as_line(self) -> dict[str, Any]:
        """The shape `MoveEval.best_lines` stores."""
        return {
            "multipv": self.rank,
            "cp": self.score.stored_cp,
            "mate": self.score.mate_in,
            "pv": list(self.pv_uci),
        }


@dataclass(frozen=True, slots=True)
class AnalysisResult:
    score: Score
    depth: int | None = None
    nodes: int | None = None
    candidates: list[Candidate] = field(default_factory=list)

    @property
    def best(self) -> Candidate | None:
        return self.candidates[0] if self.candidates else None

    def best_lines(self) -> list[dict[str, Any]]:
        return [candidate.as_line() for candidate in self.candidates]


def command_for(path: str | Sequence[str]) -> list[str]:
    """The argv for an engine.

    A stored path is one of three things: a real file (used verbatim, spaces and all), a
    command line with arguments (`lc0 --weights=maia-1500.pb.gz`), or a bare name to be
    found on PATH. Splitting unconditionally, as the predecessor did, broke the first case.

    A fourth kind of string is refused outright: an engine that is not a binary at all, such
    as the `wasm:…` build a browser tab loads inside itself. Split and started, it would
    fail with "no such file or directory" naming something that was never meant to be one.
    """
    if isinstance(path, str):
        # Imported here rather than at module scope: this adapter is loaded by the runner
        # process too, and it has no business pulling the database layer in to answer a
        # question about a string. The predicate lives in the service layer because that is
        # where every other caller asks it, and there must be one answer.
        from backend.services.engines import is_binary_path

        if not is_binary_path(path):
            raise EngineStartError(
                f"{path} does not name a binary: it is an engine that lives inside a "
                f"runner, and only that runner can start it"
            )
        candidate = Path(path).expanduser()
        if candidate.is_file():
            command = [str(candidate)]
        else:
            command = _windows_command(path) if IS_WINDOWS else shlex.split(path)
    else:
        command = [str(part) for part in path]
    if not command:
        raise EngineStartError("no engine command configured")
    return command


def _windows_command(command: str) -> list[str]:
    """Parse Windows argv quoting, the inverse of subprocess.list2cmdline.

    Backslashes are literal except immediately before a double quote; single quotes
    are ordinary characters. No shell expansion or command execution is involved.
    """
    args: list[str] = []
    index = 0
    while index < len(command):
        while index < len(command) and command[index] in " \t":
            index += 1
        if index == len(command):
            break
        arg: list[str] = []
        quoted = False
        while index < len(command):
            if command[index] in " \t" and not quoted:
                break
            slashes = 0
            while index < len(command) and command[index] == "\\":
                slashes += 1
                index += 1
            if index < len(command) and command[index] == '"':
                arg.append("\\" * (slashes // 2))
                if slashes % 2:
                    arg.append('"')
                elif quoted and command[index + 1:index + 2] == '"':
                    arg.append('"')
                    index += 1
                else:
                    quoted = not quoted
                index += 1
            else:
                arg.append("\\" * slashes)
                if index < len(command) and (quoted or command[index] not in " \t"):
                    arg.append(command[index])
                    index += 1
        if quoted:
            raise EngineStartError("unterminated double quote in engine command")
        args.append("".join(arg))
    return args


def _path_hint(program: str, exc: BaseException) -> str:
    """The sentence that turns "No such file or directory: 'stockfish'" into an instruction.

    A bare name is looked for on `PATH`, and the `PATH` a process has is not always the one
    the owner tested the name in — most sharply in the macOS desktop app, which is started
    by launchd and inherits no shell profile. Saying so, and saying where the binary
    probably is, is the difference between a dead end and a fix; a name that is not there at
    all gets the same sentence, which is still the right advice.

    Only for a bare name that was never found. A path that exists and refuses to run is a
    different problem, and pointing at `PATH` would be a wrong answer stated confidently.
    """
    if not isinstance(exc, FileNotFoundError) or os.sep in program:
        return ""
    found = shutil.which(program)
    if found is not None:
        return ""
    return (
        f" — {program!r} is not on this process's PATH. Give the full path to the binary; "
        f"`which {program}` in a terminal prints it."
    )


def quit_engine(engine: Any) -> None:
    """Stop an engine process. Closing one that is already gone is not an error."""
    try:
        engine.quit()
    except BaseException:
        try:
            engine.close()
        except BaseException:
            pass


def open_engine(
    path: str | Sequence[str],
    *,
    options: Mapping[str, Any] | None = None,
    timeout: float = START_TIMEOUT,
    stderr: StderrCapture | None = None,
) -> chess.engine.SimpleEngine:
    command = command_for(path)
    extra: dict[str, Any] = {} if stderr is None else {"stderr": stderr.fileno()}
    try:
        engine = chess.engine.SimpleEngine.popen_uci(command, timeout=timeout, **extra)
    except START_ERRORS as exc:
        raise EngineStartError(
            f"could not start {shlex.join(command)}: {exc}{_path_hint(command[0], exc)}"
        ) from exc
    if options:
        try:
            engine.configure(dict(options))
        except START_ERRORS as exc:
            quit_engine(engine)
            raise UciOptionError(f"{command[0]} rejected its options: {exc}") from exc
    return engine


def probe_engine(path: str | Sequence[str], *, timeout: float = PROBE_TIMEOUT) -> EngineProbe:
    """Start the binary, read its identity and declared options, and stop it again."""
    engine = open_engine(path, timeout=timeout)
    try:
        identity = dict(engine.id)
        options = tuple(UciOption.from_engine(option) for option in engine.options.values())
    finally:
        quit_engine(engine)
    return EngineProbe(name=identity.get("name"), author=identity.get("author"), options=options)


def line(
    board: chess.Board, pv: Iterable[chess.Move], limit: int = PV_PLIES
) -> tuple[list[str], list[str]]:
    """A principal variation as UCI and SAN, truncated at the first move that is not legal."""
    replay = board.copy(stack=False)
    ucis: list[str] = []
    sans: list[str] = []
    for move in list(pv)[:limit]:
        if move not in replay.legal_moves:
            break
        ucis.append(replay.uci(move))
        sans.append(replay.san(move))
        replay.push(move)
    return ucis, sans


def _infos(result: Any) -> list[dict[str, Any]]:
    return list(result) if isinstance(result, list) else [result]


class StockfishAdapter:
    """UCI wrapper returning structured, White-POV analysis of a board."""

    def __init__(
        self,
        path: str | Sequence[str] | None = None,
        *,
        options: Mapping[str, Any] | None = None,
        engine: chess.engine.SimpleEngine | Any | None = None,
        timeout: float = START_TIMEOUT,
        capture_stderr: bool = True,
    ) -> None:
        self.options = dict(options or {})
        self._owned = engine is None
        self._stderr: StderrCapture | None = None
        if engine is None:
            if path is None:
                raise EngineStartError("no engine path configured")
            self._stderr = StderrCapture() if capture_stderr else None
            try:
                engine = open_engine(
                    path, options=self.options, timeout=timeout, stderr=self._stderr
                )
            except BaseException:
                self._close_stderr()
                raise
        self.engine = engine

    @property
    def name(self) -> str | None:
        return dict(getattr(self.engine, "id", {}) or {}).get("name")

    def stderr_tail(self, limit: int = STDERR_TAIL) -> str | None:
        """What this process wrote to stderr, for the run that has to explain a crash."""
        return None if self._stderr is None else self._stderr.tail(limit)

    def declared_options(self) -> tuple[UciOption, ...]:
        declared = getattr(self.engine, "options", {}) or {}
        return tuple(UciOption.from_engine(option) for option in declared.values())

    def configure(self, options: Mapping[str, Any]) -> None:
        try:
            self.engine.configure(dict(options))
        except START_ERRORS as exc:
            raise UciOptionError(f"engine rejected {dict(options)!r}: {exc}") from exc
        self.options.update(options)

    def analyse(
        self,
        board: chess.Board,
        limit: chess.engine.Limit,
        *,
        multipv: int | None = None,
        root_moves: Sequence[chess.Move] | None = None,
        pv_plies: int = PV_PLIES,
    ) -> AnalysisResult:
        kwargs: dict[str, Any] = {}
        if multipv:
            kwargs["multipv"] = multipv
        if root_moves is not None:
            kwargs["root_moves"] = list(root_moves)
        try:
            raw = self.engine.analyse(board, limit, **kwargs)
        except START_ERRORS as exc:
            raise EngineError(f"analysis failed: {exc}") from exc
        infos = _infos(raw)
        if not infos or "score" not in infos[0]:
            raise EngineError("engine returned no evaluation")
        head = infos[0]
        candidates: list[Candidate] = []
        for index, info in enumerate(infos, 1):
            pv = list(info.get("pv") or [])
            if not pv or pv[0] not in board.legal_moves or "score" not in info:
                continue
            pv_uci, pv_san = line(board, pv, pv_plies)
            candidates.append(
                Candidate(
                    rank=int(info.get("multipv") or index),
                    uci=board.uci(pv[0]),
                    san=board.san(pv[0]),
                    score=Score.from_pov(info["score"]),
                    pv_uci=pv_uci,
                    pv_san=pv_san,
                )
            )
        candidates.sort(key=lambda candidate: candidate.rank)
        return AnalysisResult(
            score=Score.from_pov(head["score"]),
            depth=head.get("depth"),
            nodes=head.get("nodes"),
            candidates=candidates,
        )

    def close(self) -> None:
        if not self._owned:
            return
        quit_engine(self.engine)
        self._close_stderr()

    def _close_stderr(self) -> None:
        capture, self._stderr = self._stderr, None
        if capture is not None:
            capture.close()

    def __enter__(self) -> StockfishAdapter:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

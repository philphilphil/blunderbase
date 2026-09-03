"""The `go infinite` driver: what a snapshot is, and how often one is allowed out.

Two halves. `SnapshotBuffer` is the interesting one and needs no engine at all — a fake
clock and synthetic `info` dicts prove the merge and the throttle exactly, with none of the
timing slop a subprocess would add. `InfiniteSearch` then gets the honest treatment: a real
scripted process over a real pipe, because the thing it has to get right is stopping one.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any

import chess
import chess.engine
import pytest

from backend.adapters.infinite import InfiniteSearch, Snapshot, SnapshotBuffer
from backend.adapters.stockfish import StockfishAdapter
from tests.fake_uci import STOCKFISH_OPTIONS, commands, fake_engine

STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
# Black to move, so a score reported by the engine is Black's.
BLACK_TO_MOVE = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
# The two ways a game ends with nothing left to search: fool's mate, and a king with no
# move that is not check. Scrolling to the last move of a won game reaches the first.
CHECKMATE = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3"
STALEMATE = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"


class Clock:
    """A clock a test winds by hand."""

    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def tick(self, seconds: float) -> None:
        self.now += seconds


def info(
    *,
    depth: int = 20,
    multipv: int = 1,
    cp: int | None = 34,
    mate: int | None = None,
    pv: list[str] | None = None,
    board: chess.Board | None = None,
    **extra: Any,
) -> dict[str, Any]:
    """One parsed `info` line, in the shape python-chess hands the driver."""
    playing = board or chess.Board(STARTING_FEN)
    score = chess.engine.Cp(cp) if mate is None else chess.engine.Mate(mate)
    return {
        "depth": depth,
        "multipv": multipv,
        "score": chess.engine.PovScore(score, playing.turn),
        "pv": _variation(playing, pv or ["e2e4", "e7e5"]),
        **extra,
    }


def _variation(board: chess.Board, moves: list[str]) -> list[chess.Move]:
    """A PV is a line, not a set: each move is legal only after the ones before it."""
    replay = board.copy(stack=False)
    parsed: list[chess.Move] = []
    for uci in moves:
        move = replay.parse_uci(uci)
        parsed.append(move)
        replay.push(move)
    return parsed


# --- merging and throttling ---------------------------------------------------


def test_the_lines_of_one_depth_are_merged_into_one_picture() -> None:
    """A multi-PV engine reports one variation at a time; the board wants all of them."""
    clock = Clock()
    board = chess.Board(STARTING_FEN)
    buffer = SnapshotBuffer(board, multipv=3, interval=0.5, clock=clock)

    first = buffer.offer(info(multipv=1, cp=34, pv=["e2e4", "e7e5"], nodes=1000))
    clock.tick(1.0)
    buffer.offer(info(multipv=2, cp=21, pv=["d2d4", "d7d5"]))
    buffer.offer(info(multipv=3, mate=5, cp=None, pv=["c2c4"], nodes=2000, nps=1840, time=10.0))
    whole = buffer.flush()

    assert first is not None
    assert first.lines == ({"multipv": 1, "cp": 34, "mate": None, "pv": ["e2e4", "e7e5"]},)
    assert whole is not None
    assert [entry["multipv"] for entry in whole.lines] == [1, 2, 3]
    assert whole.lines[2] == {"multipv": 3, "cp": None, "mate": 5, "pv": ["c2c4"]}
    assert (whole.nodes, whole.nps, whole.time_ms) == (2000, 1840, 10_000)


def test_no_more_than_one_snapshot_per_interval_leaves_the_buffer() -> None:
    clock = Clock()
    buffer = SnapshotBuffer(chess.Board(STARTING_FEN), multipv=1, interval=0.5, clock=clock)

    # The first is immediate: a board must not sit blank for half a second.
    assert buffer.offer(info(depth=10)) is not None
    clock.tick(0.2)
    assert buffer.offer(info(depth=11)) is None
    clock.tick(0.2)
    assert buffer.offer(info(depth=12)) is None
    clock.tick(0.2)
    later = buffer.offer(info(depth=13))

    assert later is not None
    assert later.depth == 13, "the picture that goes out is the newest one, not the queue"


def test_nothing_goes_out_when_nothing_has_changed() -> None:
    clock = Clock()
    buffer = SnapshotBuffer(chess.Board(STARTING_FEN), interval=0.5, clock=clock)
    buffer.offer(info(depth=10))
    clock.tick(5.0)

    assert buffer.due() is None
    assert buffer.flush() is None


def test_a_quiet_engine_still_gets_its_last_burst_shown() -> None:
    """Three lines and then a long think must not sit unsent until the next `info`."""
    clock = Clock()
    buffer = SnapshotBuffer(chess.Board(STARTING_FEN), multipv=2, interval=0.5, clock=clock)
    buffer.offer(info(multipv=1, depth=10))
    buffer.offer(info(multipv=2, cp=5, pv=["d2d4"]))
    clock.tick(0.6)

    pending = buffer.due()

    assert pending is not None
    assert len(pending.lines) == 2


def test_a_bounded_score_is_not_an_evaluation() -> None:
    """`lowerbound` is the engine mid-window, and showing one makes the board flicker."""
    buffer = SnapshotBuffer(chess.Board(STARTING_FEN), clock=Clock())

    snapshot = buffer.offer(info(cp=900, lowerbound=True))

    assert snapshot is not None
    assert snapshot.lines == (), "the depth still counts; the number it was not sure of does not"
    assert snapshot.depth == 20


def test_a_score_is_reported_from_the_side_to_move_s_chair() -> None:
    """An analysis board says who is better *for the mover*, whichever colour that is."""
    board = chess.Board(BLACK_TO_MOVE)
    buffer = SnapshotBuffer(board, clock=Clock())

    snapshot = buffer.offer(info(cp=-40, pv=["e7e5"], board=board))

    assert snapshot is not None
    assert snapshot.lines[0]["cp"] == -40


def test_a_variation_beyond_the_multipv_asked_for_is_ignored() -> None:
    buffer = SnapshotBuffer(chess.Board(STARTING_FEN), multipv=2, clock=Clock())
    buffer.offer(info(multipv=1))
    buffer.offer(info(multipv=5, pv=["g1f3"]))

    snapshot = buffer.flush() or buffer.offer(info(multipv=1, depth=21))

    assert snapshot is not None
    assert [entry["multipv"] for entry in snapshot.lines] == [1]


def test_a_snapshot_is_the_shape_the_wire_and_the_database_both_speak() -> None:
    snapshot = Snapshot(depth=24, nodes=18_402_113, nps=1_840_211, time_ms=10_000, lines=())

    assert snapshot.as_dict() == {
        "depth": 24,
        "nodes": 18_402_113,
        "nps": 1_840_211,
        "time_ms": 10_000,
        "lines": [],
    }


# --- against a real process ------------------------------------------------------


def scripted(tmp_path: Path, **scenario: Any) -> list[str]:
    return fake_engine(tmp_path, name="FakeFish 1", options=STOCKFISH_OPTIONS, **scenario)


def test_a_search_that_is_stopped_leaves_the_engine_ready_for_the_next_one(
    tmp_path: Path,
) -> None:
    """A restart is a stop and a go on the same process, so stopping has to be clean."""
    log = tmp_path / "commands.log"
    command = scripted(
        tmp_path,
        log=str(log),
        # One reply per position: an engine's `bestmove` has to be legal on the board it
        # was actually given, and the second `go` is at a different one.
        go=[
            {
                "info": ["depth 12 score cp 31 nodes 4000 pv e2e4 e7e5"],
                "hold": True,
                "bestmove": "e2e4",
            },
            {
                "info": ["depth 9 score cp -18 nodes 2500 pv e7e5 g1f3"],
                "hold": True,
                "bestmove": "e7e5",
            },
        ],
    )
    seen: list[Snapshot] = []
    stop = threading.Event()

    with StockfishAdapter(command) as adapter:
        search = InfiniteSearch(adapter, interval=0.0, tick=0.01)
        worker = threading.Thread(
            target=search.run,
            args=(chess.Board(STARTING_FEN),),
            kwargs={"multipv": 1, "on_snapshot": seen.append, "stop": stop},
        )
        worker.start()
        deadline = time.monotonic() + 10.0
        while not seen and time.monotonic() < deadline:
            time.sleep(0.01)
        stop.set()
        worker.join(10.0)
        assert not worker.is_alive(), "the driver did not come back when it was stopped"
        # The same process serves the next position: that is what a restart is.
        again = search.run(
            chess.Board(BLACK_TO_MOVE),
            multipv=1,
            on_snapshot=seen.append,
            stop=_set_after(0.3),
        )

    assert again is False, "the second search was stopped too, not finished"
    assert len(seen) >= 2
    assert seen[0].lines[0]["pv"][0] == "e2e4"
    assert commands(log, "go").count("go infinite") == 2
    assert commands(log, "stop") == ["stop", "stop"]


def test_an_engine_that_answers_and_stops_says_so(tmp_path: Path) -> None:
    """A terminal position gets a `bestmove` at once; the caller has to be able to tell."""
    command = scripted(
        tmp_path, go_default={"info": ["depth 3 score cp 12 nodes 100 pv e2e4"], "bestmove": "e2e4"}
    )
    seen: list[Snapshot] = []

    with StockfishAdapter(command) as adapter:
        finished = InfiniteSearch(adapter, interval=0.0, tick=0.01).run(
            chess.Board(STARTING_FEN),
            multipv=1,
            on_snapshot=seen.append,
            stop=threading.Event(),
        )

    assert finished is True
    assert seen and seen[-1].lines[0]["cp"] == 12


@pytest.mark.parametrize("fen", [CHECKMATE, STALEMATE])
def test_a_finished_game_is_answered_without_asking_the_engine(tmp_path: Path, fen: str) -> None:
    """There is no search in a mate, and the answers engines give there are a minefield."""
    log = tmp_path / "commands.log"
    command = scripted(tmp_path, log=str(log))
    seen: list[Snapshot] = []

    with StockfishAdapter(command) as adapter:
        finished = InfiniteSearch(adapter, interval=0.0, tick=0.01).run(
            chess.Board(fen),
            multipv=1,
            on_snapshot=seen.append,
            stop=threading.Event(),
        )

    assert finished is True
    assert seen == [Snapshot()], "the board is told there is nothing, not left on the old picture"
    assert commands(log, "go") == [], "a finished game never reached the engine"


def test_a_bestmove_the_library_cannot_parse_costs_the_process_not_the_slot(
    tmp_path: Path,
) -> None:
    """Leela answers a terminal position with `bestmove a1a1`, which python-chess rejects.

    It rejects it without ever finishing the analysis, so the wait for the engine to go
    quiet never returns on its own. Raising is what matters: the caller's `except` is what
    drops the process, and a process is cheaper than a slot the pool never sees again.
    """
    from backend.adapters.stockfish import EngineError

    command = scripted(
        tmp_path,
        go_default={
            "info": ["depth 4 score cp 12 nodes 900 pv e2e4"],
            "hold": True,
            "bestmove": "a1a1",
        },
    )

    with StockfishAdapter(command) as adapter:
        driver = InfiniteSearch(adapter, interval=0.0, tick=0.01, quieten_timeout=0.5)
        with pytest.raises(EngineError):
            driver.run(
                chess.Board(STARTING_FEN),
                multipv=1,
                on_snapshot=lambda _snapshot: None,
                stop=_set_after(0.3),
            )


def test_an_engine_that_dies_mid_search_is_reported_as_an_engine_error(tmp_path: Path) -> None:
    from backend.adapters.stockfish import EngineError

    command = scripted(tmp_path, go_default={"crash": True, "stderr": "Segmentation fault"})

    with StockfishAdapter(command) as adapter:
        with pytest.raises(EngineError):
            InfiniteSearch(adapter, interval=0.0, tick=0.01).run(
                chess.Board(STARTING_FEN),
                multipv=1,
                on_snapshot=lambda _snapshot: None,
                stop=threading.Event(),
            )


def _set_after(seconds: float) -> threading.Event:
    """A stop event that fires on its own, so the caller can run the search inline."""
    event = threading.Event()
    threading.Timer(seconds, event.set).start()
    return event

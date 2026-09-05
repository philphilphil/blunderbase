"""The UCI adapters, driven against a real scripted engine process."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from subprocess import list2cmdline
from typing import Any

import chess
import chess.engine
import pytest
from fake_uci import (
    MAIA_OPTIONS,
    STOCKFISH_OPTIONS,
    commands,
    fake_engine,
    option,
)

from backend.adapters import stockfish
from backend.adapters.maia import (
    HumanModelUnavailableError,
    MaiaAdapter,
    PolicyMove,
    policy_probability,
)
from backend.adapters.stockfish import (
    MATE_SCORE,
    AnalysisResult,
    EngineError,
    EngineStartError,
    Score,
    StockfishAdapter,
    UciOptionError,
    command_for,
    line,
    probe_engine,
)

MATE_IN_ONE = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"
CHECKMATE = "7k/5QQ1/8/8/8/8/8/6K1 b - - 0 1"

Builder = Callable[..., list[str]]


@pytest.fixture()
def build(tmp_path: Path) -> Builder:
    def builder(**scenario: Any) -> list[str]:
        return fake_engine(tmp_path, **scenario)

    return builder


@pytest.fixture()
def log_path(tmp_path: Path) -> Path:
    return tmp_path / "engine.log"


def go(*info: str, bestmove: str = "e2e4", **extra: Any) -> dict[str, Any]:
    return {"info": list(info), "bestmove": bestmove, **extra}


# --- command handling -----------------------------------------------------


def test_a_real_file_is_the_whole_command_even_with_a_space_in_it(tmp_path: Path) -> None:
    binary = tmp_path / "Engine Files" / "stockfish 17"
    binary.parent.mkdir()
    binary.write_text("#!/bin/sh\n")
    assert command_for(str(binary)) == [str(binary)]


def test_a_command_line_is_split_into_its_arguments() -> None:
    assert command_for("lc0 --weights=maia-1500.pb.gz") == ["lc0", "--weights=maia-1500.pb.gz"]


def test_an_empty_command_is_refused() -> None:
    with pytest.raises(EngineStartError):
        command_for("   ")


@pytest.mark.parametrize(
    ("command", "expected"),
    [
        (r"C:\engines\lc0.exe --weights=C:\models\maia.pb.gz",
         [r"C:\engines\lc0.exe", r"--weights=C:\models\maia.pb.gz"]),
        ('"C:\\Program Files\\lc0.exe" --weights="C:\\My Models\\maia.pb.gz"',
         [r"C:\Program Files\lc0.exe", r"--weights=C:\My Models\maia.pb.gz"]),
        (r"lc0 --cache=C:\models\ --quiet", ["lc0", "--cache=C:\\models\\", "--quiet"]),
        ("lc0 --name=O'Brien", ["lc0", "--name=O'Brien"]),
        ('lc0 ""', ["lc0", ""]),
    ],
)
def test_windows_engine_commands_preserve_paths_and_arguments(
    monkeypatch: pytest.MonkeyPatch, command: str, expected: list[str],
) -> None:
    monkeypatch.setattr(stockfish, "IS_WINDOWS", True)
    assert command_for(command) == expected


@pytest.mark.parametrize("argument", [
    "", "ordinary", "two words", "trailing slash \\", 'a"quote',
    'a\\"quote', "C:\\models\\", "\twith a tab", '"quoted"',
])
def test_windows_arguments_round_trip_python_process_quoting(
    monkeypatch: pytest.MonkeyPatch, argument: str,
) -> None:
    monkeypatch.setattr(stockfish, "IS_WINDOWS", True)
    argv = [r"C:\Program Files\lc0.exe", argument, "--last"]
    assert command_for(list2cmdline(argv)) == argv


def test_unterminated_windows_quotes_are_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(stockfish, "IS_WINDOWS", True)
    with pytest.raises(EngineStartError, match="unterminated"):
        command_for('lc0 --weights="C:\\My Models\\maia.pb.gz')


# --- probing --------------------------------------------------------------


def test_a_probe_reports_the_identity_and_the_declared_options(build: Builder) -> None:
    probed = probe_engine(build(name="FakeFish 1", options=STOCKFISH_OPTIONS))

    assert probed.name == "FakeFish 1"
    assert probed.author == "blunderbase tests"
    assert [declared.name for declared in probed.options] == [
        "Threads",
        "Hash",
        "UCI_ShowWDL",
        "Style",
        "SyzygyPath",
        "MultiPV",
    ]
    threads = probed.option("threads")  # the UI is not going to match case
    assert threads is not None
    assert (threads.type, threads.min, threads.max) == ("spin", 1, 8)


def test_an_option_python_chess_sets_itself_is_marked_managed(build: Builder) -> None:
    probed = probe_engine(build(options=STOCKFISH_OPTIONS))

    multipv = probed.option("MultiPV")
    assert multipv is not None and multipv.managed is True


def test_a_binary_that_never_says_uciok_is_rejected(build: Builder) -> None:
    with pytest.raises(EngineStartError):
        probe_engine(build(exit_before_uciok=True))


def test_a_binary_that_hangs_is_rejected_within_the_timeout(build: Builder) -> None:
    with pytest.raises(EngineStartError):
        probe_engine(build(no_uciok=True), timeout=0.4)


def test_a_missing_binary_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(EngineStartError):
        probe_engine(str(tmp_path / "not-an-engine"))


def test_a_bare_name_that_is_not_on_the_path_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    """The desktop app is launched by launchd and sees no shell PATH — say where to look."""
    monkeypatch.setenv("PATH", "")

    with pytest.raises(EngineStartError) as raised:
        probe_engine("stockfish")

    message = str(raised.value)
    assert "not on this process's PATH" in message
    assert "which stockfish" in message


def test_a_path_that_exists_and_will_not_run_is_not_blamed_on_the_path(tmp_path: Path) -> None:
    """A wrong answer stated confidently is worse than the bare errno it replaces."""
    with pytest.raises(EngineStartError) as raised:
        probe_engine(str(tmp_path / "not-an-engine"))

    assert "PATH" not in str(raised.value)


# --- stockfish analysis ---------------------------------------------------


def test_the_stored_options_are_sent_to_the_engine(build: Builder, log_path: Path) -> None:
    command = build(options=STOCKFISH_OPTIONS, log=str(log_path))
    with StockfishAdapter(command, options={"Threads": 2, "Hash": 64}):
        pass

    sent = commands(log_path, "setoption")
    assert "setoption name Threads value 2" in sent
    assert "setoption name Hash value 64" in sent
    assert commands(log_path, "quit") == ["quit"]


def test_an_option_the_engine_does_not_declare_is_refused_at_start(build: Builder) -> None:
    with pytest.raises(UciOptionError):
        StockfishAdapter(build(options=STOCKFISH_OPTIONS), options={"Nonsense": 1})


def test_an_evaluation_carries_the_score_depth_nodes_and_the_line(build: Builder) -> None:
    command = build(go=[go("depth 18 score cp 34 nodes 4242 pv e2e4 e7e5 g1f3")])
    with StockfishAdapter(command) as adapter:
        result = adapter.analyse(chess.Board(), chess.engine.Limit(nodes=1000))

    assert result.depth == 18
    assert result.nodes == 4242
    assert result.score == Score(cp=34, mate_in=None, folded_cp=34)
    best = result.best
    assert best is not None
    assert (best.uci, best.san) == ("e2e4", "e4")
    assert best.pv_uci == ["e2e4", "e7e5", "g1f3"]
    assert best.pv_san == ["e4", "e5", "Nf3"]


def test_a_score_is_white_pov_even_when_black_is_to_move(build: Builder) -> None:
    board = chess.Board()
    board.push_uci("e2e4")
    command = build(go=[go("depth 12 score cp -40 pv e7e5", bestmove="e7e5")])

    with StockfishAdapter(command) as adapter:
        result = adapter.analyse(board, chess.engine.Limit(nodes=1000))

    # The engine speaks from the mover's point of view; the schema stores White's.
    assert result.score.cp == 40
    assert result.score.pov(chess.BLACK).cp == -40


def test_a_mate_score_is_folded_onto_the_centipawn_scale(build: Builder) -> None:
    command = build(go=[go("depth 20 score mate 2 pv a1a8", bestmove="a1a8")])
    with StockfishAdapter(command) as adapter:
        result = adapter.analyse(chess.Board(MATE_IN_ONE), chess.engine.Limit(nodes=1000))

    assert result.score.mate_in == 2
    assert result.score.cp is None
    assert result.score.folded_cp == MATE_SCORE - 2


def test_a_delivered_mate_keeps_its_sign_in_the_stored_centipawns() -> None:
    mated = Score.from_pov(chess.engine.PovScore(chess.engine.Mate(0), chess.WHITE))
    delivered = Score.from_pov(chess.engine.PovScore(chess.engine.MateGiven, chess.WHITE))

    assert (mated.mate_in, delivered.mate_in) == (0, 0)
    assert mated.stored_cp == -MATE_SCORE
    assert delivered.stored_cp == MATE_SCORE


def test_multipv_lines_keep_the_rank_the_engine_gave_them(build: Builder) -> None:
    command = build(
        options=STOCKFISH_OPTIONS,
        go=[
            go(
                "depth 14 multipv 1 score cp 30 pv e2e4 e7e5",
                "depth 14 multipv 2 score cp 18 pv d2d4 d7d5",
                "depth 14 multipv 3 score mate -4 pv g1f3 g8f6",
            )
        ],
    )
    with StockfishAdapter(command) as adapter:
        result = adapter.analyse(chess.Board(), chess.engine.Limit(nodes=1000), multipv=3)

    assert [(c.rank, c.uci) for c in result.candidates] == [
        (1, "e2e4"),
        (2, "d2d4"),
        (3, "g1f3"),
    ]
    assert result.best_lines() == [
        {"multipv": 1, "cp": 30, "mate": None, "pv": ["e2e4", "e7e5"]},
        {"multipv": 2, "cp": 18, "mate": None, "pv": ["d2d4", "d7d5"]},
        {"multipv": 3, "cp": None, "mate": -4, "pv": ["g1f3", "g8f6"]},
    ]


def test_a_line_that_cannot_be_played_does_not_renumber_the_ones_below_it(
    build: Builder,
) -> None:
    """The predecessor ranked by enumeration, so dropping line 1 promoted line 2 to rank 1
    and every stored `best_lines` entry below it was labelled with someone else's rank."""
    command = build(
        options=STOCKFISH_OPTIONS,
        go=[
            go(
                "depth 9 multipv 1 score cp 30 pv e2e5",  # not a legal move
                "depth 9 multipv 2 score cp 18 pv d2d4 d7d5",
                bestmove="d2d4",
            )
        ],
    )
    with StockfishAdapter(command) as adapter:
        result = adapter.analyse(chess.Board(), chess.engine.Limit(nodes=1000), multipv=2)

    assert [(c.rank, c.uci) for c in result.candidates] == [(2, "d2d4")]


def test_a_principal_variation_is_truncated_to_the_stored_length(build: Builder) -> None:
    command = build(go=[go("depth 20 score cp 12 pv e2e4 e7e5 g1f3 b8c6 f1c4 g8f6")])
    with StockfishAdapter(command) as adapter:
        result = adapter.analyse(chess.Board(), chess.engine.Limit(nodes=1000), pv_plies=3)

    best = result.best
    assert best is not None
    assert best.pv_uci == ["e2e4", "e7e5", "g1f3"]


def test_an_answer_without_an_evaluation_is_an_engine_error(build: Builder) -> None:
    command = build(go=[go("depth 3 nodes 12 pv e2e4")])
    with StockfishAdapter(command) as adapter:
        with pytest.raises(EngineError):
            adapter.analyse(chess.Board(), chess.engine.Limit(nodes=1000))


def test_a_dead_engine_is_reported_as_an_engine_error(build: Builder) -> None:
    command = build(go=[go(crash=True)])
    with StockfishAdapter(command) as adapter:
        with pytest.raises(EngineError):
            adapter.analyse(chess.Board(), chess.engine.Limit(nodes=1000))


def test_a_line_stops_at_the_first_move_that_is_not_legal() -> None:
    board = chess.Board()
    moves = [chess.Move.from_uci(uci) for uci in ("e2e4", "e7e5", "e2e4")]

    assert line(board, moves) == (["e2e4", "e7e5"], ["e4", "e5"])


def test_an_injected_engine_is_not_shut_down_by_the_adapter() -> None:
    class Borrowed:
        def __init__(self) -> None:
            self.quits = 0

        def quit(self) -> None:
            self.quits += 1

    borrowed = Borrowed()
    StockfishAdapter(engine=borrowed).close()

    assert borrowed.quits == 0


def test_an_analysis_result_without_candidates_has_no_best_move() -> None:
    assert AnalysisResult(score=Score(0, None, 0)).best is None


# --- maia -----------------------------------------------------------------


def maia_go(*, wdl: bool = True, verbose: bool = True) -> dict[str, Any]:
    info = []
    if verbose:
        info += [
            "string e2e4  (322 ) N:       0 (+ 0) (P: 34.10%) (Q:  0.11)",
            "string d2d4  (300 ) N:       0 (+ 0) (P: 21.50%) (Q:  0.09)",
            "string node  (--- ) N:       1 (+ 0) (P:  0.00%) (Q:  0.00)",
        ]
    tail = " wdl 500 300 200" if wdl else ""
    info += [
        f"depth 1 multipv 1 score cp 20{tail} pv e2e4",
        f"depth 1 multipv 2 score cp 15{tail} pv d2d4",
    ]
    return go(*info)


def test_maia_reports_its_ordering_with_the_policy_share_it_published(
    build: Builder,
) -> None:
    command = build(name="lc0 maia-1900", options=MAIA_OPTIONS, go=[maia_go()])
    with MaiaAdapter(command) as maia:
        moves = maia.policy(chess.Board(), multipv=2)

    assert [(move.rank, move.uci, move.probability) for move in moves] == [
        (1, "e2e4", 0.341),
        (2, "d2d4", 0.215),
    ]
    assert moves[0].as_dict() == {
        "uci": "e2e4",
        "san": "e4",
        "rank": 1,
        "p": 0.341,
        "expected_score": 0.65,
        "wdl": [500, 300, 200],
    }


def test_maia_records_no_probability_rather_than_inventing_one(build: Builder) -> None:
    command = build(options=MAIA_OPTIONS, go=[maia_go(verbose=False, wdl=False)])
    with MaiaAdapter(command) as maia:
        moves = maia.policy(chess.Board(), multipv=2)

    assert [move.probability for move in moves] == [None, None]
    assert moves[0].as_dict() == {"uci": "e2e4", "san": "e4", "rank": 1}


def test_verbose_move_stats_are_switched_on_when_the_build_has_them(
    build: Builder, log_path: Path
) -> None:
    command = build(options=MAIA_OPTIONS, log=str(log_path), go=[maia_go()])
    with MaiaAdapter(command):
        pass

    assert "setoption name VerboseMoveStats value true" in commands(log_path, "setoption")


def test_a_rating_is_sent_as_the_elo_options(build: Builder, log_path: Path) -> None:
    command = build(options=MAIA_OPTIONS, log=str(log_path), go=[maia_go()])
    with MaiaAdapter(command) as maia:
        assert maia.supports_rating is True
        maia.policy(chess.Board(), rating=1700, opponent_rating=1600, multipv=2)

    # python-chess only sends an option whose value differs from the one the engine
    # declared as its default, so both of these have to be off-default to be visible.
    sent = commands(log_path, "setoption")
    assert "setoption name SelfElo value 1700" in sent
    assert "setoption name OppoElo value 1600" in sent


def test_one_policy_per_rating_level_keyed_the_way_the_schema_keys_them(
    build: Builder,
) -> None:
    command = build(options=MAIA_OPTIONS, go=[maia_go(), maia_go()])
    with MaiaAdapter(command) as maia:
        policy = maia.policy_at(chess.Board(), [1500, 1900], multipv=2)

    assert sorted(policy) == ["1500", "1900"]
    assert [move.uci for move in policy["1900"]] == ["e2e4", "d2d4"]


def fixed_weights_options() -> list[dict[str, Any]]:
    return [
        option("MultiPV", "spin", default=1, min=1, max=10),
        option("VerboseMoveStats", "check", default=False),
    ]


def test_a_fixed_weights_maia_refuses_to_answer_as_another_rating(build: Builder) -> None:
    command = build(options=fixed_weights_options(), go=[maia_go()])
    with MaiaAdapter(command) as maia:
        assert maia.supports_rating is False
        with pytest.raises(HumanModelUnavailableError):
            maia.policy(chess.Board(), rating=1700)


def test_a_fixed_weights_maia_is_one_rating_level(build: Builder) -> None:
    command = build(options=fixed_weights_options(), go=[maia_go()])
    with MaiaAdapter(command) as maia:
        policy = maia.policy_at(chess.Board(), [1500], multipv=2)
        assert sorted(policy) == ["1500"]

        with pytest.raises(HumanModelUnavailableError):
            maia.policy_at(chess.Board(), [1500, 1900])


def test_a_move_maia_cannot_legally_play_is_dropped(build: Builder) -> None:
    command = build(
        options=MAIA_OPTIONS,
        go=[go("depth 1 multipv 1 score cp 20 pv e2e5", "depth 1 multipv 2 score cp 9 pv d2d4")],
    )
    with MaiaAdapter(command) as maia:
        moves = maia.policy(chess.Board(), multipv=2)

    assert [(move.rank, move.uci) for move in moves] == [(2, "d2d4")]


def test_no_usable_policy_at_all_raises_rather_than_degrading(build: Builder) -> None:
    command = build(options=MAIA_OPTIONS, go=[go("depth 1 multipv 1 score cp 20 pv e2e5")])
    with MaiaAdapter(command) as maia:
        with pytest.raises(HumanModelUnavailableError):
            maia.policy(chess.Board(), multipv=1)


def test_a_finished_game_has_no_policy_and_that_is_not_an_error(build: Builder) -> None:
    command = build(options=MAIA_OPTIONS, go=[go(bestmove="(none)")])
    with MaiaAdapter(command) as maia:
        assert maia.policy(chess.Board(CHECKMATE), multipv=2) == []


def test_a_maia_that_cannot_be_started_is_a_typed_condition(tmp_path: Path) -> None:
    with pytest.raises(HumanModelUnavailableError):
        MaiaAdapter(str(tmp_path / "no-such-lc0"))


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("e2e4  (322 ) N: 0 (+ 0) (P: 34.10%) (Q: 0.11)", ("e2e4", 0.341)),
        ("e7e8q (99 ) N: 0 (+ 0) (P:  1.00%)", ("e7e8q", 0.01)),
        ("node (--- ) N: 1 (+ 0)", None),
        ("some other engine chatter", None),
    ],
)
def test_only_a_verbose_move_stats_line_yields_a_probability(
    text: str, expected: tuple[str, float] | None
) -> None:
    assert policy_probability({"string": text}) == expected


def test_a_policy_move_leaves_out_what_the_engine_did_not_say() -> None:
    assert PolicyMove(rank=1, uci="e2e4", san="e4").as_dict() == {
        "uci": "e2e4",
        "san": "e4",
        "rank": 1,
    }

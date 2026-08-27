"""The runner wire: what a frame has to carry, and payloads that survive the round trip."""

from __future__ import annotations

from typing import Any

import pytest

from backend.db.enums import Classification, Color, Tier
from backend.db.models import MoveEval
from backend.runners import protocol
from backend.runners.protocol import EngineAd, ProtocolError
from backend.services.analysis import RunPlan, Thresholds

THRESHOLDS = Thresholds(inaccuracy=10.0, mistake=20.0, blunder=30.0)
CHESS960_FEN = "bqnbrkrn/pppppppp/8/8/8/8/PPPPPPPP/BQNBRKRN w KQkq -"

STOCKFISH_OPTION = {
    "name": "Threads",
    "type": "spin",
    "default": 1,
    "min": 1,
    "max": 128,
    "var": [],
    "managed": False,
}


def _game_plan(**changes: Any) -> RunPlan:
    defaults: dict[str, Any] = {
        "run_id": 12,
        "tier": Tier.QUICK,
        "game_id": 5,
        "fen": None,
        "variant": "standard",
        "initial_fen": None,
        "moves_uci": ("e2e4", "e7e5"),
        "moves_san": ("e4", None),
        "position_ids": (1, 2, None),
        "ply_start": 0,
        "ply_end": 2,
        "nodes": 250_000,
        "depth": None,
        "multipv": 1,
        "thresholds": THRESHOLDS,
        "owner_color": Color.WHITE,
        "owner_rating": 1712,
    }
    return RunPlan(**{**defaults, **changes})


def _eval_row(**changes: Any) -> MoveEval:
    defaults: dict[str, Any] = {
        "ply": 3,
        "position_id": 7,
        "move_uci": "e2e4",
        "move_san": "e4",
        "eval_before_cp": 100,
        "eval_before_mate": None,
        "eval_after_cp": -300,
        "eval_after_mate": None,
        "win_before": 59.1,
        "win_after": 24.89,
        "win_loss": 34.21,
        "classification": Classification.BLUNDER,
        "best_move_uci": "d2d4",
        "best_lines": [{"multipv": 1, "cp": 100, "mate": None, "pv": ["d2d4", "d7d5"]}],
        "maia_policy": {"1600": [{"uci": "e2e4", "p": 0.31}]},
    }
    return MoveEval(**{**defaults, **changes})


# --- framing --------------------------------------------------------------


def test_a_frame_survives_the_wire() -> None:
    frame = protocol.run_cancel(run_id=12, reason="requeued")

    assert protocol.decode(protocol.encode(frame)) == frame


def test_frames_go_out_without_whitespace_to_pay_for() -> None:
    assert protocol.encode({"type": "pong", "t": 1.0}) == '{"type":"pong","t":1.0}'


@pytest.mark.parametrize("text", ["", "not json", "[1, 2]", '"hello"', "null"])
def test_anything_that_is_not_an_object_is_refused(text: str) -> None:
    with pytest.raises(ProtocolError):
        protocol.decode(text)


def test_a_frame_without_a_type_is_refused() -> None:
    with pytest.raises(ProtocolError, match="no type"):
        protocol.message_type({"run_id": 3})


def test_a_type_nobody_defines_is_refused() -> None:
    with pytest.raises(ProtocolError, match="not a message"):
        protocol.validate({"type": "run_teleport", "run_id": 3})


def test_a_frame_missing_a_required_field_is_refused() -> None:
    with pytest.raises(ProtocolError, match="attempt_token"):
        protocol.validate({"type": protocol.RUN_COMPLETE, "run_id": 3, "evals": []})


def test_a_field_a_newer_peer_added_is_carried_not_refused() -> None:
    frame = protocol.validate(
        {"type": protocol.RUN_CANCELLED, "run_id": 3, "elapsed_ms": 12, "future": "field"}
    )

    assert frame["future"] == "field"


def test_every_builder_produces_a_frame_that_validates() -> None:
    frames = [
        protocol.hello(runner="gpu-box", version="0.1.0", slots=4),
        protocol.welcome(runner_id=3, runner="gpu-box", slots=4),
        protocol.advertise_engines([]),
        protocol.engines_accepted([protocol.accepted_engine("sf-remote", 7, True)]),
        protocol.ping(1.0),
        protocol.pong(1.0),
        protocol.error(protocol.ERROR_PROTO_MISMATCH, "no", fatal=True),
        protocol.run_dispatch(run_id=1, attempt_token="9f", engine="sf", plan={"run_id": 1}),
        protocol.run_progress(run_id=1, attempt_token="9f", done=1, total=2),
        protocol.run_complete(run_id=1, attempt_token="9f", evals=[]),
        protocol.run_failed(run_id=1, attempt_token="9f", error="boom"),
        protocol.run_ack(run_id=1, accepted=False, reason=protocol.ERROR_STALE_RESULT),
        protocol.run_cancel(run_id=1, reason="stolen"),
        protocol.run_cancelled(run_id=1),
        protocol.stream_open(session_id="str_1", engine="sf", fen=CHESS960_FEN),
        protocol.stream_started(session_id="str_1", engine="sf"),
        protocol.snapshot_frame("str_1", 7, depth=24, lines=[{"multipv": 1, "cp": 34}]),
        protocol.stream_restart(session_id="str_1", fen=CHESS960_FEN),
        protocol.stream_close(session_id="str_1"),
        protocol.stream_closed(session_id="str_1", reason="engine_failed", error="died"),
    ]

    for frame in frames:
        assert protocol.validate(protocol.decode(protocol.encode(frame))) == frame
    assert {protocol.message_type(frame) for frame in frames} == set(protocol.REQUIRED)


def test_the_handshake_states_the_protocol_version() -> None:
    assert protocol.hello(runner="gpu-box")["proto"] == protocol.PROTO_VERSION
    assert protocol.welcome(runner_id=1, runner="gpu-box")["proto"] == protocol.PROTO_VERSION


def test_a_snapshot_carries_lines_in_the_shape_the_database_stores() -> None:
    frame = protocol.snapshot_frame(
        "str_7f3c9a12",
        7,
        depth=24,
        nodes=18_402_113,
        nps=1_840_211,
        time_ms=10_000,
        lines=[{"multipv": 1, "cp": 34, "mate": None, "pv": ["e2e4", "e7e5"]}],
    )

    assert frame["seq"] == 7
    assert frame["lines"] == [{"multipv": 1, "cp": 34, "mate": None, "pv": ["e2e4", "e7e5"]}]


# --- the run plan ---------------------------------------------------------


@pytest.mark.parametrize(
    "plan",
    [
        _game_plan(),
        _game_plan(
            game_id=None,
            fen=CHESS960_FEN,
            initial_fen=CHESS960_FEN,
            moves_uci=(),
            moves_san=(),
            position_ids=(None,),
            owner_color=None,
            owner_rating=None,
        ),
        _game_plan(
            tier=Tier.DEEP,
            variant="chess960",
            initial_fen=CHESS960_FEN,
            depth=22,
            multipv=4,
            owner_color=Color.BLACK,
        ),
        _game_plan(maia_target_elo=1700),
    ],
    ids=["a game", "a bare fen", "chess960", "a maia target elo"],
)
def test_a_plan_comes_back_the_plan_it_was(plan: RunPlan) -> None:
    assert protocol.decode_plan(protocol.encode_plan(plan)) == plan


def test_a_target_elo_crosses_the_wire_so_a_runner_computes_the_same_levels() -> None:
    """A remote pass has to ask the same levels about the same plies as a local one."""
    encoded = protocol.decode(
        protocol.encode(protocol.encode_plan(_game_plan(maia_target_elo=1700)))
    )

    assert encoded["maia_target_elo"] == 1700
    assert protocol.decode_plan(encoded).maia_plies() == [0, 1]


def test_a_plan_from_a_runner_that_predates_the_target_elo_has_none() -> None:
    older = protocol.encode_plan(_game_plan())
    del older["maia_target_elo"]

    assert protocol.decode_plan(older).maia_target_elo is None


def test_a_plan_crosses_the_wire_as_json_the_runner_can_read() -> None:
    encoded = protocol.decode(protocol.encode(protocol.encode_plan(_game_plan())))

    assert encoded["tier"] == "quick"
    assert encoded["owner_color"] == "white"
    assert encoded["thresholds"] == {"inaccuracy": 10.0, "mistake": 20.0, "blunder": 30.0}
    # A null in here means "that ply's position is not stored", which is not the same as
    # an absent entry: the list is indexed by ply.
    assert encoded["position_ids"] == [1, 2, None]
    assert protocol.decode_plan(encoded) == _game_plan()


def test_a_plan_that_does_not_decode_says_so() -> None:
    broken = protocol.encode_plan(_game_plan())
    del broken["thresholds"]

    with pytest.raises(ProtocolError, match="thresholds"):
        protocol.decode_plan(broken)


def test_a_plan_with_a_tier_nobody_has_is_refused() -> None:
    broken = protocol.encode_plan(_game_plan())
    broken["tier"] = "instant"

    with pytest.raises(ProtocolError):
        protocol.decode_plan(broken)


# --- the evaluations ------------------------------------------------------


def test_an_evaluation_comes_back_column_for_column() -> None:
    row = _eval_row()

    back = protocol.decode_eval(protocol.decode(protocol.encode(protocol.encode_eval(row))))

    for name in (*protocol.EVAL_FIELDS, "classification"):
        assert getattr(back, name) == getattr(row, name), name
    assert back.classification is Classification.BLUNDER


def test_an_evaluation_arrives_unattached_to_any_run() -> None:
    """`run_id` is assigned by `complete_run`, which is what keeps a replayed payload from
    writing itself onto somebody else's run."""
    payload = protocol.encode_eval(_eval_row())

    assert "run_id" not in payload
    assert "id" not in payload
    assert protocol.decode_eval(payload).run_id is None


def test_a_position_run_has_no_move_to_judge() -> None:
    row = _eval_row(
        move_uci=None,
        move_san=None,
        eval_after_cp=None,
        win_after=None,
        win_loss=None,
        classification=None,
        maia_policy=None,
    )

    back = protocol.decode_eval(protocol.encode_eval(row))

    assert (back.move_uci, back.classification, back.maia_policy) == (None, None, None)


def test_a_list_of_evaluations_round_trips() -> None:
    rows = [_eval_row(ply=ply) for ply in range(3)]

    back = protocol.decode_evals(protocol.encode_evals(rows))

    assert [row.ply for row in back] == [0, 1, 2]


def test_an_evaluation_with_a_classification_nobody_has_is_refused() -> None:
    payload = protocol.encode_eval(_eval_row())
    payload["classification"] = "catastrophe"

    with pytest.raises(ProtocolError, match="classification"):
        protocol.decode_eval(payload)


def test_an_evaluation_without_a_ply_is_refused() -> None:
    payload = protocol.encode_eval(_eval_row())
    del payload["ply"]

    with pytest.raises(ProtocolError, match="ply"):
        protocol.decode_eval(payload)


def test_evaluations_arrive_as_a_list() -> None:
    with pytest.raises(ProtocolError, match="list"):
        protocol.decode_evals({"ply": 0})  # type: ignore[arg-type]


# --- engine advertisements ------------------------------------------------


def test_an_advertisement_round_trips() -> None:
    ad = EngineAd.from_dict(
        {
            "name": "sf-remote",
            "kind": "uci",
            "path": "/usr/games/stockfish",
            "version": "Stockfish 17",
            "tier": "deep",
            "options": {"Threads": 8},
            "declared_options": [STOCKFISH_OPTION],
            "streams": True,
        }
    )

    assert EngineAd.from_dict(protocol.decode(protocol.encode(ad.as_dict()))) == ad
    assert ad.probe().option("Threads") is not None


def test_a_plain_advertisement_streams_and_a_maia_one_does_not() -> None:
    uci = EngineAd.from_dict({"name": "sf", "path": "/usr/games/stockfish"})
    maia = EngineAd.from_dict({"name": "maia", "kind": "maia", "path": "lc0 --weights=w"})

    assert (uci.kind, uci.streams) == ("uci", True)
    assert maia.streams is False


@pytest.mark.parametrize(
    ("data", "match"),
    [
        ({"path": "/usr/games/stockfish"}, "needs a name"),
        ({"name": "  ", "path": "/x"}, "needs a name"),
        ({"name": "sf"}, "no path"),
        ({"name": "sf", "path": "/x", "kind": "neural"}, "not an engine kind"),
        ({"name": "sf", "path": "/x", "tier": "instant"}, "not a tier"),
        ({"name": "sf", "path": "/x", "options": [1]}, "not an object"),
        ({"name": "sf", "path": "/x", "declared_options": "Threads"}, "not a list"),
        ({"name": "sf", "path": "/x", "declared_options": ["Threads"]}, "not an object"),
    ],
)
def test_an_advertisement_that_does_not_hold_up_is_refused(
    data: dict[str, Any], match: str
) -> None:
    with pytest.raises(ProtocolError, match=match):
        EngineAd.from_dict(data)


def test_advertisements_arrive_as_a_list() -> None:
    with pytest.raises(ProtocolError, match="list"):
        protocol.decode_ads({"name": "sf"})  # type: ignore[arg-type]


# --- what an engine declares ----------------------------------------------


def test_a_probe_round_trips_through_the_advertisement() -> None:
    probe = protocol.decode_probe("Stockfish 17", "the team", [STOCKFISH_OPTION])

    assert protocol.encode_probe(probe) == [STOCKFISH_OPTION]
    threads = probe.option("threads")
    assert threads is not None
    assert (threads.type, threads.min, threads.max) == ("spin", 1, 128)


def test_a_declared_option_without_a_name_is_refused() -> None:
    with pytest.raises(ProtocolError, match="needs a name"):
        protocol.decode_probe(None, None, [{"type": "spin"}])

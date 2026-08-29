"""Live Maia: one warm session behind `POST /maia/policy`, driven against a real process.

The scripted engine of `fake_uci.py` is a subprocess like any other, so "the session stays
warm" is checked the only honest way — by counting the pids that ever answered.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fake_uci import MAIA_OPTIONS, commands, fake_engine_command, option, read_log
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.api.app import create_app
from backend.config import MAIA_MAX_RATING, Settings
from backend.db.enums import EngineKind
from backend.db.migrate import upgrade_to_head
from backend.db.models import Engine, Runner
from backend.db.session import get_sessionmaker
from backend.services import app_settings, maia_live
from backend.services import engines as engines_service
from backend.services.maia_live import (
    LiveMaia,
    LiveMaiaUnavailableError,
    LivePolicyRequestError,
)
from tests.conftest import running_app

STARTING = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
MATE_IN_ONE = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"


def reply(*entries: tuple[str, float]) -> dict[str, Any]:
    """One `go` reply: a verbose policy line and a multipv line per move, in order."""
    info = [
        f"string {uci}  (322 ) N:       0 (+ 0) (P: {share:.2f}%) (Q:  0.11)"
        for uci, share in entries
    ]
    info += [
        f"depth 1 multipv {rank} score cp 20 pv {uci}" for rank, (uci, _) in enumerate(entries, 1)
    ]
    return {"info": info, "bestmove": entries[0][0]}


# e4 d4 for the position itself, then one reply per rollout ply of the Italian.
OPENING = [
    reply(("e2e4", 41.0), ("d2d4", 21.5)),
    reply(("e2e4", 41.0)),
    reply(("e7e5", 38.0)),
    reply(("g1f3", 30.0)),
]


def maia_command(
    tmp_path: Path,
    *,
    go: list[dict[str, Any]] | None = None,
    options: list[dict[str, Any]] | None = None,
    log: Path | None = None,
    name: str = "lc0 maia-1700",
) -> str:
    return fake_engine_command(
        tmp_path,
        name=name,
        options=MAIA_OPTIONS if options is None else options,
        go=list(go or OPENING),
        go_default=reply(("e2e4", 41.0)),
        log=None if log is None else str(log),
    )


def fixed_weights() -> list[dict[str, Any]]:
    """A classic `maia-1500.pb.gz` build: it *is* its rating and declares no `SelfElo`."""
    return [
        option("MultiPV", "spin", default=1, min=1, max=10),
        option("VerboseMoveStats", "check", default=False),
    ]


def register_maia(
    session: Session, path: str, *, runner_id: int | None = None, name: str | None = None
) -> Engine:
    engine = Engine(
        name=name or ("maia" if runner_id is None else "maia-remote"),
        kind=EngineKind.MAIA,
        path=path,
        options={},
        enabled=True,
        runner_id=runner_id,
    )
    session.add(engine)
    session.commit()
    # The human-move role, as `add_engine` would have filled it: nothing resolves a Maia
    # any more except the assignment.
    engines_service.assign_default_roles(session, engine)
    return engine


@pytest.fixture(autouse=True)
def no_warm_session() -> Iterator[None]:
    """The warm session is process-wide, so no test inherits the one before it."""
    maia_live.shutdown()
    yield
    maia_live.shutdown()


@pytest.fixture()
def live() -> Iterator[LiveMaia]:
    session = LiveMaia()
    yield session
    session.shutdown()


# --- the policy and the rollout -------------------------------------------


def test_a_position_answers_with_its_policy_and_the_line_two_humans_would_play(
    session: Session, tmp_path: Path, live: LiveMaia
) -> None:
    register_maia(session, maia_command(tmp_path))

    answer = live.policy(session, fen=STARTING, elo=1700, moves=2, rollout_plies=3)

    assert answer["elo"] == 1700
    assert answer["policy"] == [
        {"uci": "e2e4", "san": "e4", "rank": 1, "p": 0.41},
        {"uci": "d2d4", "san": "d4", "rank": 2, "p": 0.215},
    ]
    assert answer["rollout"] == [
        {"uci": "e2e4", "san": "e4", "p": 0.41},
        {"uci": "e7e5", "san": "e5", "p": 0.38},
        {"uci": "g1f3", "san": "Nf3", "p": 0.3},
    ]


def test_no_rollout_is_asked_for_and_none_is_computed(
    session: Session, tmp_path: Path, live: LiveMaia
) -> None:
    log = tmp_path / "engine.log"
    register_maia(session, maia_command(tmp_path, log=log))

    answer = live.policy(session, fen=STARTING, elo=1700, moves=2)

    assert answer["rollout"] == []
    assert len(commands(log, "go nodes")) == 1


def test_the_rollout_stops_where_the_game_does(
    session: Session, tmp_path: Path, live: LiveMaia
) -> None:
    """A line that ends in mate is shorter than the plies asked for, never padded."""
    log = tmp_path / "engine.log"
    register_maia(
        session,
        maia_command(tmp_path, go=[reply(("a1a8", 62.0)), reply(("a1a8", 62.0))], log=log),
    )

    answer = live.policy(session, fen=MATE_IN_ONE, elo=1700, moves=1, rollout_plies=4)

    assert answer["rollout"] == [{"uci": "a1a8", "san": "Ra8#", "p": 0.62}]
    # One query for the position, one for the first rollout ply, and then nothing left
    # to ask: the position after Ra8# is a finished game.
    assert len(commands(log, "go nodes")) == 2


def test_a_build_that_publishes_no_probability_is_reported_without_one(
    session: Session, tmp_path: Path, live: LiveMaia
) -> None:
    bare = {"info": ["depth 1 multipv 1 score cp 20 pv e2e4"], "bestmove": "e2e4"}
    register_maia(session, maia_command(tmp_path, go=[bare, bare]))

    answer = live.policy(session, fen=STARTING, elo=1700, moves=1, rollout_plies=1)

    assert answer["policy"] == [{"uci": "e2e4", "san": "e4", "rank": 1}]
    assert answer["rollout"] == [{"uci": "e2e4", "san": "e4"}]


# --- the warm session ------------------------------------------------------


def test_the_second_query_reaches_the_process_the_first_one_started(
    session: Session, tmp_path: Path, live: LiveMaia
) -> None:
    log = tmp_path / "engine.log"
    register_maia(session, maia_command(tmp_path, log=log))

    live.policy(session, fen=STARTING, elo=1700, moves=2)
    live.policy(session, fen=STARTING, elo=1700, moves=2)

    assert live.is_open is True
    assert len({entry["pid"] for entry in read_log(log)}) == 1


def test_an_idle_session_gives_its_process_back(session: Session, tmp_path: Path) -> None:
    idle = LiveMaia(idle_seconds=0.05)
    register_maia(session, maia_command(tmp_path))
    try:
        idle.policy(session, fen=STARTING, elo=1700, moves=2)
        assert idle.is_open is True

        deadline = time.monotonic() + 5.0
        while idle.is_open and time.monotonic() < deadline:
            time.sleep(0.02)
        assert idle.is_open is False
    finally:
        idle.shutdown()


def test_closing_an_idle_session_says_whether_there_was_one(
    session: Session, tmp_path: Path, live: LiveMaia
) -> None:
    register_maia(session, maia_command(tmp_path))

    assert live.close_if_idle() is False
    live.policy(session, fen=STARTING, elo=1700, moves=2)
    assert live.close_if_idle() is True
    assert live.is_open is False


def test_a_different_engine_is_a_different_process(
    session: Session, tmp_path: Path, live: LiveMaia
) -> None:
    """Changing the engine in Settings takes effect on the next query, not on a restart."""
    log = tmp_path / "engine.log"
    engine = register_maia(session, maia_command(tmp_path, log=log))
    live.policy(session, fen=STARTING, elo=1700, moves=2)

    engine.path = maia_command(tmp_path, log=log)
    session.commit()
    live.policy(session, fen=STARTING, elo=1700, moves=2)

    assert len({entry["pid"] for entry in read_log(log)}) == 2


# --- the level ------------------------------------------------------------


def test_the_configured_target_is_the_level_when_nobody_asks_for_one(
    session: Session, tmp_path: Path
) -> None:
    log = tmp_path / "engine.log"
    register_maia(session, maia_command(tmp_path, log=log))
    app_settings.set_maia_target_elo(session, 1700)
    live = LiveMaia()
    try:
        answer = live.policy(session, fen=STARTING, moves=2)
    finally:
        live.shutdown()

    assert answer["elo"] == 1700
    assert "setoption name SelfElo value 1700" in commands(log, "setoption")


def test_a_deployment_that_configured_nothing_asks_at_maias_top_level(
    session: Session, tmp_path: Path
) -> None:
    """The board and the stored runs cannot disagree: both are pinned to the same default."""
    register_maia(session, maia_command(tmp_path))
    live = LiveMaia()
    try:
        assert live.policy(session, fen=STARTING, moves=2)["elo"] == MAIA_MAX_RATING
    finally:
        live.shutdown()


def test_an_asked_for_level_wins_over_the_configured_target(
    session: Session, tmp_path: Path
) -> None:
    register_maia(session, maia_command(tmp_path))
    app_settings.set_maia_target_elo(session, 1700)
    live = LiveMaia()
    try:
        assert live.policy(session, fen=STARTING, elo=1200, moves=2)["elo"] == 1200
    finally:
        live.shutdown()


def test_the_level_reported_is_the_one_the_build_could_answer_for(
    session: Session, tmp_path: Path, live: LiveMaia
) -> None:
    narrow = [
        option("MultiPV", "spin", default=1, min=1, max=10),
        option("SelfElo", "spin", default=1200, min=1100, max=1500),
        option("VerboseMoveStats", "check", default=False),
    ]
    register_maia(session, maia_command(tmp_path, options=narrow))

    assert live.policy(session, fen=STARTING, elo=1900, moves=2)["elo"] == 1500


def test_a_fixed_weights_build_answers_without_being_conditioned(
    session: Session, tmp_path: Path, live: LiveMaia
) -> None:
    """It plays as the human its weights are for, whatever level was asked for.

    Echoing 1700 back would label the board with a human a 1500 model never imitated, so
    the level reported is the one written in the weights it loaded — and the request, which
    it never even received as a `setoption`, is dropped.
    """
    log = tmp_path / "engine.log"
    register_maia(
        session,
        maia_command(tmp_path, options=fixed_weights(), log=log, name="lc0"),
        name="maia-1500",
    )

    answer = live.policy(session, fen=STARTING, elo=1700, moves=2)

    assert answer["elo"] == 1500
    assert [entry["uci"] for entry in answer["policy"]] == ["e2e4", "d2d4"]
    assert not [line for line in commands(log, "setoption") if "SelfElo" in line]


def test_a_fixed_weights_build_that_names_no_level_reports_none(
    session: Session, tmp_path: Path, live: LiveMaia
) -> None:
    """Nothing on this host knows what rating those weights are: say so, do not guess."""
    register_maia(
        session,
        maia_command(tmp_path, options=fixed_weights(), name="lc0"),
        name="human-model",
    )

    answer = live.policy(session, fen=STARTING, elo=1700, moves=2)

    assert answer["elo"] is None
    assert [entry["uci"] for entry in answer["policy"]] == ["e2e4", "d2d4"]


def test_the_level_a_fixed_weights_build_reports_can_come_from_its_uci_name(
    session: Session, tmp_path: Path, live: LiveMaia
) -> None:
    register_maia(
        session,
        maia_command(tmp_path, options=fixed_weights(), name="lc0 maia-1100"),
        name="human-model",
    )

    assert live.policy(session, fen=STARTING, elo=1700, moves=2)["elo"] == 1100


# --- several levels at once -----------------------------------------------


def test_every_configured_level_is_answered_in_one_query(session: Session, tmp_path: Path) -> None:
    """The board's question is the comparison, so one call carries every column of it."""
    log = tmp_path / "engine.log"
    register_maia(session, maia_command(tmp_path, log=log))
    app_settings.set_maia_elos(session, [1300, 1900])
    live = LiveMaia()
    try:
        answer = live.policy(session, fen=STARTING, moves=2)
    finally:
        live.shutdown()

    assert sorted(answer["levels"]) == ["1300", "1900"]
    assert answer["levels"]["1300"]["elo"] == 1300
    assert [entry["uci"] for entry in answer["levels"]["1300"]["policy"]] == ["e2e4", "d2d4"]
    assert [entry["uci"] for entry in answer["levels"]["1900"]["policy"]] == ["e2e4"]
    # The top of the answer is the first level, which is the shape a single-level board read.
    assert answer["elo"] == 1300
    assert answer["policy"] == answer["levels"]["1300"]["policy"]
    # One process, conditioned once per level rather than started once per level.
    conditioned = commands(log, "setoption")
    assert "setoption name SelfElo value 1300" in conditioned
    assert "setoption name SelfElo value 1900" in conditioned
    assert len({entry["pid"] for entry in read_log(log)}) == 1


def test_the_levels_a_caller_names_win_over_the_configured_ones(
    session: Session, tmp_path: Path, live: LiveMaia
) -> None:
    register_maia(session, maia_command(tmp_path))
    app_settings.set_maia_elos(session, [1500, 1900])

    answer = live.policy(session, fen=STARTING, elos=[1200], moves=1)

    assert sorted(answer["levels"]) == ["1200"]
    assert answer["elo"] == 1200


def test_every_level_gets_its_own_rollout(session: Session, tmp_path: Path) -> None:
    """A rollout is a line two humans play, so it is per level rather than shared."""
    # Two levels, each asked about the position and then about the two rollout plies: the
    # same three replies twice over, all of them legal wherever the line has got to.
    register_maia(session, maia_command(tmp_path, go=[*OPENING[:3], *OPENING[:3]]))
    app_settings.set_maia_elos(session, [1500, 1900])
    live = LiveMaia()
    try:
        answer = live.policy(session, fen=STARTING, moves=2, rollout_plies=2)
    finally:
        live.shutdown()

    assert [step["san"] for step in answer["levels"]["1500"]["rollout"]] == ["e4", "e5"]
    assert [step["san"] for step in answer["levels"]["1900"]["rollout"]] == ["e4", "e5"]
    assert answer["rollout"] == answer["levels"]["1500"]["rollout"]


def test_a_fixed_weights_build_answers_once_however_many_levels_are_asked_for(
    session: Session, tmp_path: Path
) -> None:
    """It is one rating: five identical columns would invent a comparison."""
    register_maia(
        session,
        maia_command(tmp_path, options=fixed_weights(), name="lc0"),
        name="maia-1500",
    )
    app_settings.set_maia_elos(session, [1100, 1900])
    live = LiveMaia()
    try:
        answer = live.policy(session, fen=STARTING, moves=2)
    finally:
        live.shutdown()

    # Keyed by the level its weights name, not by either level that was asked for.
    assert sorted(answer["levels"]) == ["1500"]
    assert answer["elo"] == 1500


# --- when there is nothing to ask -----------------------------------------


def test_a_maia_that_lives_on_a_runner_is_not_one_this_board_can_ask(
    session: Session, tmp_path: Path, live: LiveMaia
) -> None:
    runner = Runner(name="gpu-box", token_hash="x", slots=1)
    session.add(runner)
    session.commit()
    register_maia(session, "/opt/lc0", runner_id=runner.id)

    with pytest.raises(LiveMaiaUnavailableError) as raised:
        live.policy(session, fen=STARTING)

    assert "'maia-remote'" in str(raised.value)
    assert "runner 'gpu-box'" in str(raised.value)


def test_no_human_move_model_at_all_says_so(session: Session, live: LiveMaia) -> None:
    with pytest.raises(LiveMaiaUnavailableError, match="no human-move model"):
        live.policy(session, fen=STARTING)


def test_a_maia_that_is_switched_off_is_not_available(
    session: Session, tmp_path: Path, live: LiveMaia
) -> None:
    engine = register_maia(session, maia_command(tmp_path))
    engine.enabled = False
    session.commit()

    with pytest.raises(LiveMaiaUnavailableError):
        live.policy(session, fen=STARTING)


def test_a_maia_that_will_not_start_is_reported_rather_than_crashing(
    session: Session, tmp_path: Path, live: LiveMaia
) -> None:
    register_maia(session, str(tmp_path / "no-such-lc0"))

    with pytest.raises(LiveMaiaUnavailableError, match="could not be started"):
        live.policy(session, fen=STARTING)
    assert live.is_open is False


def test_a_fen_that_is_not_a_position_is_the_callers_mistake(
    session: Session, tmp_path: Path, live: LiveMaia
) -> None:
    register_maia(session, maia_command(tmp_path))

    with pytest.raises(LivePolicyRequestError, match="not a valid FEN"):
        live.policy(session, fen="not a position")


# --- the endpoint ----------------------------------------------------------


def _seed(settings: Settings, path: str | None, *, target_elo: int | None = None) -> None:
    upgrade_to_head(settings)
    with get_sessionmaker(settings)() as session:
        if target_elo is not None:
            app_settings.set_maia_target_elo(session, target_elo)
        if path is not None:
            register_maia(session, path)


@pytest.fixture()
def api(settings: Settings, tmp_path: Path) -> Iterator[TestClient]:
    settings.analysis_workers = False
    _seed(settings, maia_command(tmp_path), target_elo=1700)
    with running_app(create_app(settings)) as client:
        yield client


def test_the_endpoint_answers_the_shape_the_board_builds_against(api: TestClient) -> None:
    response = api.post(
        "/api/maia/policy",
        json={"fen": STARTING, "moves": 2, "rollout_plies": 3},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["elo"] == 1700
    assert [entry["san"] for entry in body["policy"]] == ["e4", "d4"]
    assert [entry["rank"] for entry in body["policy"]] == [1, 2]
    assert body["policy"][0]["p"] == 0.41
    assert [entry["san"] for entry in body["rollout"]] == ["e4", "e5", "Nf3"]


def test_the_endpoint_carries_a_level_per_configured_elo(
    settings: Settings, tmp_path: Path
) -> None:
    """What the game panel's compare grid reads: one entry per level, keyed by it."""
    settings.analysis_workers = False
    upgrade_to_head(settings)
    with get_sessionmaker(settings)() as session:
        app_settings.set_maia_elos(session, [1500, 1900])
        register_maia(session, maia_command(tmp_path))
    with running_app(create_app(settings)) as client:
        body = client.post("/api/maia/policy", json={"fen": STARTING, "moves": 2}).json()

    assert sorted(body["levels"]) == ["1500", "1900"]
    assert [entry["san"] for entry in body["levels"]["1500"]["policy"]] == ["e4", "d4"]
    assert body["levels"]["1900"]["elo"] == 1900
    assert body["elo"] == 1500


def test_the_endpoint_takes_the_levels_the_board_asks_for(api: TestClient) -> None:
    body = api.post(
        "/api/maia/policy", json={"fen": STARTING, "elos": [1300, 1300, 1700], "moves": 1}
    ).json()

    assert sorted(body["levels"]) == ["1300", "1700"]


def test_the_bare_router_path_answers_too(api: TestClient) -> None:
    assert api.post("/maia/policy", json={"fen": STARTING, "moves": 1}).status_code == 200


def test_a_fen_that_is_not_a_position_is_a_422(api: TestClient) -> None:
    response = api.post("/api/maia/policy", json={"fen": "8/8/8/8"})

    assert response.status_code == 422
    assert response.json()["error"] == "invalid_request"


def test_a_body_with_no_fen_is_a_422(api: TestClient) -> None:
    assert api.post("/api/maia/policy", json={"moves": 3}).status_code == 422


def test_a_field_nobody_declared_is_a_422(api: TestClient) -> None:
    response = api.post("/api/maia/policy", json={"fen": STARTING, "level": 1700})

    assert response.status_code == 422


@pytest.fixture()
def api_without_maia(settings: Settings) -> Iterator[TestClient]:
    settings.analysis_workers = False
    _seed(settings, None)
    with running_app(create_app(settings)) as client:
        yield client


def test_no_local_maia_is_a_409_the_board_can_hide_itself_on(
    api_without_maia: TestClient,
) -> None:
    response = api_without_maia.post("/api/maia/policy", json={"fen": STARTING})

    assert response.status_code == 409
    body = response.json()
    assert body["error"] == "maia_unavailable"
    assert "no human-move model" in body["detail"]

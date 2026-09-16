"""Practice replies: who can be played, and what they play, on this host and on a runner.

The local half drives a scripted UCI process, so the assertions are about what really went
down the pipe — the rating as `setoption`, the think time as `go movetime` — rather than
about a fake that agrees with the code. The remote half goes down the real socket to
`tests/fake_runner.py`, which answers the `move_request` the way a runner would.
"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.adapters.stockfish import EngineProbe, UciOption
from backend.api.app import create_app
from backend.config import Settings
from backend.db.enums import EngineKind
from backend.runners import protocol
from backend.services import engines as engines_service
from backend.services import practice as practice_service
from backend.workers.practice_moves import RemoteMoveBackend
from tests.conftest import running_app
from tests.fake_runner import STOCKFISH_AD, connect
from tests.fake_uci import STOCKFISH_OPTIONS, commands, fake_engine_command
from tests.test_runner_gateway import register

STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
MATED_FEN = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3"

STRENGTH_OPTIONS = [
    *STOCKFISH_OPTIONS,
    {"name": "UCI_LimitStrength", "type": "check", "default": False},
    {"name": "UCI_Elo", "type": "spin", "default": 1320, "min": 1320, "max": 3190},
]


@pytest.fixture()
def api(settings: Settings) -> Iterator[TestClient]:
    settings.analysis_workers = False
    settings.runner_heartbeat_seconds = 60.0
    settings.runner_stale_sweep_seconds = 60.0
    with running_app(create_app(settings)) as client:
        yield client


def local_engine(
    api: TestClient, tmp_path: Path, *, name: str = "fakefish", options: Any = None, **scenario: Any
) -> int:
    path = fake_engine_command(
        tmp_path, name="FakeFish 1", options=options or STRENGTH_OPTIONS, **scenario
    )
    created = api.post("/engines", json={"name": name, "path": path})
    assert created.status_code == 201, created.text
    return int(created.json()["id"])


# --- reading what an engine declares ---------------------------------------------


def test_a_rating_is_offered_only_where_the_engine_declares_both_options() -> None:
    strength = practice_service.strength_of(STRENGTH_OPTIONS)
    assert strength is not None
    assert strength.as_dict() == {"min": 1320, "max": 3190, "default": 1320}
    assert strength.options(900) == {"UCI_LimitStrength": True, "UCI_Elo": 1320}
    assert strength.options(5000) == {"UCI_LimitStrength": True, "UCI_Elo": 3190}

    assert practice_service.strength_of(STOCKFISH_OPTIONS) is None
    only_elo = [entry for entry in STRENGTH_OPTIONS if entry["name"] != "UCI_LimitStrength"]
    assert practice_service.strength_of(only_elo) is None
    unbounded = [
        {"name": "UCI_LimitStrength", "type": "check"},
        {"name": "UCI_Elo", "type": "spin", "default": 1500},
    ]
    assert practice_service.strength_of(unbounded) is None
    assert practice_service.strength_of(None) is None


def test_an_engine_keeps_what_it_declared_and_an_old_row_is_probed_once(
    session: Session,
) -> None:
    calls: list[str] = []

    def probe(path: str, *, timeout: float) -> EngineProbe:
        calls.append(path)
        return EngineProbe(
            name="Pretend 1",
            options=(
                UciOption("UCI_LimitStrength", "check", False),
                UciOption("UCI_Elo", "spin", 1320, 1320, 3190),
            ),
        )

    engine = engines_service.add_engine(session, "pretend", "/bin/pretend", probe=probe)
    assert [entry["name"] for entry in engine.declared_options or []] == [
        "UCI_LimitStrength",
        "UCI_Elo",
    ]

    engine.declared_options = None  # a row written before the column existed
    session.commit()
    first = engines_service.declared_options(session, engine, probe=probe)
    again = engines_service.declared_options(session, engine, probe=probe)
    assert first == again
    assert len(calls) == 2, "probed at registration and once more to fill the old row"


# --- a reply on this host -----------------------------------------------------------


def test_a_local_engine_plays_at_the_rating_it_was_given(api: TestClient, tmp_path: Path) -> None:
    log = tmp_path / "commands.jsonl"
    engine_id = local_engine(api, tmp_path, log=str(log))

    offered = api.get("/practice/opponents")
    assert offered.status_code == 200, offered.text
    body = offered.json()
    (entry,) = body["engines"]
    assert entry["engine_id"] == engine_id
    assert entry["available"] is True
    assert entry["strength"] == {"min": 1320, "max": 3190, "default": 1320}
    assert body["default_engine_id"] == engine_id
    assert body["maia"]["available"] is False

    answered = api.post(
        "/practice/move",
        json={"fen": STARTING_FEN, "engine_id": engine_id, "elo": 1500, "movetime_ms": 300},
    )
    assert answered.status_code == 200, answered.text
    move = answered.json()
    assert (move["uci"], move["san"], move["elo"]) == ("e2e4", "e4", 1500)

    sent = commands(log)
    assert "setoption name UCI_LimitStrength value true" in sent
    assert "setoption name UCI_Elo value 1500" in sent
    assert any(command.startswith("go movetime 300") for command in commands(log, "go "))


def test_full_strength_sets_no_rating(api: TestClient, tmp_path: Path) -> None:
    log = tmp_path / "commands.jsonl"
    engine_id = local_engine(api, tmp_path, log=str(log))

    answered = api.post("/practice/move", json={"fen": STARTING_FEN, "engine_id": engine_id})
    assert answered.status_code == 200, answered.text
    assert answered.json()["elo"] is None
    assert not [command for command in commands(log) if "UCI_Elo" in command]


def test_a_rating_for_an_engine_that_declares_none_is_refused(
    api: TestClient, tmp_path: Path
) -> None:
    engine_id = local_engine(api, tmp_path, options=STOCKFISH_OPTIONS)
    (entry,) = api.get("/practice/opponents").json()["engines"]
    assert entry["strength"] is None

    refused = api.post(
        "/practice/move", json={"fen": STARTING_FEN, "engine_id": engine_id, "elo": 1500}
    )
    assert refused.status_code == 422, refused.text
    assert "UCI_Elo" in refused.json()["detail"]


def test_a_finished_game_and_a_bad_position_are_refused(api: TestClient, tmp_path: Path) -> None:
    engine_id = local_engine(api, tmp_path)
    over = api.post("/practice/move", json={"fen": MATED_FEN, "engine_id": engine_id})
    assert over.status_code == 422, over.text
    nonsense = api.post("/practice/move", json={"fen": "not a position", "engine_id": engine_id})
    assert nonsense.status_code == 422, nonsense.text


def test_an_engine_that_answers_an_illegal_move_is_a_sentence(
    api: TestClient, tmp_path: Path
) -> None:
    engine_id = local_engine(
        api, tmp_path, go_default={"info": ["depth 1 score cp 0 pv e2e5"], "bestmove": "e2e5"}
    )
    refused = api.post("/practice/move", json={"fen": STARTING_FEN, "engine_id": engine_id})
    assert refused.status_code == 409, refused.text
    assert refused.json()["error"] == "practice_unavailable"


# --- a reply on a runner --------------------------------------------------------------


def test_a_runner_answers_a_move_request(api: TestClient, settings: Settings) -> None:
    runner_id, token = register(settings, slots=2)
    advert = {
        **STOCKFISH_AD,
        "declared_options": [*STOCKFISH_AD["declared_options"], *STRENGTH_OPTIONS[-2:]],
    }
    with connect(api, token, engines=[advert]) as runner:
        engine_id = runner.engine_ids["sf-remote"]
        (entry,) = api.get("/practice/opponents").json()["engines"]
        assert (entry["runner_id"], entry["available"]) == (runner_id, True)
        assert entry["strength"]["max"] == 3190

        answer: dict[str, Any] = {}

        def ask() -> None:
            answer["response"] = api.post(
                "/practice/move",
                json={"fen": STARTING_FEN, "engine_id": engine_id, "elo": 2000},
            )

        asking = threading.Thread(target=ask)
        asking.start()
        request = runner.recv(protocol.MOVE_REQUEST)
        assert api.app.state.gateway.state(runner_id).streams == {request["request_id"]}
        runner.send(protocol.move_result(request_id=request["request_id"], uci="g1f3"))
        asking.join(10)

    assert request["engine"] == "sf-remote"
    assert request["movetime_ms"] == 1000
    assert request["options"] == {"UCI_LimitStrength": True, "UCI_Elo": 2000}
    response = answer["response"]
    assert response.status_code == 200, response.text
    assert (response.json()["uci"], response.json()["san"]) == ("g1f3", "Nf3")


def test_a_runner_that_cannot_play_moves_is_named_not_waited_on(
    api: TestClient, settings: Settings
) -> None:
    _runner_id, token = register(settings, slots=2)
    features = [f for f in protocol.FEATURES if f != protocol.FEATURE_PLAY_MOVE]
    with connect(api, token, features=features) as runner:
        engine_id = runner.engine_ids["sf-remote"]
        (entry,) = api.get("/practice/opponents").json()["engines"]
        refused = api.post("/practice/move", json={"fen": STARTING_FEN, "engine_id": engine_id})

    assert entry["available"] is False
    assert "update it" in entry["reason"]
    assert refused.status_code == 409, refused.text


def test_a_runner_that_never_answers_frees_its_slot() -> None:
    class Gateway:
        def __init__(self) -> None:
            self.held: set[str] = set()

        def state(self, runner_id: int) -> Any:
            class State:
                name = "gpu-box"
                transport = "websocket"
                features = frozenset({protocol.FEATURE_PLAY_MOVE})

            return State()

        def reserve_slot(self, runner_id: int, key: str) -> bool:
            self.held.add(key)
            return True

        def release_slot(self, runner_id: int, key: str) -> None:
            self.held.discard(key)

        async def send(self, runner_id: int, frame: Any) -> bool:
            return True

    gateway = Gateway()
    backend = RemoteMoveBackend(gateway, margin=0.05)  # type: ignore[arg-type]
    target = practice_service.Destination(
        engine_id=1, engine="sf", destination=practice_service.REMOTE, runner_id=7, runner="gpu"
    )
    with pytest.raises(practice_service.PracticeUnavailableError, match="in time"):
        asyncio.run(backend.play(target, STARTING_FEN, 100))
    assert gateway.held == set()


def test_the_runner_process_plays_with_the_options_it_was_sent(tmp_path: Path) -> None:
    from backend.runners.client import RunnerClient
    from backend.runners.config import EngineConfig, RunnerConfig

    log = tmp_path / "commands.jsonl"
    path = fake_engine_command(tmp_path, name="FakeFish 1", options=STRENGTH_OPTIONS, log=str(log))
    config = RunnerConfig(
        server="http://example.invalid",
        token="t",
        name="box",
        slots=1,
        engines=(EngineConfig(name="sf", path=path, kind=EngineKind.UCI.value),),
    )
    client = RunnerClient(config)
    sent: list[dict[str, Any]] = []

    async def capture(frame: Any) -> None:
        sent.append(dict(frame))

    client._send_quietly = capture  # type: ignore[method-assign]

    async def scenario() -> None:
        try:
            await client._play_move(
                protocol.move_request(
                    request_id="mv_1",
                    engine="sf",
                    fen=STARTING_FEN,
                    movetime_ms=200,
                    options={"UCI_LimitStrength": True, "UCI_Elo": 1800},
                )
            )
        finally:
            await client.pool.close()

    asyncio.run(scenario())
    assert sent == [protocol.move_result(request_id="mv_1", uci="e2e4")]
    assert "setoption name UCI_Elo value 1800" in commands(log)

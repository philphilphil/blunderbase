"""`blunderbase runners` — register, list and revoke, against a migrated temp database.

The same shape as the accounts CLI's tests: `main` is called with the argv a person would
type, and what is asserted is the database afterwards plus the one or two lines printed.
The create command's output is the only place a token is ever readable, so the test that
parses its yaml back is the test that the flow works at all.
"""

from __future__ import annotations

import pytest
import yaml
from sqlalchemy import select

from backend.cli import build_parser, main
from backend.config import Settings
from backend.db.enums import EngineKind, Tier
from backend.db.models import AnalysisRun, Engine, Runner
from backend.db.session import session_scope
from backend.runners.config import RunnerConfig
from backend.services import runners as runners_service


def yaml_of(output: str) -> dict[str, object]:
    """The runner.yaml out of what `runners create` printed around it."""
    body = output[output.index("# blunderbase runner") :]
    parsed = yaml.safe_load(body)
    assert isinstance(parsed, dict)
    return parsed


def test_runners_list_says_so_when_there_are_none(
    settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["runners", "list"]) == 0
    assert "no runners yet" in capsys.readouterr().out


def test_runners_create_prints_a_token_and_a_yaml_that_loads(
    settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["runners", "create", "gpu-box", "--slots", "4"]) == 0

    output = capsys.readouterr().out
    assert "shown once" in output
    config = RunnerConfig.from_mapping(yaml_of(output), source="runner.yaml")
    assert (config.name, config.slots) == ("gpu-box", 4)
    assert config.token.startswith(runners_service.TOKEN_PREFIX)
    assert config.server == f"http://{settings.host}:{settings.port}"

    with session_scope(settings) as session:
        runner = session.scalars(select(Runner)).one()
        assert (runner.name, runner.slots, runner.connected) == ("gpu-box", 4, False)
        # Only the hash is kept, which is why the yaml above is the one chance to read it.
        assert config.token not in runner.token_hash
        assert runner.token_hash == runners_service.token_hash(config.token)


def test_runners_create_writes_the_server_url_it_is_given(
    settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["runners", "create", "gpu-box", "--server", "https://chess.example.com/"]) == 0

    config = RunnerConfig.from_mapping(yaml_of(capsys.readouterr().out))
    assert config.server == "https://chess.example.com"
    assert config.ws_url == "wss://chess.example.com/runner/ws"


def test_runners_create_refuses_a_name_that_is_already_taken(
    settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["runners", "create", "gpu-box"]) == 0
    capsys.readouterr()

    assert main(["runners", "create", "gpu-box"]) == 1
    assert "already registered" in capsys.readouterr().out
    with session_scope(settings) as session:
        assert len(list(session.scalars(select(Runner)))) == 1


def test_runners_list_names_what_each_one_advertises(
    settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["runners", "create", "gpu-box", "--slots", "4"]) == 0
    with session_scope(settings) as session:
        runner = session.scalars(select(Runner)).one()
        runner.connected = True
        session.add(
            Engine(
                name="sf-remote",
                kind=EngineKind.UCI,
                path="/usr/games/stockfish",
                runner_id=runner.id,
            )
        )
    capsys.readouterr()

    assert main(["runners", "list"]) == 0

    line = capsys.readouterr().out.strip()
    assert line.startswith("gpu-box")
    assert "connected" in line and "4 slot(s)" in line and "sf-remote" in line


def test_runners_revoke_takes_the_runner_and_its_engines_with_it(
    settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["runners", "create", "gpu-box"]) == 0
    with session_scope(settings) as session:
        runner = session.scalars(select(Runner)).one()
        engine = Engine(
            name="sf-remote", kind=EngineKind.UCI, path="/usr/games/stockfish", runner_id=runner.id
        )
        session.add(engine)
        session.flush()
        session.add(AnalysisRun(engine_id=engine.id, tier=Tier.DEEP))
    capsys.readouterr()

    assert main(["runners", "revoke", "gpu-box"]) == 0

    assert "revoked" in capsys.readouterr().out
    with session_scope(settings) as session:
        assert list(session.scalars(select(Runner))) == []
        assert list(session.scalars(select(Engine))) == []
        # The run outlives the engine that was going to do it; the queue is the record.
        assert session.scalars(select(AnalysisRun)).one().engine_id is None


def test_runners_revoke_names_a_runner_it_cannot_find(
    settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["runners", "revoke", "gpu-box"]) == 1
    assert "no runner named 'gpu-box'" in capsys.readouterr().out


def test_runners_create_needs_a_name(settings: Settings) -> None:
    with pytest.raises(SystemExit):
        build_parser(settings).parse_args(["runners", "create"])


def test_a_slot_count_below_one_is_refused_while_parsing(settings: Settings) -> None:
    with pytest.raises(SystemExit):
        build_parser(settings).parse_args(["runners", "create", "gpu-box", "--slots", "0"])

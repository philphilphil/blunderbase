"""`runner.yaml`: what a good one produces, and how a bad one is refused.

Every refusal is asserted on its *message* rather than only its type. The person who wrote
the yaml is usually not the person reading the log, and "engines[1] carries thread, which
an engine does not know" is the difference between a two-minute fix and an afternoon.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from backend.runners.config import (
    CONFIG_ENV,
    EngineConfig,
    Reconnect,
    RunnerConfig,
    RunnerConfigError,
)

FULL = {
    "server": "https://blunderbase.example.com",
    "token": "bb_rnr_kY3",
    "name": "gpu-box",
    "slots": 4,
    "verify_tls": False,
    "poll_seconds": 2.5,
    "log_level": "debug",
    "reconnect": {
        "initial_seconds": 0.5,
        "max_seconds": 30.0,
        "websocket_failures": 2,
        "retry_websocket_seconds": 15.0,
    },
    "engines": [
        {
            "name": "sf-remote",
            "path": "/usr/games/stockfish",
            "tier": "deep",
            "options": {"Threads": 8, "Hash": 4096},
        },
        {"name": "maia-remote", "path": "/usr/games/lc0", "kind": "maia"},
    ],
}

MINIMAL = {"server": "http://127.0.0.1:8765", "token": "bb_rnr_x", "name": "box"}


@pytest.fixture(autouse=True)
def _no_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """The operator's own exported runner variables must not decide what the suite tests."""
    for name in (
        CONFIG_ENV,
        "BLUNDERBASE_RUNNER_SERVER",
        "BLUNDERBASE_RUNNER_TOKEN",
        "BLUNDERBASE_RUNNER_NAME",
        "BLUNDERBASE_RUNNER_SLOTS",
    ):
        monkeypatch.delenv(name, raising=False)


def write(tmp_path: Path, data: object, name: str = "runner.yaml") -> Path:
    path = tmp_path / name
    path.write_text(yaml.safe_dump(data), encoding="utf-8")
    return path


def refusal(data: object, tmp_path: Path) -> str:
    with pytest.raises(RunnerConfigError) as raised:
        RunnerConfig.load(write(tmp_path, data))
    return str(raised.value)


# --- a good file -----------------------------------------------------------


def test_a_full_file_arrives_field_for_field(tmp_path: Path) -> None:
    config = RunnerConfig.load(write(tmp_path, FULL))

    assert config.server == "https://blunderbase.example.com"
    assert (config.token, config.name, config.slots) == ("bb_rnr_kY3", "gpu-box", 4)
    assert (config.verify_tls, config.poll_seconds, config.log_level) == (False, 2.5, "debug")
    assert config.reconnect == Reconnect(
        initial_seconds=0.5,
        max_seconds=30.0,
        websocket_failures=2,
        retry_websocket_seconds=15.0,
    )
    assert config.engines == (
        EngineConfig(
            name="sf-remote",
            path="/usr/games/stockfish",
            kind="uci",
            tier="deep",
            options={"Threads": 8, "Hash": 4096},
        ),
        EngineConfig(name="maia-remote", path="/usr/games/lc0", kind="maia"),
    )


def test_everything_optional_has_a_default(tmp_path: Path) -> None:
    config = RunnerConfig.load(write(tmp_path, MINIMAL))

    assert (config.slots, config.verify_tls, config.poll_seconds) == (1, True, 5.0)
    assert (config.log_level, config.engines) == ("info", ())
    assert config.reconnect == Reconnect()


def test_a_maia_never_streams_and_a_uci_engine_does_unless_it_says_otherwise() -> None:
    uci = EngineConfig(name="sf", path="/sf")
    quiet = EngineConfig(name="sf2", path="/sf", streams=False)
    maia = EngineConfig(name="maia", path="/lc0", kind="maia", streams=True)

    assert (uci.streams_enabled, quiet.streams_enabled, maia.streams_enabled) == (
        True,
        False,
        False,
    )


def test_the_server_url_becomes_a_socket_url_and_keeps_its_prefix() -> None:
    plain = RunnerConfig(server="http://127.0.0.1:8765", token="t", name="box")
    secure = RunnerConfig(server="https://chess.example.com/bb", token="t", name="box")

    assert plain.ws_url == "ws://127.0.0.1:8765/runner/ws"
    assert plain.poll_url == "http://127.0.0.1:8765/runner/poll"
    assert secure.ws_url == "wss://chess.example.com/bb/runner/ws"
    assert secure.poll_url == "https://chess.example.com/bb/runner/poll"
    assert secure.run_url(12, "heartbeat") == (
        "https://chess.example.com/bb/runner/runs/12/heartbeat"
    )


def test_a_trailing_slash_on_the_server_does_not_double_up() -> None:
    config = RunnerConfig.from_mapping({**MINIMAL, "server": "http://127.0.0.1:8765/"})

    assert config.ws_url == "ws://127.0.0.1:8765/runner/ws"


def test_the_maia_named_by_a_dispatch_is_only_a_maia_this_runner_has() -> None:
    config = RunnerConfig.from_mapping(
        {
            **MINIMAL,
            "engines": [
                {"name": "sf", "path": "/sf"},
                {"name": "maia", "path": "/lc0", "kind": "maia"},
            ],
        }
    )

    assert config.maia_named("maia").path == "/lc0"
    assert config.maia_named("sf") is None, "a search engine is not a human-move model"
    assert config.maia_named(None) is None
    assert config.maia_named("nowhere") is None


def test_the_yaml_the_server_hands_over_is_one_this_reads(tmp_path: Path) -> None:
    """`blunderbase runners create` prints a file; the runner has to be able to load it."""
    from backend.db.models import Runner
    from backend.services import runners as runners_service

    row = Runner(id=1, name="gpu-box", token_hash="x", slots=4)
    text = runners_service.config_yaml(row, "bb_rnr_secret", server_url="https://bb.example.com")
    (tmp_path / "runner.yaml").write_text(text, encoding="utf-8")

    config = RunnerConfig.load(tmp_path / "runner.yaml")

    assert (config.server, config.token, config.name, config.slots) == (
        "https://bb.example.com",
        "bb_rnr_secret",
        "gpu-box",
        4,
    )
    assert [engine.name for engine in config.engines] == ["sf-remote"]


# --- refusals ---------------------------------------------------------------


@pytest.mark.parametrize("missing", ["server", "token", "name"])
def test_every_required_field_is_named_when_it_is_absent(missing: str, tmp_path: Path) -> None:
    data = {key: value for key, value in MINIMAL.items() if key != missing}

    message = refusal(data, tmp_path)

    assert f"{missing} is required" in message
    assert "runner.yaml" in message, "the refusal names the file it came from"


def test_a_top_level_key_nobody_knows_is_a_refusal(tmp_path: Path) -> None:
    message = refusal({**MINIMAL, "sockets": 4}, tmp_path)

    assert "sockets is not a runner setting" in message


def test_a_key_an_engine_does_not_know_is_a_refusal(tmp_path: Path) -> None:
    engines = [{"name": "sf", "path": "/sf", "thread": 8}]
    message = refusal({**MINIMAL, "engines": engines}, tmp_path)

    assert "engines[0] carries thread" in message


def test_a_reconnect_key_nobody_knows_is_a_refusal(tmp_path: Path) -> None:
    message = refusal({**MINIMAL, "reconnect": {"initial": 1}}, tmp_path)

    assert "reconnect carries initial" in message


def test_a_server_that_is_not_http_is_a_refusal(tmp_path: Path) -> None:
    assert "server is an http(s) URL" in refusal({**MINIMAL, "server": "ws://x"}, tmp_path)
    assert "names no host" in refusal({**MINIMAL, "server": "http:///runner"}, tmp_path)


def test_a_slot_count_below_one_is_a_refusal(tmp_path: Path) -> None:
    assert "slots is at least 1" in refusal({**MINIMAL, "slots": 0}, tmp_path)
    assert "slots is a whole number" in refusal({**MINIMAL, "slots": "many"}, tmp_path)


def test_an_engine_needs_a_name_and_a_path(tmp_path: Path) -> None:
    assert "engines[0].name is required" in refusal({**MINIMAL, "engines": [{}]}, tmp_path)
    assert "engines[0].path is required" in refusal(
        {**MINIMAL, "engines": [{"name": "sf"}]}, tmp_path
    )


def test_two_engines_of_the_same_name_are_a_refusal(tmp_path: Path) -> None:
    data = {**MINIMAL, "engines": [{"name": "sf", "path": "/a"}, {"name": "sf", "path": "/b"}]}

    assert "two engines are called 'sf'" in refusal(data, tmp_path)


def test_a_kind_or_a_tier_outside_the_vocabulary_is_a_refusal(tmp_path: Path) -> None:
    assert "kind is one of" in refusal(
        {**MINIMAL, "engines": [{"name": "sf", "path": "/a", "kind": "lc0"}]}, tmp_path
    )
    assert "tier is one of" in refusal(
        {**MINIMAL, "engines": [{"name": "sf", "path": "/a", "tier": "medium"}]}, tmp_path
    )


def test_a_log_level_that_is_not_one_is_a_refusal(tmp_path: Path) -> None:
    assert "log_level is one of" in refusal({**MINIMAL, "log_level": "chatty"}, tmp_path)


def test_a_file_that_is_not_there_says_so(tmp_path: Path) -> None:
    with pytest.raises(RunnerConfigError, match="no such file"):
        RunnerConfig.load(tmp_path / "absent.yaml")


def test_a_file_that_is_not_a_mapping_says_so(tmp_path: Path) -> None:
    path = tmp_path / "runner.yaml"
    path.write_text("- one\n- two\n", encoding="utf-8")

    with pytest.raises(RunnerConfigError, match="mapping of settings"):
        RunnerConfig.load(path)


# --- the environment ---------------------------------------------------------


def test_the_environment_beats_the_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A token in a compose `environment:` wins over one in a mounted yaml."""
    monkeypatch.setenv("BLUNDERBASE_RUNNER_TOKEN", "bb_rnr_from_the_environment")
    monkeypatch.setenv("BLUNDERBASE_RUNNER_SERVER", "https://elsewhere.example.com")
    monkeypatch.setenv("BLUNDERBASE_RUNNER_NAME", "other-box")
    monkeypatch.setenv("BLUNDERBASE_RUNNER_SLOTS", "7")

    config = RunnerConfig.load(write(tmp_path, FULL))

    assert config.token == "bb_rnr_from_the_environment"
    assert config.server == "https://elsewhere.example.com"
    assert (config.name, config.slots) == ("other-box", 7)
    # Everything the environment does not carry still comes from the file.
    assert [engine.name for engine in config.engines] == ["sf-remote", "maia-remote"]


def test_an_empty_variable_is_not_an_override(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("BLUNDERBASE_RUNNER_TOKEN", "   ")

    assert RunnerConfig.load(write(tmp_path, FULL)).token == "bb_rnr_kY3"


def test_the_config_path_can_come_from_the_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(CONFIG_ENV, str(write(tmp_path, MINIMAL)))

    assert RunnerConfig.load().name == "box"


def test_with_no_file_at_all_the_environment_is_the_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BLUNDERBASE_RUNNER_SERVER", "http://127.0.0.1:8765")
    monkeypatch.setenv("BLUNDERBASE_RUNNER_TOKEN", "bb_rnr_x")
    monkeypatch.setenv("BLUNDERBASE_RUNNER_NAME", "box")

    config = RunnerConfig.load()

    assert (config.server, config.name, config.engines) == ("http://127.0.0.1:8765", "box", ())


def test_with_neither_a_file_nor_an_environment_the_refusal_names_the_field() -> None:
    with pytest.raises(RunnerConfigError, match="<environment>: server is required"):
        RunnerConfig.load()

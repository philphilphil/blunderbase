"""`blunderbase engines` — register, list and remove the binaries this host may start.

The headless half of the Engines page, and the thing `make engines` is built on. Every
engine here is `fake_uci.py`, a subprocess speaking UCI over a pipe, so the probe the CLI
runs is the real one: a test that stubbed it would not tell us whether the command can
register an engine at all.

The same shape as `test_runners_cli.py` — `main` is called with the argv a person would
type, and what is asserted is the database afterwards plus the lines printed.
"""

from __future__ import annotations

import pytest
from fake_uci import MAIA_OPTIONS, STOCKFISH_OPTIONS, fake_engine_command
from sqlalchemy import select

from backend.cli import main
from backend.config import Settings
from backend.db.enums import EngineKind, EngineRole
from backend.db.models import Engine, Runner
from backend.db.session import session_scope
from backend.services import engines as engines_service


@pytest.fixture
def uci(tmp_path: pytest.TempPathFactory) -> str:
    return fake_engine_command(tmp_path, name="FakeFish 1", options=STOCKFISH_OPTIONS)


@pytest.fixture
def maia(tmp_path: pytest.TempPathFactory) -> str:
    return fake_engine_command(tmp_path, name="FakeMaia 1", options=MAIA_OPTIONS)


def test_list_says_so_when_there_are_none(
    settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["engines", "list"]) == 0
    assert "no engines yet" in capsys.readouterr().out


def test_add_probes_the_binary_and_takes_the_roles_its_kind_fits(
    settings: Settings, uci: str, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["engines", "add", "sf-local", uci, "--option", "Threads=4"]) == 0

    output = capsys.readouterr().out
    # The version comes from the binary's own `id name`, which is the proof it was started.
    assert "FakeFish 1" in output
    assert "the quick tier, the deep tier" in output

    with session_scope(settings) as session:
        engine = session.scalars(select(Engine)).one()
        assert (engine.name, engine.kind, engine.enabled) == ("sf-local", EngineKind.UCI, True)
        assert engine.options == {"Threads": 4}
        # A first UCI engine fills the two search roles on its way in, so a fresh install
        # analyses without a second command.
        for role in (EngineRole.QUICK, EngineRole.DEEP):
            assert engines_service.engine_for_role(session, role) is not None
        assert engines_service.engine_for_role(session, EngineRole.HUMAN) is None


def test_add_refuses_a_name_that_is_already_registered(
    settings: Settings, uci: str, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["engines", "add", "sf-local", uci]) == 0
    capsys.readouterr()

    assert main(["engines", "add", "sf-local", uci]) == 1
    assert "--replace updates it" in capsys.readouterr().out
    with session_scope(settings) as session:
        assert len(session.scalars(select(Engine)).all()) == 1


def test_replace_rewrites_the_row_rather_than_adding_a_second(
    settings: Settings,
    tmp_path: pytest.TempPathFactory,
    uci: str,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """What makes `make engines` re-runnable: the same line twice is the same engine."""
    assert main(["engines", "add", "sf-local", uci, "--option", "Threads=4"]) == 0
    moved = fake_engine_command(tmp_path, name="FakeFish 2", options=STOCKFISH_OPTIONS)
    capsys.readouterr()

    assert main(["engines", "add", "sf-local", moved, "--option", "Threads=8", "--replace"]) == 0

    assert "updated" in capsys.readouterr().out
    with session_scope(settings) as session:
        engine = session.scalars(select(Engine)).one()
        assert engine.path == moved
        assert engine.options == {"Threads": 8}
        # Re-probed, not carried over: the row says what the binary declares today.
        assert engine.version == "FakeFish 2"


def test_role_takes_the_role_from_whatever_held_it(
    settings: Settings, uci: str, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["engines", "add", "first", uci]) == 0
    assert main(["engines", "add", "second", uci, "--role", "deep"]) == 0
    capsys.readouterr()

    with session_scope(settings) as session:
        quick = engines_service.engine_for_role(session, EngineRole.QUICK)
        deep = engines_service.engine_for_role(session, EngineRole.DEEP)
        assert quick is not None and quick.name == "first"
        # Explicitly asked for, so it is taken — `assign_default_roles` alone never would.
        assert deep is not None and deep.name == "second"


def test_a_maia_takes_human_moves_and_never_a_search_role(
    settings: Settings, maia: str, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["engines", "add", "maia-local", maia, "--kind", "maia"]) == 0

    assert "human moves" in capsys.readouterr().out
    with session_scope(settings) as session:
        engine = session.scalars(select(Engine)).one()
        assert engine.kind is EngineKind.MAIA
        assert engines_service.engine_for_role(session, EngineRole.HUMAN) is not None
        assert engines_service.engine_for_role(session, EngineRole.QUICK) is None


def test_an_option_the_binary_does_not_declare_is_refused_by_name(
    settings: Settings, uci: str, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["engines", "add", "sf-local", uci, "--option", "Nonsense=1"]) == 1

    output = capsys.readouterr().out
    assert "'Nonsense' is not an option" in output
    # The message names what the engine *does* declare, so the fix is in the message.
    assert "Threads" in output
    with session_scope(settings) as session:
        assert session.scalars(select(Engine)).all() == []


def test_disabled_registers_the_engine_switched_off(
    settings: Settings, uci: str, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["engines", "add", "sf-local", uci, "--disabled"]) == 0

    assert "switched off" in capsys.readouterr().out
    with session_scope(settings) as session:
        assert session.scalars(select(Engine)).one().enabled is False


def test_remove_deletes_the_row_and_an_unknown_name_is_an_error(
    settings: Settings, uci: str, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["engines", "add", "sf-local", uci]) == 0
    capsys.readouterr()

    assert main(["engines", "remove", "sf-local"]) == 0
    assert "removed" in capsys.readouterr().out
    with session_scope(settings) as session:
        assert session.scalars(select(Engine)).all() == []

    assert main(["engines", "remove", "sf-local"]) == 1
    assert "no engine named" in capsys.readouterr().out


def test_a_runners_engine_is_not_editable_from_this_host(
    settings: Settings, uci: str, capsys: pytest.CaptureFixture[str]
) -> None:
    """Its row is that machine's advertisement; the yaml over there is where it changes."""
    # Through the CLI, so the database is migrated the way any real invocation migrates it.
    assert main(["runners", "create", "gpu-box"]) == 0
    with session_scope(settings) as session:
        runner = session.scalars(select(Runner)).one()
        session.add(
            Engine(
                name="sf-remote",
                kind=EngineKind.UCI,
                path="/usr/games/stockfish",
                runner_id=runner.id,
                enabled=True,
            )
        )
        session.commit()
    capsys.readouterr()

    assert main(["engines", "add", "sf-remote", uci, "--replace"]) == 1

    assert "gpu-box" in capsys.readouterr().out
    with session_scope(settings) as session:
        assert session.scalars(select(Engine)).one().path == "/usr/games/stockfish"


def test_list_names_each_engine_where_it_lives_and_what_it_serves(
    settings: Settings, uci: str, maia: str, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["engines", "add", "sf-local", uci]) == 0
    assert main(["engines", "add", "maia-local", maia, "--kind", "maia"]) == 0
    capsys.readouterr()

    assert main(["engines", "list"]) == 0

    lines = capsys.readouterr().out.splitlines()
    assert len(lines) == 2
    assert "sf-local" in lines[0] and "this host" in lines[0] and "quick, deep" in lines[0]
    assert "maia-local" in lines[1] and "human" in lines[1]

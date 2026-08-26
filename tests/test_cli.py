from __future__ import annotations

import getpass
import tomllib
from pathlib import Path

import pytest
from fake_uci import STOCKFISH_OPTIONS, fake_engine_command
from sqlalchemy import select

import backend
from backend.cli import _import_options, build_parser, main
from backend.config import Settings
from backend.db.enums import EngineKind, JobStatus, Platform, RunStatus
from backend.db.models import (
    Account,
    AnalysisRun,
    Credential,
    Engine,
    Game,
    GamePosition,
    ImportJob,
)
from backend.db.session import session_scope
from backend.services import auth as auth_service
from backend.services import import_service


def test_every_prewired_source_is_a_cli_choice(settings: Settings) -> None:
    parser = build_parser(settings)
    args = parser.parse_args(["import", "lichess", "--username", "owner"])
    assert (args.command, args.source, args.username) == ("import", "lichess", "owner")
    assert set(import_service.SOURCES) == {"lichess", "chesscom", "pgn"}


def test_an_unregistered_source_is_refused(settings: Settings) -> None:
    with pytest.raises(SystemExit):
        build_parser(settings).parse_args(["import", "telepathy"])


def test_serve_defaults_come_from_settings(settings: Settings) -> None:
    args = build_parser(settings).parse_args(["serve"])
    assert (args.host, args.port, args.reload) == (settings.host, settings.port, False)


def test_version_prints_the_package_version(
    settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    """`--version` answers on its own, without the otherwise-required subcommand."""
    with pytest.raises(SystemExit) as exit_code:
        build_parser(settings).parse_args(["--version"])
    assert exit_code.value.code == 0
    assert capsys.readouterr().out.strip() == f"blunderbase {backend.__version__}"


def test_the_version_is_not_a_second_literal() -> None:
    """One number, in pyproject.toml; `backend.__version__` reads it back."""
    pyproject = tomllib.loads(
        (Path(__file__).resolve().parents[1] / "pyproject.toml").read_text()
    )
    assert backend.__version__ == pyproject["project"]["version"]


def test_db_upgrade_is_a_subcommand(settings: Settings) -> None:
    args = build_parser(settings).parse_args(["db", "upgrade"])
    assert (args.command, args.db_command) == ("db", "upgrade")


def test_unknown_source_lookup_names_the_known_ones() -> None:
    with pytest.raises(import_service.UnknownSourceError, match="lichess"):
        import_service.get_adapter("telepathy")


def test_a_stub_adapter_fails_when_it_is_called_not_at_import_time() -> None:
    """Registration is by dotted path, so a source with no `run` yet fails only on use."""
    import_service.register_source("telepathy", "backend.adapters.pgn_import:divine")
    try:
        with pytest.raises(import_service.SourceNotImplementedError):
            import_service.get_adapter("telepathy")
    finally:
        import_service.SOURCES.pop("telepathy")


def test_the_bare_positional_is_the_source_s_one_argument(settings: Settings) -> None:
    parser = build_parser(settings)
    assert _import_options(parser.parse_args(["import", "pgn", "games.pgn"])) == {
        "path": "games.pgn"
    }
    assert _import_options(parser.parse_args(["import", "lichess", "owner"])) == {
        "username": "owner"
    }
    assert _import_options(parser.parse_args(["import", "pgn", "--path", "a.pgn"])) == {
        "path": "a.pgn"
    }


def test_importing_a_pgn_runs_end_to_end_against_a_real_database(
    settings: Settings, fixtures_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["import", "pgn", str(fixtures_dir / "multi_game.pgn")]) == 0

    output = capsys.readouterr().out
    assert "pgn: 3 imported, 0 skipped, 1 failed" in output
    assert "Qxf7" in output

    with session_scope(settings) as session:
        job = session.scalars(select(ImportJob)).one()
        assert job.status is JobStatus.DONE
        assert len(job.errors) == 1
        games = list(session.scalars(select(Game)))
        assert len(games) == 3
        assert sum(len(game.positions) for game in games) == sum(
            game.ply_count + 1 for game in games
        )
        assert session.scalars(select(GamePosition)).first() is not None


def test_a_missing_pgn_file_reports_a_failed_job(
    settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["import", "pgn", "/nowhere/at/all.pgn"]) == 1
    assert "import failed" in capsys.readouterr().out


def test_accounts_list_names_the_owner_and_counts_their_games(
    settings: Settings, fixtures_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["import", "pgn", str(fixtures_dir / "multi_game.pgn")]) == 0
    assert main(["accounts", "add", "lichess", "blunderbase"]) == 0
    capsys.readouterr()

    assert main(["accounts", "list"]) == 0

    line = capsys.readouterr().out.strip()
    assert line.startswith("lichess  blunderbase")
    assert "owner" in line and "3 game(s)" in line


def test_accounts_list_says_so_when_there_are_none(
    settings: Settings, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["accounts", "list"]) == 0
    assert "no accounts yet" in capsys.readouterr().out


def test_accounts_add_claims_the_games_that_were_already_there(
    settings: Settings, fixtures_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """The production case: an archive imported before any account named its owner."""
    assert main(["import", "pgn", str(fixtures_dir / "multi_game.pgn")]) == 0
    with session_scope(settings) as session:
        assert [game.owner_color for game in session.scalars(select(Game))] == [None, None, None]
    capsys.readouterr()

    assert main(["accounts", "add", "lichess", "blunderbase"]) == 0

    output = capsys.readouterr().out
    assert "lichess: blunderbase is the owner's account" in output
    assert "3 game side(s) linked, 3 game(s) coloured" in output
    assert "0 game(s) still belong to nobody" in output
    with session_scope(settings) as session:
        assert all(game.owner_color is not None for game in session.scalars(select(Game)))


def test_accounts_reconcile_repairs_every_account_and_repeats_harmlessly(
    settings: Settings, fixtures_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["db", "upgrade"]) == 0
    with session_scope(settings) as session:
        session.add(Account(platform=Platform.LICHESS, username="blunderbase", is_owner=True))
    assert main(["import", "pgn", str(fixtures_dir / "multi_game.pgn")]) == 0
    capsys.readouterr()

    assert main(["accounts", "reconcile"]) == 0

    output = capsys.readouterr().out
    assert "0 game side(s) linked, 0 game(s) coloured" in output, "the import already claimed them"
    assert "0 game(s) still belong to nobody" in output


def test_accounts_add_refuses_a_platform_that_is_not_one(settings: Settings) -> None:
    with pytest.raises(SystemExit):
        build_parser(settings).parse_args(["accounts", "add", "telepathy", "owner"])


def test_analyze_parses_the_flags_a_deep_pass_needs(settings: Settings) -> None:
    args = build_parser(settings).parse_args(
        ["analyze", "--game-id", "7", "--tier", "deep", "--ply-range", "40:80", "--multipv", "5"]
    )
    assert (args.game_id, args.tier, args.ply_range, args.multipv) == (7, "deep", (40, 80), 5)


def test_a_ply_range_has_to_be_a_range(settings: Settings) -> None:
    parser = build_parser(settings)
    for bad in ("40", "80:40", "-1:5", "a:b"):
        with pytest.raises(SystemExit):
            parser.parse_args(["analyze", "--ply-range", bad])


def test_analyze_queues_a_pass_per_game_without_running_it(
    settings: Settings, fixtures_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["import", "pgn", str(fixtures_dir / "multi_game.pgn")]) == 0
    with session_scope(settings) as session:
        session.add(
            Engine(name="Stockfish", kind=EngineKind.UCI, path="/usr/bin/stockfish", enabled=True)
        )
    capsys.readouterr()

    assert main(["analyze", "--queue-only"]) == 0

    assert "queued 3 quick run(s)" in capsys.readouterr().out
    with session_scope(settings) as session:
        runs = list(session.scalars(select(AnalysisRun)))
    assert len(runs) == 3
    assert {run.status for run in runs} == {RunStatus.QUEUED}


def test_analyze_runs_the_queue_down_in_this_process(
    settings: Settings,
    fixtures_dir: Path,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """`blunderbase analyze` is the headless half of the workers the API process runs."""
    assert main(["db", "upgrade"]) == 0
    with session_scope(settings) as session:
        session.add(
            Engine(
                name="FakeFish",
                kind=EngineKind.UCI,
                path=fake_engine_command(
                    tmp_path,
                    options=STOCKFISH_OPTIONS,
                    go_default={"info": ["depth 8 score cp 20 nodes 100"], "bestmove": "(none)"},
                ),
                enabled=True,
            )
        )
    assert main(["import", "pgn", str(fixtures_dir / "analysis_game.pgn")]) == 0
    capsys.readouterr()

    assert main(["analyze"]) == 0

    output = capsys.readouterr().out
    assert "queued 0 quick run(s)" in output, "the import already queued this game's pass"
    assert "done 6 moves" in output
    with session_scope(settings) as session:
        run = session.scalars(select(AnalysisRun)).one()
    assert run.status is RunStatus.DONE


def test_analyze_says_so_when_no_engine_is_registered(
    settings: Settings, fixtures_dir: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["import", "pgn", str(fixtures_dir / "multi_game.pgn")]) == 0
    capsys.readouterr()

    assert main(["analyze", "--queue-only"]) == 1
    assert "no engine is registered yet" in capsys.readouterr().out


def test_set_password_asks_twice_and_stores_a_hash(
    settings: Settings, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The headless bootstrap: no UI, no echo, and the plaintext goes nowhere."""
    entries = iter(["a-headless-password", "a-headless-password"])
    monkeypatch.setattr(getpass, "getpass", lambda prompt="": next(entries))

    assert main(["set-password"]) == 0

    assert "password set" in capsys.readouterr().out
    with session_scope(settings) as session:
        credential = session.scalars(select(Credential)).one()
        assert "a-headless-password" not in credential.password_hash
        assert auth_service.verify_password(session, "a-headless-password") is True


def test_set_password_refuses_two_entries_that_differ(
    settings: Settings, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    entries = iter(["a-headless-password", "a-different-password"])
    monkeypatch.setattr(getpass, "getpass", lambda prompt="": next(entries))

    assert main(["set-password"]) == 1

    assert "did not match" in capsys.readouterr().out
    with session_scope(settings) as session:
        assert auth_service.setup_required(session) is True


def test_set_password_replaces_the_one_that_is_there(
    settings: Settings, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """An owner who has locked themselves out cannot be asked for the old password."""
    assert main(["db", "upgrade"]) == 0
    with session_scope(settings) as session:
        auth_service.set_password(session, "the-forgotten-one")
        auth_service.create_session(session)
    entries = iter(["the-replacement", "the-replacement"])
    monkeypatch.setattr(getpass, "getpass", lambda prompt="": next(entries))
    capsys.readouterr()

    assert main(["set-password"]) == 0

    assert "password replaced" in capsys.readouterr().out
    with session_scope(settings) as session:
        assert auth_service.verify_password(session, "the-replacement") is True
        assert auth_service.open_session_count(session) == 0


def test_set_password_refuses_one_below_the_minimum(
    settings: Settings, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(getpass, "getpass", lambda prompt="": "short")

    assert main(["set-password"]) == 1

    assert "at least" in capsys.readouterr().out

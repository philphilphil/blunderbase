from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import func, select

from backend.cli import main
from backend.config import Settings
from backend.db.migrate import head_revision
from backend.db.models import Game, Note
from backend.db.session import session_scope
from backend.services.backups import BackupError, restore_database, verify_database


def test_cli_backup_and_restore_round_trip_the_complete_database(
    settings: Settings,
    fixtures_dir: Path,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert main(["import", "pgn", str(fixtures_dir / "multi_game.pgn")]) == 0
    with session_scope(settings) as session:
        game = session.scalars(select(Game).order_by(Game.id)).first()
        assert game is not None
        session.add(Note(text="keep this thought", game_id=game.id, ply=2))
    backup = tmp_path / "library-backup.db"
    capsys.readouterr()

    assert main(["db", "backup", str(backup)]) == 0

    output = capsys.readouterr().out
    assert f"backup: {backup}" in output
    assert f"schema {head_revision()}" in output
    assert "sha256 " in output
    assert verify_database(backup) == head_revision()

    with session_scope(settings) as session:
        session.add(Note(text="written after the backup"))
    assert main(["db", "restore", str(backup)]) == 1
    assert "pass --force" in capsys.readouterr().out

    assert main(["db", "restore", str(backup), "--force"]) == 0

    assert "restored:" in capsys.readouterr().out
    with session_scope(settings) as session:
        assert session.scalar(select(func.count(Game.id))) == 3
        assert [note.text for note in session.scalars(select(Note).order_by(Note.id))] == [
            "keep this thought"
        ]


def test_invalid_backup_never_replaces_the_database(
    settings: Settings, tmp_path: Path
) -> None:
    assert main(["db", "upgrade"]) == 0
    before = settings.database_path.read_bytes()
    invalid = tmp_path / "not-a-database.db"
    invalid.write_text("not sqlite", encoding="utf-8")

    with pytest.raises(BackupError, match="valid Blunderbase database"):
        restore_database(invalid, settings.database_path, overwrite=True)

    assert settings.database_path.read_bytes() == before


def test_restore_removes_sidecars_from_the_database_being_replaced(
    settings: Settings, tmp_path: Path
) -> None:
    assert main(["db", "upgrade"]) == 0
    backup = tmp_path / "backup.db"
    assert main(["db", "backup", str(backup)]) == 0
    wal = Path(f"{settings.database_path}-wal")
    shm = Path(f"{settings.database_path}-shm")
    wal.write_bytes(b"stale")
    shm.write_bytes(b"stale")

    restored = restore_database(backup, settings.database_path, overwrite=True)

    assert restored.sha256
    assert not wal.exists()
    assert not shm.exists()

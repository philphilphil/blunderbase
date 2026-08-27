"""Which database the app talks to, and what else the environment may decide."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.config import Settings, get_settings
from backend.db.session import reset_engines


def test_the_database_is_the_sqlite_file_unless_told_otherwise(tmp_path: Path) -> None:
    settings = Settings(root=tmp_path)

    assert settings.database_path == tmp_path / "data" / "blunderbase.db"
    assert settings.database_url == f"sqlite+pysqlite:///{settings.database_path}"


def test_the_database_url_follows_the_configured_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`database_url` is derived, so pointing `BLUNDERBASE_DB_PATH` elsewhere moves it too."""
    elsewhere = tmp_path / "elsewhere" / "games.db"
    monkeypatch.setenv("BLUNDERBASE_ROOT", str(tmp_path))
    monkeypatch.setenv("BLUNDERBASE_DB_PATH", str(elsewhere))
    get_settings.cache_clear()
    reset_engines()
    try:
        assert get_settings().database_url == f"sqlite+pysqlite:///{elsewhere}"
    finally:
        get_settings.cache_clear()
        reset_engines()

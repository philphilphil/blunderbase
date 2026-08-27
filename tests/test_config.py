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


def test_a_database_url_is_the_postgresql_escape_hatch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The one seam the spec's escape hatch needs: everything else reads `database_url`."""
    url = "postgresql+psycopg://blunderbase@localhost:5432/blunderbase"
    monkeypatch.setenv("BLUNDERBASE_ROOT", str(tmp_path))
    monkeypatch.setenv("BLUNDERBASE_DATABASE_URL", url)
    get_settings.cache_clear()
    reset_engines()
    try:
        assert get_settings().database_url == url
    finally:
        get_settings.cache_clear()
        reset_engines()


def test_an_empty_database_url_falls_back_to_the_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A commented-out entry someone uncommented and left blank must not stop the boot."""
    monkeypatch.setenv("BLUNDERBASE_ROOT", str(tmp_path))
    monkeypatch.setenv("BLUNDERBASE_DATABASE_URL", "")
    get_settings.cache_clear()
    reset_engines()
    try:
        assert get_settings().database_url.startswith("sqlite+pysqlite:///")
    finally:
        get_settings.cache_clear()
        reset_engines()

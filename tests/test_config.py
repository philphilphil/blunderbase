"""Which database the app talks to, and what else the environment may decide."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.config import MAIA_MAX_RATING, MAIA_MIN_RATING, Settings, get_settings
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


def test_no_maia_target_elo_is_the_original_rating_centred_behaviour(tmp_path: Path) -> None:
    assert Settings(root=tmp_path).maia_target_elo is None


def test_a_maia_target_elo_is_clamped_to_what_the_model_was_trained_on(
    tmp_path: Path,
) -> None:
    """An owner aiming at 2200 gets Maia's top level, not a server that will not boot."""
    assert Settings(root=tmp_path, maia_target_elo=1700).maia_target_elo == 1700
    assert Settings(root=tmp_path, maia_target_elo=2400).maia_target_elo == MAIA_MAX_RATING
    assert Settings(root=tmp_path, maia_target_elo=800).maia_target_elo == MAIA_MIN_RATING


def test_the_maia_target_elo_is_read_from_the_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("BLUNDERBASE_ROOT", str(tmp_path))
    monkeypatch.setenv("BLUNDERBASE_MAIA_TARGET_ELO", "1750")
    get_settings.cache_clear()
    reset_engines()
    try:
        assert get_settings().maia_target_elo == 1750
    finally:
        get_settings.cache_clear()
        reset_engines()


def test_an_empty_maia_target_elo_means_unset_rather_than_a_refusal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("BLUNDERBASE_ROOT", str(tmp_path))
    monkeypatch.setenv("BLUNDERBASE_MAIA_TARGET_ELO", "")
    get_settings.cache_clear()
    reset_engines()
    try:
        assert get_settings().maia_target_elo is None
    finally:
        get_settings.cache_clear()
        reset_engines()

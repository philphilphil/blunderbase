from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config

from backend.config import Settings, get_settings

MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"


def alembic_config(settings: Settings | None = None) -> Config:
    settings = settings or get_settings()
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    config.set_main_option("sqlalchemy.url", settings.database_url)
    return config


def upgrade_to_head(settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    settings.ensure_directories()
    command.upgrade(alembic_config(settings), "head")

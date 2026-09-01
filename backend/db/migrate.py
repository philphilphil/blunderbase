from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

from backend.config import Settings, get_settings

MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"


def alembic_config(settings: Settings | None = None) -> Config:
    settings = settings or get_settings()
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    config.set_main_option("sqlalchemy.url", settings.database_url)
    return config


def head_revision() -> str:
    """The newest migration in `backend/migrations`, whatever it is called today.

    The schema version a backup reports is this (`services.backups.verify_database` reads
    it back off the file), so anything asserting "the backup carries the current schema"
    asks here rather than naming a revision that stops being the head at the next
    migration.
    """
    return ScriptDirectory.from_config(alembic_config()).get_current_head() or ""


def upgrade_to_head(settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    settings.ensure_directories()
    command.upgrade(alembic_config(settings), "head")

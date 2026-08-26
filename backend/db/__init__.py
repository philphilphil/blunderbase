"""The one database: SQLAlchemy 2 models, the engine/session factory and Alembic wiring.

Access is through SQLAlchemy only and no SQLite-only construct is used anywhere, so the
PostgreSQL escape hatch stays open. See `docs/ARCHITECTURE.md`.
"""

from backend.db.base import Base
from backend.db.session import (
    create_db_engine,
    get_engine,
    get_session,
    get_sessionmaker,
    reset_engines,
    session_scope,
)

__all__ = [
    "Base",
    "create_db_engine",
    "get_engine",
    "get_session",
    "get_sessionmaker",
    "reset_engines",
    "session_scope",
]

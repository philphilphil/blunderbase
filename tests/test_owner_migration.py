"""Upgrade both healthy installations and credentials left by the old setup race."""

import pytest
from alembic import command
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from backend.config import Settings
from backend.db.migrate import alembic_config, upgrade_to_head
from backend.db.models import AuthSession, Credential
from backend.db.session import get_engine, get_sessionmaker
from backend.services import auth


@pytest.mark.parametrize("ids", [(), (1,), (7,), (1, 2), (7, 9)])
def test_single_owner_migration_preserves_the_active_password(
    settings: Settings, ids: tuple[int, ...],
) -> None:
    settings.ensure_directories()
    config = alembic_config(settings)
    command.upgrade(config, "0021_name_unnamed_openings")
    sessions = get_sessionmaker(settings)
    password = "the-original-password"
    if ids:
        with sessions() as session:
            auth.set_password(session, password)
            token = auth.create_session(session)
        with get_engine(settings).begin() as connection:
            connection.execute(text("UPDATE credentials SET id = :id"), {"id": ids[0]})
            if len(ids) > 1:
                row = dict(connection.execute(select(Credential.__table__)).mappings().one())
                row.update(id=ids[1], password_hash="00" * 64)
                connection.execute(Credential.__table__.insert().values(**row))

    upgrade_to_head(settings)
    with sessions() as session:
        if ids:
            assert session.scalars(select(Credential.id)).one() == 1
            assert auth.verify_password(session, password)
            assert auth.validate_session(session, token) is (len(ids) == 1)
            if len(ids) > 1:
                assert list(session.scalars(select(AuthSession))) == []
        else:
            assert auth.setup_required(session)
            auth.set_password(session, password)
    with get_engine(settings).begin() as connection:
        with pytest.raises(IntegrityError, match="CHECK constraint failed"):
            connection.execute(text("UPDATE credentials SET id = 2"))

    # The constraint can also be removed by an offline downgrade.
    command.downgrade(config, "0021_name_unnamed_openings")
    with get_engine(settings).begin() as connection:
        connection.execute(text("UPDATE credentials SET id = 2"))

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import DateTime, Dialect, String
from sqlalchemy.types import TypeDecorator

ENUM_LENGTH = 32


class EnumString[E: StrEnum](TypeDecorator[E]):
    """A `StrEnum` stored as a plain VARCHAR, validated on the way in.

    Both back ends see the same column type, so a member can be added without a
    migration, and an unknown value is rejected in Python rather than by a database
    constraint that SQLite and PostgreSQL would spell differently.
    """

    impl = String
    cache_ok = True

    def __init__(self, enum_type: type[E], length: int = ENUM_LENGTH) -> None:
        self.enum_type = enum_type
        super().__init__(length=length)

    def process_bind_param(self, value: E | str | None, dialect: Dialect) -> str | None:
        if value is None:
            return None
        return self.enum_type(value).value

    def process_result_value(self, value: str | None, dialect: Dialect) -> E | None:
        if value is None:
            return None
        return self.enum_type(value)


class UtcDateTime(TypeDecorator[datetime]):
    """An aware UTC timestamp stored as a naive UTC one.

    SQLite has no timezone-carrying type and PostgreSQL's `timestamptz` would read a
    naive value in the session's zone, so the offset is normalised away on the way in and
    reattached on the way out. Every timestamp in the database is UTC by construction.
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value: Any, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


def utcnow() -> datetime:
    return datetime.now(UTC)

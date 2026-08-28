from __future__ import annotations

import re
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from enum import StrEnum

from backend.db.enums import Color, Source, Speed, Tier
from backend.mcp.errors import BAD_ARGUMENT, BAD_FEN, CoachError

# "30d" / "6w" / "12m" / "2y": how a coach says a window out loud. Anything else is read
# as an ISO 8601 date or timestamp.
RELATIVE = re.compile(r"^(\d+)\s*([dwmy])$", re.IGNORECASE)
RELATIVE_DAYS = {"d": 1, "w": 7, "m": 30, "y": 365}

# `Platform.OTB` is where a hand-entered game is played; `Source.MANUAL` is how it got in.
PLATFORM_SOURCES = {"otb": Source.MANUAL}


def member[E: StrEnum](enum_type: type[E], value: str | None, field: str) -> E | None:
    """One member of a `StrEnum` from what a model typed, or a structured error."""
    if value is None:
        return None
    text = str(value).strip().casefold()
    if not text:
        return None
    try:
        return enum_type(text)
    except ValueError:
        raise CoachError(
            BAD_ARGUMENT,
            f"unknown {field} {value!r}",
            allowed=[str(item) for item in enum_type],
        ) from None


def color(value: str | None) -> Color | None:
    return member(Color, value, "color")


def tier(value: str | None, default: Tier = Tier.DEEP) -> Tier:
    return member(Tier, value, "tier") or default


def platform(value: str | None) -> Source | None:
    """A platform name as the source it imports through: "otb" is a manual entry."""
    if value is None:
        return None
    text = str(value).strip().casefold()
    if not text:
        return None
    if text in PLATFORM_SOURCES:
        return PLATFORM_SOURCES[text]
    try:
        return Source(text)
    except ValueError:
        raise CoachError(
            BAD_ARGUMENT,
            f"unknown platform {value!r}",
            allowed=[str(item) for item in Source] + sorted(PLATFORM_SOURCES),
        ) from None


def time_control(value: str | None) -> tuple[Speed | None, str | None]:
    """A time control as either a speed ("blitz") or a literal clock ("300+3").

    Both are how the owner names one, and the same argument accepts either rather than
    making the model pick the field the database happens to store it in.
    """
    if value is None:
        return None, None
    text = str(value).strip()
    if not text:
        return None, None
    try:
        return Speed(text.casefold()), None
    except ValueError:
        return None, text


def when(value: str | None, field: str = "date") -> datetime | None:
    """An ISO date or timestamp, or a relative window like "30d", as an aware UTC time."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None

    relative = RELATIVE.match(text)
    if relative is not None:
        days = int(relative.group(1)) * RELATIVE_DAYS[relative.group(2).casefold()]
        return datetime.now(UTC) - timedelta(days=days)

    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        raise CoachError(
            BAD_ARGUMENT,
            f"{field} {value!r} is not an ISO 8601 date, a timestamp, or a window like '30d'",
        ) from None
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)


def fen(value: str | None, *, required: bool = True) -> str | None:
    """A FEN or EPD, checked here so a typo is a structured error and not a stack trace."""
    text = (value or "").strip()
    if not text:
        if required:
            raise CoachError(BAD_ARGUMENT, "a FEN is required")
        return None

    from backend.services.explorer import read_fen

    try:
        read_fen(text)
    except ValueError as exc:
        raise CoachError(BAD_FEN, f"{text!r} is not a position: {exc}") from None
    return text


def capped(value: int | None, default: int, maximum: int) -> int:
    """A caller's count, clamped into 1..maximum.

    Clamped rather than refused: a coach asking for "my last 500 games" wants the newest
    of them, not an argument error, and the cap is what keeps one answer readable.
    """
    if value is None:
        return default
    return max(1, min(int(value), maximum))


def offset(value: int | None) -> int:
    return max(0, int(value or 0))


def ply_range(start: int | None, end: int | None) -> tuple[int, int] | None:
    """A half-move window, end exclusive. Both ends or neither."""
    if start is None and end is None:
        return None
    if start is None or end is None:
        raise CoachError(BAD_ARGUMENT, "a ply range needs both ply_start and ply_end")
    if start < 0 or end <= start:
        raise CoachError(
            BAD_ARGUMENT, f"ply range {start}:{end} is empty; ply_start must be below ply_end"
        )
    return int(start), int(end)


def ratings(value: Sequence[int] | int | None, field: str = "elos") -> list[int] | None:
    """Maia levels as a list of ints, or None where the caller named none.

    Clamped and deduped downstream, in `app_settings.clean_maia_elos`, which is the one
    place that knows what a level may be; this only refuses what is not a number at all.
    """
    if value is None:
        return None
    wanted = [value] if isinstance(value, int) else list(value)
    levels: list[int] = []
    for entry in wanted:
        try:
            levels.append(int(entry))
        except (TypeError, ValueError):
            raise CoachError(BAD_ARGUMENT, f"{field} takes ratings, not {entry!r}") from None
    return levels or None


def tags(value: Sequence[str] | None) -> list[str]:
    return [str(tag).strip() for tag in (value or ()) if str(tag).strip()]


def moves(value: Sequence[str] | None) -> list[str]:
    """A variation as UCI strings. Legality is the service's to check against the game."""
    return [str(uci).strip() for uci in (value or ()) if str(uci).strip()]


def period(start: str | None, end: str | None, field: str) -> tuple[datetime, datetime]:
    """One of the two windows `compare_periods` puts side by side."""
    since = when(start, f"{field}_start")
    until = when(end, f"{field}_end") or datetime.now(UTC)
    if since is None:
        raise CoachError(BAD_ARGUMENT, f"{field}_start is required")
    if since >= until:
        raise CoachError(BAD_ARGUMENT, f"{field}_start must come before {field}_end")
    return since, until

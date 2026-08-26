from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import ColumnElement, select
from sqlalchemy.orm import Session

from backend.db.models import Note
from backend.services import events as events_service
from backend.services.explorer import find_position, get_or_create_position

# A tag is matched after the row is read rather than in SQL: `notes.tags` is a portable
# JSON column, and the operators that would search inside one are spelled differently on
# SQLite and on PostgreSQL. Coach memory is small; this is the cheap half of the trade.
SCAN_LIMIT = 5000

# A note the coach writes has to show up in the open UI without a refresh, so both of the
# writes announce themselves on the `/events` stream. Emitted after the commit, never
# before: a note that was rolled back was never written.
EVENT_NOTE_CREATED = "note.created"
EVENT_NOTE_UPDATED = "note.updated"


class NoteNotFoundError(LookupError):
    """No note with that id."""


def save_note(
    session: Session,
    text: str,
    tags: Sequence[str] = (),
    *,
    game_id: int | None = None,
    fen: str | None = None,
) -> Note:
    """Write a coach note. `fen` is resolved to a Position; both anchors may be omitted.

    A FEN that no game has ever reached still gets its Position row: a note about a
    position is worth keeping before the owner has played it, and the row is what a later
    import joins onto.
    """
    body = text.strip()
    if not body:
        raise ValueError("a note needs text")

    position_id = None
    if fen:
        position_id = get_or_create_position(session, fen).id

    note = Note(
        text=body,
        tags=normalize_tags(tags),
        game_id=game_id,
        position_id=position_id,
    )
    session.add(note)
    session.commit()
    _announce(EVENT_NOTE_CREATED, note)
    return note


def get_note(session: Session, note_id: int) -> Note | None:
    """One note."""
    return session.get(Note, note_id)


def search_notes(
    session: Session,
    *,
    query: str | None = None,
    tags: Sequence[str] = (),
    since: datetime | None = None,
    until: datetime | None = None,
    game_id: int | None = None,
    fen: str | None = None,
    limit: int = 50,
) -> list[Note]:
    """Notes matching any combination of free text, tags, date and game. Newest first.

    Tags are AND-ed: asking for `["opening", "sicilian"]` means notes carrying both, which
    is what makes tags worth writing.
    """
    conditions: list[ColumnElement[bool]] = []
    if query:
        conditions.append(_contains(Note.text, query))
    if since is not None:
        conditions.append(Note.created_at >= since)
    if until is not None:
        conditions.append(Note.created_at <= until)
    if game_id is not None:
        conditions.append(Note.game_id == game_id)
    if fen:
        position = find_position(session, fen)
        if position is None:
            return []
        conditions.append(Note.position_id == position.id)

    statement = (
        select(Note)
        .where(*conditions)
        .order_by(Note.created_at.desc(), Note.id.desc())
        .limit(SCAN_LIMIT)
    )

    wanted = normalize_tags(tags)
    folded = {tag.casefold() for tag in wanted}
    found: list[Note] = []
    for note in session.scalars(statement):
        if folded and not folded <= {tag.casefold() for tag in note.tags or ()}:
            continue
        found.append(note)
        if limit and len(found) >= limit:
            break
    return found


def delete_note(session: Session, note_id: int) -> bool:
    """Remove a note. Returns whether there was one to remove."""
    note = session.get(Note, note_id)
    if note is None:
        return False
    session.delete(note)
    session.commit()
    return True


def update_note(
    session: Session,
    note_id: int,
    *,
    text: str | None = None,
    tags: Sequence[str] | None = None,
) -> Note:
    """Rewrite a note's text or tags. `updated_at` moves; `created_at` does not."""
    note = session.get(Note, note_id)
    if note is None:
        raise NoteNotFoundError(f"no note with id {note_id}")
    if text is not None:
        body = text.strip()
        if not body:
            raise ValueError("a note needs text")
        note.text = body
    if tags is not None:
        note.tags = normalize_tags(tags)
    session.commit()
    _announce(EVENT_NOTE_UPDATED, note)
    return note


def list_tags(session: Session) -> list[dict[str, Any]]:
    """Every tag in use with how often, so a new session can see what it wrote about."""
    counts: dict[str, int] = {}
    for (stored,) in session.execute(select(Note.tags)):
        for tag in stored or ():
            counts[tag] = counts.get(tag, 0) + 1
    return [
        {"tag": tag, "notes": count}
        for tag, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    ]


def normalize_tags(tags: Sequence[str]) -> list[str]:
    """Trimmed, de-duplicated, in the order they were given. Case is the writer's."""
    cleaned: list[str] = []
    seen: set[str] = set()
    for tag in tags or ():
        trimmed = str(tag).strip()
        folded = trimmed.casefold()
        if not trimmed or folded in seen:
            continue
        seen.add(folded)
        cleaned.append(trimmed)
    return cleaned


def note_payload(note: Note) -> dict[str, Any]:
    """One note as an API response or an MCP tool result."""
    return {
        "id": note.id,
        "text": note.text,
        "tags": list(note.tags or ()),
        "game_id": note.game_id,
        "position_id": note.position_id,
        "created_at": note.created_at.isoformat(),
        "updated_at": note.updated_at.isoformat(),
    }


def _announce(event: str, note: Note) -> None:
    """One note write on the `/events` stream, flat, the way every other event is shaped."""
    payload = note_payload(note)
    events_service.emit({"event": event, "note_id": payload.pop("id"), **payload})


def _contains(column: ColumnElement[str | None], value: str) -> ColumnElement[bool]:
    escaped = value.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return column.ilike(f"%{escaped}%", escape="\\")

"""`/notes` — the coach's memory: write it, search it, tag it, take it with you."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Query, Response, status
from sqlalchemy.orm import Session

from backend.api.deps import SessionDep, not_found
from backend.api.schemas import (
    NoteCreate,
    NoteResponse,
    NoteUpdate,
    TagCount,
)
from backend.services import notes as notes_service

router = APIRouter(prefix="/notes", tags=["notes"])

MAX_PAGE = 200
# An export is a document rather than a page of results, so it is not held to `MAX_PAGE`.
EXPORT_LIMIT = notes_service.SCAN_LIMIT


@router.get("", response_model=list[NoteResponse], summary="Search notes")
def search_notes(
    session: SessionDep,
    query: Annotated[str | None, Query(description="free text over the note")] = None,
    tags: Annotated[list[str] | None, Query(description="notes carrying every tag")] = None,
    since: datetime | None = None,
    until: datetime | None = None,
    game_id: int | None = None,
    fen: Annotated[str | None, Query(description="notes on this position")] = None,
    scope: Annotated[
        str | None, Query(description="game | position | line | free — which anchors it has")
    ] = None,
    line_id: Annotated[int | None, Query(description="notes on this variation")] = None,
    has_position: Annotated[
        bool | None, Query(description="only notes that know their position, or only those without")
    ] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE)] = 50,
) -> list[Any]:
    found = _found(
        session,
        query=query,
        tags=tags,
        since=since,
        until=until,
        game_id=game_id,
        fen=fen,
        scope=scope,
        line_id=line_id,
        has_position=has_position,
        limit=limit,
    )
    return [notes_service.note_payload(note) for note in found]


@router.post(
    "", response_model=NoteResponse, status_code=status.HTTP_201_CREATED, summary="Write a note"
)
def save_note(session: SessionDep, body: NoteCreate) -> Any:
    note = notes_service.save_note(
        session,
        body.text,
        body.tags,
        game_id=body.game_id,
        fen=body.fen,
        ply=body.ply,
        line_id=body.line_id,
        line=body.line.model_dump() if body.line is not None else None,
        source=body.source,
        from_live=body.from_live,
    )
    return notes_service.note_payload(note)


@router.get("/tags", response_model=list[TagCount], summary="Every tag in use")
def list_tags(session: SessionDep) -> list[Any]:
    return notes_service.list_tags(session)


@router.get(
    "/export",
    summary="Export notes as Markdown or PGN",
    response_class=Response,
    responses={200: {"content": {"text/markdown": {}, "application/x-chess-pgn": {}}}},
)
def export_notes(
    session: SessionDep,
    format: Annotated[str, Query(description="md | pgn")] = "md",
    query: str | None = None,
    tags: Annotated[list[str] | None, Query()] = None,
    since: datetime | None = None,
    until: datetime | None = None,
    game_id: int | None = None,
    fen: str | None = None,
    scope: str | None = None,
    line_id: int | None = None,
    has_position: bool | None = None,
) -> Response:
    """The notes the same filters would list, as a document to keep.

    Markdown for a person, PGN for a board program — the PGN carries every note as a
    comment at the ply it is about, with kept variations as real PGN variations.
    """
    fmt = format.strip().casefold()
    if fmt not in notes_service.EXPORT_FORMATS:
        raise ValueError(
            f"unknown format {format!r}; expected one of "
            f"{', '.join(sorted(notes_service.EXPORT_FORMATS))}"
        )
    found = _found(
        session,
        query=query,
        tags=tags,
        since=since,
        until=until,
        game_id=game_id,
        fen=fen,
        scope=scope,
        line_id=line_id,
        has_position=has_position,
        limit=EXPORT_LIMIT,
    )
    media_type, filename = notes_service.EXPORT_FORMATS[fmt]
    body = notes_service.export_notes(session, found, fmt=fmt)
    return Response(
        content=body,
        media_type=media_type,
        headers={"content-disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{note_id}", response_model=NoteResponse, summary="One note")
def get_note(session: SessionDep, note_id: int) -> Any:
    note = notes_service.get_note(session, note_id)
    if note is None:
        raise not_found("unknown_note", f"no note with id {note_id}")
    return notes_service.note_payload(note)


@router.patch("/{note_id}", response_model=NoteResponse, summary="Rewrite a note")
def update_note(session: SessionDep, note_id: int, body: NoteUpdate) -> Any:
    note = notes_service.update_note(session, note_id, text=body.text, tags=body.tags)
    return notes_service.note_payload(note)


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Forget a note")
def delete_note(session: SessionDep, note_id: int) -> Response:
    if not notes_service.delete_note(session, note_id):
        raise not_found("unknown_note", f"no note with id {note_id}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _found(
    session: Session,
    *,
    query: str | None,
    tags: list[str] | None,
    since: datetime | None,
    until: datetime | None,
    game_id: int | None,
    fen: str | None,
    scope: str | None,
    line_id: int | None,
    has_position: bool | None,
    limit: int,
) -> list[Any]:
    """The one filter vocabulary, shared by the listing and the export."""
    return notes_service.search_notes(
        session,
        query=query,
        tags=tags or (),
        since=since,
        until=until,
        game_id=game_id,
        fen=fen,
        scope=scope,
        line_id=line_id,
        has_position=has_position,
        limit=limit,
    )

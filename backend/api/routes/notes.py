"""`/notes` — the coach's memory: write it, search it, tag it."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Query, Response, status

from backend.api.deps import SessionDep, not_found
from backend.api.schemas import NoteCreate, NoteResponse, NoteUpdate, TagCount
from backend.services import notes as notes_service

router = APIRouter(prefix="/notes", tags=["notes"])

MAX_PAGE = 200


@router.get("", response_model=list[NoteResponse], summary="Search notes")
def search_notes(
    session: SessionDep,
    query: Annotated[str | None, Query(description="free text over the note")] = None,
    tags: Annotated[list[str] | None, Query(description="notes carrying every tag")] = None,
    since: datetime | None = None,
    until: datetime | None = None,
    game_id: int | None = None,
    fen: Annotated[str | None, Query(description="notes on this position")] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE)] = 50,
) -> list[Any]:
    found = notes_service.search_notes(
        session,
        query=query,
        tags=tags or (),
        since=since,
        until=until,
        game_id=game_id,
        fen=fen,
        limit=limit,
    )
    return [notes_service.note_payload(note) for note in found]


@router.post(
    "", response_model=NoteResponse, status_code=status.HTTP_201_CREATED, summary="Write a note"
)
def save_note(session: SessionDep, body: NoteCreate) -> Any:
    note = notes_service.save_note(
        session, body.text, body.tags, game_id=body.game_id, fen=body.fen
    )
    return notes_service.note_payload(note)


@router.get("/tags", response_model=list[TagCount], summary="Every tag in use")
def list_tags(session: SessionDep) -> list[Any]:
    return notes_service.list_tags(session)


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

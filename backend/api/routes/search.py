"""`/search` — the one box: games, opponents, openings and notes at once."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Query

from backend.api.deps import SessionDep
from backend.api.schemas import SearchResponse
from backend.services import search as search_service

router = APIRouter(prefix="/search", tags=["search"])

MAX_PER_GROUP = 20


@router.get("", response_model=SearchResponse, summary="Search everything")
def search(
    session: SessionDep,
    q: Annotated[str, Query(description="free text over games, opponents, openings and notes")],
    limit: Annotated[int, Query(ge=1, le=MAX_PER_GROUP, description="per group")] = 5,
) -> Any:
    """What the query touches, in four groups, newest or most played first.

    A query shorter than two characters answers with four empty groups: the box is typed
    into rather than submitted, and the first letter is not something to complain about.
    """
    return search_service.global_search(session, q, limit=limit)

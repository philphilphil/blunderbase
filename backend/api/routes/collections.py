"""`/collections` — named groups of games, and the games in them.

Thin, like every router here: each handler hands its body to `services.collections` and
shapes the answer. Filtering the library, Stats or the explorer by a collection is not
here at all — it is the `collection` query parameter those routes already take through the
shared filter vocabulary. Membership changes answer with how many games moved and the
collection as it now reads, so the writing tab can tell from the response whether any game
moved — and what to refresh — without a second request.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response, status

from backend.api.deps import SessionDep
from backend.api.schemas import (
    CollectionCreate,
    CollectionDetail,
    CollectionGames,
    CollectionGamesAdded,
    CollectionGamesRemoved,
    CollectionList,
    CollectionResponse,
    CollectionRule,
    CollectionUpdate,
)
from backend.services import collections as collections_service

router = APIRouter(prefix="/collections", tags=["collections"])


def _rule(rule: CollectionRule | None) -> dict[str, Any] | None:
    return rule.model_dump(mode="json", exclude_none=True) if rule is not None else None


@router.get(
    "",
    response_model=CollectionList,
    # A row without a summary goes out without the key rather than with a null: the plain
    # list is exactly what it was, and `summary` only appears for a caller that asked.
    response_model_exclude_unset=True,
    summary="Every collection",
)
def list_collections(session: SessionDep, with_summary: bool = False) -> Any:
    """By name, regardless of case, each with how many games it holds.

    `with_summary=true` adds each one's score line, the one `GET /collections/{id}` leads
    with — for the Collections screen, which shows every collection's at once.
    """
    return {
        "collections": collections_service.list_payloads(session, with_summary=with_summary)
    }


@router.post(
    "",
    response_model=CollectionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Make a collection",
)
def create_collection(session: SessionDep, body: CollectionCreate) -> Any:
    """A 409 `name_taken` when another collection has the name in any case."""
    collection = collections_service.create_collection(
        session,
        name=body.name,
        color=body.color,
        description=body.description,
        rule=_rule(body.rule),
        apply_to_existing=body.apply_to_existing,
        game_ids=body.game_ids,
    )
    return collections_service.payload(session, collection)


@router.get(
    "/{collection_id}",
    response_model=CollectionDetail,
    summary="One collection with its score line",
)
def get_collection(session: SessionDep, collection_id: int) -> Any:
    return collections_service.detail_payload(session, collection_id)


@router.patch("/{collection_id}", response_model=CollectionResponse, summary="Change a collection")
def update_collection(session: SessionDep, collection_id: int, body: CollectionUpdate) -> Any:
    """Only the keys the body carries change; `rule: null` takes the rule away.

    Which keys were *sent* is the whole question here, so it is read off the body rather
    than off its values: a missing `rule` and a `rule` of null are different requests.
    """
    sent = body.model_fields_set
    changes: dict[str, Any] = {}
    if "name" in sent:
        changes["name"] = body.name
    if "color" in sent:
        changes["color"] = body.color
    if "description" in sent:
        changes["description"] = body.description
    if "rule" in sent:
        changes["rule"] = _rule(body.rule)
    collection = collections_service.update_collection(session, collection_id, **changes)
    return collections_service.payload(session, collection)


@router.delete(
    "/{collection_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a collection"
)
def delete_collection(session: SessionDep, collection_id: int) -> Response:
    """The collection and its memberships go; every game in it stays where it is."""
    collections_service.delete_collection(session, collection_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{collection_id}/games",
    response_model=CollectionGamesAdded,
    summary="Put games in a collection",
)
def add_games(session: SessionDep, collection_id: int, body: CollectionGames) -> Any:
    """A game already in it is a no-op and an unknown id is ignored; `added` is what moved."""
    added = collections_service.add_games(session, collection_id, body.game_ids)
    collection = collections_service.get_collection(session, collection_id)
    return {"added": added, "collection": collections_service.payload(session, collection)}


@router.post(
    "/{collection_id}/games/remove",
    response_model=CollectionGamesRemoved,
    summary="Take games out of a collection",
)
def remove_games(session: SessionDep, collection_id: int, body: CollectionGames) -> Any:
    """A POST for the reason `/games/delete` is one: the ids travel in the body.

    Taking a game out sticks — a rule only looks at games as they are imported.
    """
    removed = collections_service.remove_games(session, collection_id, body.game_ids)
    collection = collections_service.get_collection(session, collection_id)
    return {"removed": removed, "collection": collections_service.payload(session, collection)}


@router.post(
    "/{collection_id}/apply-rule",
    response_model=CollectionGamesAdded,
    summary="Run a collection's rule over the games already here",
)
def apply_rule(session: SessionDep, collection_id: int) -> Any:
    """Once, now. A collection without a rule is a 422 `no_rule`."""
    added = collections_service.apply_rule(session, collection_id)
    collection = collections_service.get_collection(session, collection_id)
    return {"added": added, "collection": collections_service.payload(session, collection)}

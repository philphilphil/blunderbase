"""`/engines` — Settings → Engines: register a binary, probe it, test-run it.

Every write path probes the process, so a bad binary is rejected here rather than at
analysis time. `/engines/roles` is the other half of that promise: it is where the owner
says which engine does Quick, which does Deep and which answers for human moves, and it
says in words why a role cannot run — which is what the UI shows instead of failing a run
later. Nothing falls back, so an unassigned or unavailable role is a sentence here rather
than a surprise engine at analysis time. `/engines/tiers` is the same answer narrowed to
the two tiers, for a caller that only has a `Tier` in hand.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, status

from backend.api.deps import SessionDep, not_found
from backend.api.schemas import (
    EngineCreate,
    EngineDeleteResponse,
    EngineResponse,
    EngineRoles,
    EngineRolesResponse,
    EngineUpdate,
    ProbeRequest,
    ProbeResponse,
    SampleRequest,
    SampleResponse,
    TierStatusResponse,
)
from backend.db.enums import EngineRole, Tier
from backend.services import engines as engines_service

router = APIRouter(prefix="/engines", tags=["engines"])


@router.get("", response_model=list[EngineResponse], summary="Every configured engine")
def list_engines(session: SessionDep, enabled_only: bool = False) -> list[Any]:
    return engines_service.list_engines(session, enabled_only=enabled_only)


@router.post(
    "", response_model=EngineResponse, status_code=status.HTTP_201_CREATED, summary="Add an engine"
)
def add_engine(session: SessionDep, body: EngineCreate) -> Any:
    """Probes the binary and validates the options against what it declares."""
    return engines_service.add_engine(
        session,
        name=body.name,
        path=body.path,
        kind=body.kind,
        options=body.options,
        enabled=body.enabled,
    )


@router.post("/probe", response_model=ProbeResponse, summary="Ask a binary what it is")
def probe(body: ProbeRequest) -> Any:
    """Start a binary, read its name and declared options, stop it. Nothing is stored."""
    return engines_service.probe_engine(body.path, body.kind).as_dict()


@router.get("/tiers", response_model=list[TierStatusResponse], summary="What each tier can do")
def tiers(session: SessionDep) -> list[Any]:
    return [engines_service.tier_status(session, tier).as_dict() for tier in Tier]


@router.get("/roles", response_model=EngineRolesResponse, summary="What runs what")
def roles(session: SessionDep) -> Any:
    """Every role in one read: the two tiers, and human moves beside them.

    Supersedes `/tiers` for anything that draws the whole picture. `/tiers` still answers
    the narrower, tier-typed question, and a caller that only has a `Tier` in hand wants
    that one.
    """
    return {
        "roles": [engines_service.role_status(session, role).as_dict() for role in EngineRole]
    }


@router.put("/roles", response_model=EngineRolesResponse, summary="Assign the roles")
def set_roles(session: SessionDep, body: EngineRoles) -> Any:
    """Choose the engine for a role. A key that was not sent is left alone; `null` unassigns.

    An id that names nothing, or an engine of a kind the role cannot use, is refused whole
    — nothing is written — because a half-applied assignment is a deployment whose roles
    disagree with the form that saved them.
    """
    wanted = {EngineRole(name): engine_id for name, engine_id in body.changes().items()}
    statuses = engines_service.set_role_engines(session, wanted)
    return {"roles": [status.as_dict() for status in statuses]}


@router.get("/{engine_id}", response_model=EngineResponse, summary="One engine")
def get_engine(session: SessionDep, engine_id: int) -> Any:
    return engines_service.require_engine(session, engine_id)


@router.patch("/{engine_id}", response_model=EngineResponse, summary="Edit an engine")
def update_engine(session: SessionDep, engine_id: int, body: EngineUpdate) -> Any:
    """Only the fields that were sent change; a new path or new options re-probe."""
    return engines_service.update_engine(session, engine_id, **body.changes())


@router.delete("/{engine_id}", response_model=EngineDeleteResponse, summary="Remove an engine")
def delete_engine(session: SessionDep, engine_id: int) -> Any:
    ok, unqueued = engines_service.delete_engine(session, engine_id)
    if not ok:
        raise not_found("unknown_engine", f"no engine with id {engine_id}")
    return {"unqueued": unqueued}


@router.post("/{engine_id}/test-run", response_model=SampleResponse, summary="Test-run an engine")
def test_run(session: SessionDep, engine_id: int, body: SampleRequest | None = None) -> Any:
    """One position through this engine, disabled or not — the point is to decide."""
    request = body or SampleRequest()
    return engines_service.sample_eval(
        session,
        engine_id,
        request.fen,
        nodes=request.nodes,
        multipv=request.multipv,
        ratings=request.ratings,
    )

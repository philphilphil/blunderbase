"""`/engines` — Settings → Engines: register a binary, probe it, test-run it.

Every write path probes the process, so a bad binary is rejected here rather than at
analysis time. `/engines/tiers` is the other half of that promise: it says in words why a
tier cannot run, which is what the UI shows instead of failing a run later.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response, status

from backend.api.deps import SessionDep, not_found
from backend.api.schemas import (
    EngineCreate,
    EngineResponse,
    EngineUpdate,
    ProbeRequest,
    ProbeResponse,
    SampleRequest,
    SampleResponse,
    TierStatusResponse,
)
from backend.db.enums import Tier
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
        default_tier=body.default_tier,
        enabled=body.enabled,
    )


@router.post("/probe", response_model=ProbeResponse, summary="Ask a binary what it is")
def probe(body: ProbeRequest) -> Any:
    """Start a binary, read its name and declared options, stop it. Nothing is stored."""
    return engines_service.probe_engine(body.path, body.kind).as_dict()


@router.get("/tiers", response_model=list[TierStatusResponse], summary="What each tier can do")
def tiers(session: SessionDep) -> list[Any]:
    return [engines_service.tier_status(session, tier).as_dict() for tier in Tier]


@router.get("/{engine_id}", response_model=EngineResponse, summary="One engine")
def get_engine(session: SessionDep, engine_id: int) -> Any:
    return engines_service.require_engine(session, engine_id)


@router.patch("/{engine_id}", response_model=EngineResponse, summary="Edit an engine")
def update_engine(session: SessionDep, engine_id: int, body: EngineUpdate) -> Any:
    """Only the fields that were sent change; a new path or new options re-probe."""
    return engines_service.update_engine(session, engine_id, **body.changes())


@router.delete(
    "/{engine_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Remove an engine"
)
def delete_engine(session: SessionDep, engine_id: int) -> Response:
    if not engines_service.delete_engine(session, engine_id):
        raise not_found("unknown_engine", f"no engine with id {engine_id}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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

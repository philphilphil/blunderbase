"""`/stats` — the aggregation dashboards, the profile and the worst recent moments."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Query

from backend.api.deps import FiltersDep, SessionDep
from backend.api.schemas import (
    ComparisonResponse,
    DimensionList,
    MomentResponse,
    ProfileResponse,
    StatsDashboardResponse,
    StatsResponse,
)
from backend.services import stats as stats_service

router = APIRouter(prefix="/stats", tags=["stats"])

MAX_MOMENTS = 100


@router.get("/dimensions", response_model=DimensionList, summary="What can be aggregated")
def list_dimensions() -> DimensionList:
    """The dimensions that work, and the ones the spec names but nothing computes yet."""
    return DimensionList(
        dimensions=list(stats_service.DIMENSIONS), planned=list(stats_service.PLANNED_DIMENSIONS)
    )


@router.get("/profile", response_model=ProfileResponse, summary="Ratings, volume, platforms")
def profile(session: SessionDep) -> Any:
    return stats_service.get_player_profile(session)


@router.get(
    "/dashboard",
    response_model=StatsDashboardResponse,
    summary="Every Stats-page aggregation over one anchored window",
)
def dashboard(
    session: SessionDep,
    filters: FiltersDep,
    days: Annotated[int | None, Query(ge=1, le=3650)] = None,
) -> Any:
    """Anchor once at the newest matching game and aggregate every card in one read."""
    return stats_service.get_dashboard(session, days=days, filters=filters)


@router.get(
    "/worst-moments", response_model=list[MomentResponse], summary="What should I train?"
)
def worst_moments(
    session: SessionDep,
    filters: FiltersDep,
    days: Annotated[int | None, Query(ge=1, description="only games this recent")] = None,
    amount: Annotated[int, Query(ge=1, le=MAX_MOMENTS)] = 5,
) -> list[Any]:
    """Recent blunders ranked by the win percentage they gave away."""
    return stats_service.get_worst_recent_moments(
        session, days=days, amount=amount, filters=filters
    )


@router.get("/compare", response_model=ComparisonResponse, summary="Am I getting better at X?")
def compare(
    session: SessionDep,
    filters: FiltersDep,
    dimension: str,
    then_start: datetime,
    then_end: datetime,
    now_start: datetime,
    now_end: datetime,
) -> Any:
    """The same dimension over two windows, with the delta between them."""
    return stats_service.compare_periods(
        session,
        dimension,
        (then_start, then_end),
        (now_start, now_end),
        filters=filters,
    )


@router.get("/{dimension}", response_model=StatsResponse, summary="One aggregation")
def get_stats(session: SessionDep, filters: FiltersDep, dimension: str) -> Any:
    """`filters` narrows the games the aggregation reads, exactly as `/games` narrows them."""
    return stats_service.get_stats(session, dimension, filters=filters)

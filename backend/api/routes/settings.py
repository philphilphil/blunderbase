"""`/settings` — analysis configuration shared by the focused UI pages.

Eleven settings live here: the Maia levels (a list of one to five), the three 0/1 flags
over the Maia pass itself, the two node budgets and the deep line count, and the three
classification thresholds. They are stored settings rather than environment variables
because they are the ones an owner changes as their play changes, and a restart is not a
thing to ask of them for that. `services/app_settings.py` owns what they mean; this is the
form's two calls over it.

A PUT is the whole of the settings, not a patch: a field sent as null — or left out, or an
empty body — clears that setting back to its default. A value outside what a setting can
mean is clamped rather than refused, so the answer to a PUT is what is actually in force,
which is not always what was sent. The exception is a set of classification thresholds
that does not rise, which is refused whole with a 422 the page shows against the form.

`/settings/tour` is here too, and is none of that: one flag saying whether the owner has
been through the orientation tour. It hangs off this prefix because it is stored the way
these are and read by nobody else, and it keeps its own pair of routes because the PUT
above rewrites every key it names — a flag about the person has no business being cleared
by a save of a node budget.
"""

from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy.orm import Session

from backend.api.deps import SessionDep
from backend.api.schemas import AppSettings, AppSettingsUpdate, TourState, TourUpdate
from backend.services import app_settings as app_settings_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=AppSettings, summary="Analysis configuration")
def get_settings(session: SessionDep) -> AppSettings:
    return _answer(session, app_settings_service.read(session))


@router.put("", response_model=AppSettings, summary="Change the settings")
def put_settings(session: SessionDep, body: AppSettingsUpdate) -> AppSettings:
    """Answers with what is in force afterwards — the clamped values, or null once cleared.

    The Maia levels are written by their own call, because they are a list rather than one
    of the numbers `replace` handles. A body that names `maia_elos` sets them; one that names
    only the older `maia_target_elo` asks for that single level, which is what it always
    meant; one that names neither clears them back to the default, exactly as a PUT clears
    every other setting it leaves out.
    """
    values = body.model_dump()
    thresholds = {key: values.get(key) for key in app_settings_service.KEYS}
    stored = app_settings_service.replace(session, thresholds)
    if body.maia_elos is not None:
        app_settings_service.set_maia_elos(session, body.maia_elos)
    elif body.maia_target_elo is not None:
        app_settings_service.set_maia_elos(session, [body.maia_target_elo])
    else:
        app_settings_service.set_maia_elos(session, None)
    return _answer(session, stored)


@router.get("/tour", response_model=TourState, summary="Has the owner seen the tour")
def get_tour(session: SessionDep) -> TourState:
    return TourState(seen=app_settings_service.get_tour_seen(session))


@router.put("/tour", response_model=TourState, summary="Record the tour as seen, or replay it")
def put_tour(session: SessionDep, body: TourUpdate) -> TourState:
    """`seen: false` is "Show the tour again" — the row goes rather than holding a 0."""
    return TourState(seen=app_settings_service.set_tour_seen(session, body.seen))


def _answer(session: Session, values: dict[str, int | float | None]) -> AppSettings:
    """The stored settings as the page reads them.

    The plain numbers answer with the row: null is the page's cue to show the default under
    an empty box. The Maia levels answer with what is in force instead, because there is no
    such thing as a deployment that asks Maia at no rating — cleared, they are pinned to the
    default rather than to a behaviour of their own.
    """
    elos = app_settings_service.get_maia_elos(session)
    return AppSettings(
        **{
            **values,
            app_settings_service.MAIA_TARGET_ELO: elos[0],
            app_settings_service.MAIA_ELOS: elos,
        }
    )

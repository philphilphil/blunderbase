"""`/settings` — analysis configuration shared by the focused UI pages.

Everything the focused pages edit lives here: the Maia levels (a list of one to five), the
three 0/1 flags over the Maia pass itself, the two node budgets and the deep line count,
the three classification thresholds, and the five that correspondence mode is configured
with — whether it exists at all, the default reply window, how many lines a search keeps,
how many searches this host runs at once, and which engines the search picker offers (the
second list here, written like the Maia levels). They
are stored settings rather than environment variables
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
    # The correspondence picker's engines are the other list here, and are written the same
    # way and for the same reason: a body that names them sets them, and one that does not
    # clears them — a PUT is the whole of the settings.
    app_settings_service.set_correspondence_search_engine_ids(
        session, body.correspondence_search_engine_ids
    )
    # And the task engine is the third value outside `replace`, written the same way and
    # for the same reason: an engine id has no clamp, so a PUT that names one sets it and
    # one that does not clears it back to "whichever engine holds the deep role".
    app_settings_service.set_correspondence_task_engine_id(
        session, body.correspondence_task_engine_id
    )
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
            # The engines chosen for correspondence searches answer with the row, empty
            # list and all: empty is a real state there — every eligible engine — rather
            # than a default standing in for one.
            app_settings_service.CORRESPONDENCE_SEARCH_ENGINE_IDS: (
                app_settings_service.get_correspondence_search_engine_ids(session)
            ),
            # Null here is a real state and not a missing one: no engine has been chosen
            # for tasks, and whichever engine holds the deep role runs them.
            app_settings_service.CORRESPONDENCE_TASK_ENGINE_ID: (
                app_settings_service.get_correspondence_task_engine_id(session)
            ),
        }
    )

"""`/settings` — the deployment's own settings, as opposed to its engines.

Eight numbers live here: the Maia target elo, the two node budgets and the deep line
count, the three classification thresholds, and the rating to fall back on when a game
carries none. They are stored settings rather than environment variables because they are
the ones an owner changes as their play changes, and a restart is not a thing to ask of
them for that. `services/app_settings.py` owns what they mean; this is the form's two
calls over it.

A PUT is the whole of the settings, not a patch: a field sent as null — or left out, or an
empty body — clears that setting back to its default. A value outside what a setting can
mean is clamped rather than refused, so the answer to a PUT is what is actually in force,
which is not always what was sent. The exception is a set of classification thresholds
that does not rise, which is refused whole with a 422 the page shows against the form.
"""

from __future__ import annotations

from fastapi import APIRouter

from backend.api.deps import SessionDep
from backend.api.schemas import AppSettings, AppSettingsUpdate
from backend.services import app_settings as app_settings_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=AppSettings, summary="Everything the Settings page shows")
def get_settings(session: SessionDep) -> AppSettings:
    return AppSettings(**app_settings_service.read(session))


@router.put("", response_model=AppSettings, summary="Change the settings")
def put_settings(session: SessionDep, body: AppSettingsUpdate) -> AppSettings:
    """Answers with what is in force afterwards — the clamped values, or null once cleared."""
    return AppSettings(**app_settings_service.replace(session, body.model_dump()))

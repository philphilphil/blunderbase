"""`/settings` — the deployment's own settings, as opposed to its engines.

One number lives here so far: the Maia target elo. It is a stored setting rather than an
environment variable because it is the one piece of configuration an owner changes as
their play changes, and a restart is not a thing to ask of them for that. `services/
app_settings.py` owns what it means; this is the form's two calls over it.

A PUT is the whole of the settings, not a patch: `maia_target_elo: null` — or an empty
body — is how the page clears the target and puts Maia back on its rating-centred
behaviour. A value outside what Maia was trained on is clamped rather than refused, so the
answer to a PUT is what is actually in force, which is not always what was sent.
"""

from __future__ import annotations

from fastapi import APIRouter

from backend.api.deps import SessionDep
from backend.api.schemas import AppSettings, AppSettingsUpdate
from backend.services import app_settings as app_settings_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=AppSettings, summary="Everything the Settings page shows")
def get_settings(session: SessionDep) -> AppSettings:
    return AppSettings(maia_target_elo=app_settings_service.get_maia_target_elo(session))


@router.put("", response_model=AppSettings, summary="Change the settings")
def put_settings(session: SessionDep, body: AppSettingsUpdate) -> AppSettings:
    """Answers with what is in force afterwards — the clamped value, or null once cleared."""
    return AppSettings(
        maia_target_elo=app_settings_service.set_maia_target_elo(session, body.maia_target_elo)
    )

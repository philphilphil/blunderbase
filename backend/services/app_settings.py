"""The handful of settings the owner changes from the Settings page.

Everything else Blunderbase is configured with is an environment variable read once at
boot (`backend/config.py`). These are not: they are the ones a person changes while the
app is running and expects to take effect on the next thing they click, so they live in
the database and are read where they are used rather than cached in the process.

Right now there is exactly one of them.

**The Maia target elo.** The single rating every Maia question is asked at — the rating
the owner is playing towards, not the one they have. Set, it replaces
`Settings.maia_rating_offsets` everywhere: batch analysis bakes that level into every ply
of both sides, and the analysis board's live queries use it too. Cleared, Maia goes back
to the rating-centred behaviour over the owner's own moves, which is what an install that
never opened the Settings page gets.

A value outside what Maia was trained on is clamped, never refused — the same rule the
per-game levels have always followed (`analysis.maia_levels`). An owner aiming at 2200
gets Maia's top level rather than a form that will not save. A build declaring narrower
`SelfElo` bounds narrows this further at analysis time.

The reads here are a single-row primary-key lookup on a local database, which is why every
call site does one per request or per plan instead of holding a copy: a setting that took
effect on the next restart would not be a setting anyone could use.
"""

from __future__ import annotations

from sqlalchemy import delete
from sqlalchemy.orm import Session

from backend.config import MAIA_MAX_RATING, MAIA_MIN_RATING
from backend.db.models import AppSetting

MAIA_TARGET_ELO = "maia_target_elo"


def clamp_maia_target_elo(value: int) -> int:
    """A target elo brought inside what Maia was trained on."""
    return min(MAIA_MAX_RATING, max(MAIA_MIN_RATING, int(value)))


def get_maia_target_elo(session: Session) -> int | None:
    """The configured level, or None for the rating-centred behaviour.

    Clamped on the way out as well as on the way in: the row is a JSON value in a database
    a person can open, and no caller of this should have to defend itself against one that
    was edited by hand.
    """
    row = session.get(AppSetting, MAIA_TARGET_ELO)
    if row is None:
        return None
    value = row.value
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return clamp_maia_target_elo(int(value))


def set_maia_target_elo(session: Session, value: int | None) -> int | None:
    """Store the level, or clear it. Returns what is in force afterwards.

    None deletes the row rather than writing a null, because "the owner has not chosen"
    and "the owner chose nothing" have to stay the same state — there is one fallback and
    it is the absence of a row.
    """
    if value is None:
        session.execute(delete(AppSetting).where(AppSetting.key == MAIA_TARGET_ELO))
        session.commit()
        return None

    level = clamp_maia_target_elo(value)
    row = session.get(AppSetting, MAIA_TARGET_ELO)
    if row is None:
        session.add(AppSetting(key=MAIA_TARGET_ELO, value=level))
    else:
        row.value = level
    session.commit()
    return level

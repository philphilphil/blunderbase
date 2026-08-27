"""The handful of settings the owner changes from the Settings page.

Everything else Blunderbase is configured with is an environment variable read once at
boot (`backend/config.py`). These are not: they are the ones a person changes while the
app is running and expects to take effect on the next thing they click, so they live in
the database and are read where they are used rather than cached in the process.

There are eight of them, in four groups.

**The Maia target elo.** The single rating every Maia question is asked at — the rating
the owner is playing towards, not the one they have. Set, batch analysis bakes that level
into every ply of both sides and the analysis board's live queries use it too. Cleared,
Maia goes back to a single level centred on the owner's rating in the game being analysed,
over their own moves only, which is what an install that never opened the Settings page
gets.

**The analysis budgets** — `quick_nodes`, `deep_nodes`, `deep_multipv`. What one position
costs in each tier, and how many lines a deep run keeps. Read when a run is enqueued, so
they are the budget of the *next* run rather than of every run ever queued.

**The classification thresholds** — `inaccuracy`, `mistake`, `blunder`, in win-percentage
points lost by the mover. Read per plan, which means a game re-analysed after they moved
is judged by the new ones and one analysed before it keeps what it was judged by.

**The default owner rating.** The rating to centre Maia on when the game itself carries
none — an OTB PGN, an unrated game — and the level the live board falls back to.

A value outside what a setting can mean is clamped, never refused: an owner aiming at 2200
gets Maia's top level rather than a form that will not save. The one exception is the
ordering of the three thresholds, because there is no clamp that rescues an inaccuracy
that costs more than a blunder — a set of them that does not rise is refused whole
(`replace`).

The reads here are single-row primary-key lookups on a local database, which is why every
call site does one per request or per plan instead of holding a copy: a setting that took
effect on the next restart would not be a setting anyone could use.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from backend.config import MAIA_MAX_RATING, MAIA_MIN_RATING
from backend.db.models import AppSetting

# --- the keys -------------------------------------------------------------

MAIA_TARGET_ELO = "maia_target_elo"
QUICK_NODES = "quick_nodes"
DEEP_NODES = "deep_nodes"
DEEP_MULTIPV = "deep_multipv"
INACCURACY_THRESHOLD = "inaccuracy_threshold"
MISTAKE_THRESHOLD = "mistake_threshold"
BLUNDER_THRESHOLD = "blunder_threshold"
DEFAULT_OWNER_RATING = "default_owner_rating"

# --- what each one falls back to, and what it may be ----------------------

QUICK_NODES_DEFAULT = 250_000
DEEP_NODES_DEFAULT = 2_000_000
DEEP_MULTIPV_DEFAULT = 4
INACCURACY_DEFAULT = 10.0
MISTAKE_DEFAULT = 20.0
BLUNDER_DEFAULT = 30.0
OWNER_RATING_DEFAULT = 1500

# A budget of no nodes at all is not a cheaper pass, it is no pass; there is deliberately
# no ceiling, because how long the owner is willing to wait is theirs to decide.
MIN_NODES = 1
MIN_MULTIPV = 1
MAX_MULTIPV = 10
# The thresholds are win percentage, which is the whole of the scale.
MIN_THRESHOLD = 0.0
MAX_THRESHOLD = 100.0
MIN_OWNER_RATING = 1


class SettingsError(ValueError):
    """A change to the settings that is not a coherent set of them."""


@dataclass(frozen=True, slots=True)
class Setting:
    """One stored number: what it falls back to, and the range it is pulled into."""

    key: str
    # None where the absence of a row is itself the behaviour, as it is for the target elo.
    default: int | float | None
    low: int | float
    high: int | float | None
    whole: bool

    def clamp(self, value: int | float) -> int | float:
        """The value brought inside what this setting can mean."""
        pulled = max(self.low, value if self.high is None else min(self.high, value))
        return int(pulled) if self.whole else float(pulled)


SETTINGS: tuple[Setting, ...] = (
    Setting(
        key=MAIA_TARGET_ELO,
        default=None,
        low=MAIA_MIN_RATING,
        high=MAIA_MAX_RATING,
        whole=True,
    ),
    Setting(key=QUICK_NODES, default=QUICK_NODES_DEFAULT, low=MIN_NODES, high=None, whole=True),
    Setting(key=DEEP_NODES, default=DEEP_NODES_DEFAULT, low=MIN_NODES, high=None, whole=True),
    Setting(
        key=DEEP_MULTIPV,
        default=DEEP_MULTIPV_DEFAULT,
        low=MIN_MULTIPV,
        high=MAX_MULTIPV,
        whole=True,
    ),
    Setting(
        key=INACCURACY_THRESHOLD,
        default=INACCURACY_DEFAULT,
        low=MIN_THRESHOLD,
        high=MAX_THRESHOLD,
        whole=False,
    ),
    Setting(
        key=MISTAKE_THRESHOLD,
        default=MISTAKE_DEFAULT,
        low=MIN_THRESHOLD,
        high=MAX_THRESHOLD,
        whole=False,
    ),
    Setting(
        key=BLUNDER_THRESHOLD,
        default=BLUNDER_DEFAULT,
        low=MIN_THRESHOLD,
        high=MAX_THRESHOLD,
        whole=False,
    ),
    Setting(
        key=DEFAULT_OWNER_RATING,
        default=OWNER_RATING_DEFAULT,
        low=MIN_OWNER_RATING,
        high=None,
        whole=True,
    ),
)

BY_KEY: dict[str, Setting] = {setting.key: setting for setting in SETTINGS}
KEYS: tuple[str, ...] = tuple(BY_KEY)

# The three that are only meaningful as a rising set, in the order they have to rise in.
THRESHOLD_KEYS = (INACCURACY_THRESHOLD, MISTAKE_THRESHOLD, BLUNDER_THRESHOLD)


# --- reading --------------------------------------------------------------


def stored(session: Session, key: str) -> int | float | None:
    """What is stored under `key`, or None because nobody has set it.

    Clamped on the way out as well as on the way in: the row is a JSON value in a database
    a person can open, and no caller of this should have to defend itself against one that
    was edited by hand.
    """
    row = session.get(AppSetting, key)
    return _clean(BY_KEY[key], None if row is None else row.value)


def read(session: Session) -> dict[str, int | float | None]:
    """Every setting as it is stored — None for each one nobody has set."""
    rows = {row.key: row.value for row in session.scalars(select(AppSetting))}
    return {key: _clean(BY_KEY[key], rows.get(key)) for key in KEYS}


def get_maia_target_elo(session: Session) -> int | None:
    """The configured level, or None for the rating-centred behaviour."""
    value = stored(session, MAIA_TARGET_ELO)
    return None if value is None else int(value)


def get_quick_nodes(session: Session) -> int:
    """The node budget of a quick pass, as the next run enqueued will carry it."""
    value = stored(session, QUICK_NODES)
    return QUICK_NODES_DEFAULT if value is None else int(value)


def get_deep_nodes(session: Session) -> int:
    value = stored(session, DEEP_NODES)
    return DEEP_NODES_DEFAULT if value is None else int(value)


def get_deep_multipv(session: Session) -> int:
    value = stored(session, DEEP_MULTIPV)
    return DEEP_MULTIPV_DEFAULT if value is None else int(value)


def get_thresholds(session: Session) -> tuple[float, float, float]:
    """The three classification thresholds in force, in the order they rise."""
    values = read(session)
    inaccuracy, mistake, blunder = (_or_default(values, key) for key in THRESHOLD_KEYS)
    return inaccuracy, mistake, blunder


def get_default_owner_rating(session: Session) -> int:
    """The rating to centre Maia on when the game itself carries none."""
    value = stored(session, DEFAULT_OWNER_RATING)
    return OWNER_RATING_DEFAULT if value is None else int(value)


def _or_default(values: Mapping[str, int | float | None], key: str) -> float:
    """One threshold as it would be in force: the value given, else the key's default.

    Only ever asked about the three thresholds, and every one of those has a default; the
    trailing `or 0.0` is there for the type, not for a case that happens.
    """
    value = values.get(key)
    return float((BY_KEY[key].default if value is None else value) or 0.0)


# --- writing --------------------------------------------------------------


def set_value(session: Session, key: str, value: int | float | None) -> int | float | None:
    """Store one setting, or clear it. Returns what is in force afterwards.

    None deletes the row rather than writing a null, because "the owner has not chosen"
    and "the owner chose nothing" have to stay the same state — there is one fallback and
    it is the absence of a row.

    This is the single-value primitive; the rule that the three thresholds rise belongs to
    a write that knows all three, which is `replace`.
    """
    setting = BY_KEY[key]
    if value is None:
        session.execute(delete(AppSetting).where(AppSetting.key == key))
        session.commit()
        return None

    pulled = setting.clamp(value)
    row = session.get(AppSetting, key)
    if row is None:
        session.add(AppSetting(key=key, value=pulled))
    else:
        row.value = pulled
    session.commit()
    return pulled


def set_maia_target_elo(session: Session, value: int | None) -> int | None:
    """The target elo, stored or cleared. Returns what is in force afterwards."""
    stored_value = set_value(session, MAIA_TARGET_ELO, value)
    return None if stored_value is None else int(stored_value)


def replace(
    session: Session, values: Mapping[str, int | float | None]
) -> dict[str, int | float | None]:
    """Write the whole of the settings at once. Returns what is in force afterwards.

    Whole, not a patch: a key that is missing from `values` means the same as one given as
    null — cleared, back to its default. That is what makes the answer to a save the state
    of the deployment rather than a diff someone has to apply in their head.

    The clamps run first and the ordering rule second, on the values that would actually be
    in force, so that "inaccuracy 30, mistake 20" is refused whether the numbers came from
    the form or from the defaults underneath the boxes it left empty. Nothing is written
    unless the whole set is coherent.
    """
    wanted: dict[str, int | float | None] = {}
    for key in KEYS:
        value = values.get(key)
        wanted[key] = None if value is None else BY_KEY[key].clamp(value)
    _require_rising_thresholds(wanted)

    session.execute(delete(AppSetting).where(AppSetting.key.in_(KEYS)))
    session.add_all(
        [AppSetting(key=key, value=value) for key, value in wanted.items() if value is not None]
    )
    session.commit()
    return wanted


def _require_rising_thresholds(wanted: Mapping[str, int | float | None]) -> None:
    """Refuse a set of thresholds that does not rise; a clamp cannot rescue one.

    Every other bad number has a nearest sensible one and is pulled to it. This does not:
    a deployment where an inaccuracy costs more than a blunder classifies nothing, and
    silently reordering the numbers would answer a save with a form the owner did not fill
    in.
    """
    inaccuracy, mistake, blunder = (_or_default(wanted, key) for key in THRESHOLD_KEYS)
    if not inaccuracy < mistake < blunder:
        raise SettingsError(
            "the classification thresholds have to rise: inaccuracy < mistake < blunder, "
            f"and {inaccuracy:g} < {mistake:g} < {blunder:g} is not. Every threshold left "
            "empty is its default (10, 20, 30 win-percentage points)."
        )


def _clean(setting: Setting, value: object) -> int | float | None:
    """A stored JSON value as this setting's number, or None where it is not one."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return setting.clamp(value)

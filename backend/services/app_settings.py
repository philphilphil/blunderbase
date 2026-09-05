"""The analysis settings the owner changes from the Engine passes and Maia pages.

Everything else Blunderbase is configured with is an environment variable read once at
boot (`backend/config.py`). These are not: they are the ones a person changes while the
app is running and expects to take effect on the next thing they click, so they live in
the database and are read where they are used rather than cached in the process.

There are fourteen of them, in five groups, plus two rows that are not settings at all
(`queue_paused` and `tour_seen`, at the bottom).

**The Maia levels.** The ratings every Maia question is asked at — the ratings the owner
is playing towards and the ones they want to contrast with, not the one they have. Batch
analysis bakes *every* configured level into every ply it asks about, and the analysis
board's live queries ask the same set, so no two surfaces ever speak for two different
humans. It is a list rather than a number because the interesting reading is a comparison:
what a 1500 plays here and what a 1900 plays here, side by side. One to five of them, each
clamped to what Maia can answer; an install that never changed the Maia page is pinned
to the top of that range alone, [2000]. `maia_target_elo` survives as the first of them,
which is what every caller that only ever wanted one level still reads.

**Where the Maia pass runs at all** — `maia_on_quick`, `maia_on_deep`, `maia_both_sides`,
each 0 or 1. The Maia pass costs 40-70% of a quick run, so which tiers pay for it is a
choice rather than a fact about a run. Quick is on by default because it is the pass every
imported game gets; deep is off, because a deep run would recompute a policy identical to
the one the quick run stored, and the fill flow (`maia_only`) is what adds levels to a game
that only ever had a deep pass. `maia_both_sides` off asks Maia about the owner's own moves
only, which halves what a run pays for it. The two tier flags are read when a run is
enqueued, alongside its budget; `maia_both_sides` is read per plan, alongside the
thresholds.

**The analysis budgets** — `quick_nodes`, `deep_nodes`, `deep_multipv`. What one position
costs in each tier, and how many lines a deep run keeps. Read when a run is enqueued, so
they are the budget of the *next* run rather than of every run ever queued.

**The classification thresholds** — `inaccuracy`, `mistake`, `blunder`, in win-percentage
points lost by the mover. Read per plan, which means a game re-analysed after they moved
is judged by the new ones and one analysed before it keeps what it was judged by.

**The engine roles** — `quick_engine_id`, `deep_engine_id`, `human_engine_id`. Which
engine runs each of the three jobs, chosen by the owner rather than claimed by an engine.
They are identities, not numbers with a range, so they are outside `SETTINGS` and outside
`replace` entirely — there is no clamp that could rescue an engine id, and a save of the
analysis form must not wipe the deployment's wiring. `services.engines` is where they mean
something; here they are three rows and their accessors, the way `maia_elos` is.

**The owner's Lichess token** — `lichess_token`, the personal API token the reference
explorer sends to `explorer.lichess.ovh`, which no longer answers an anonymous request. A
credential rather than a number: outside `SETTINGS` and outside `replace` for the same
reason the engine roles are, and read straight where it is used so that pasting a new one
takes effect on the next lookup. Nothing echoes it back — the surfaces answer whether one
is stored, never what it is.

**Whether the queue is draining at all** — `queue_paused`, the top bar's pause button.
Not one of the fourteen and deliberately not a member of `SETTINGS`: it is a switch over
the *queue* rather than a number with a clamp, nobody sets it from the analysis form, and
`replace` rewrites the whole set of keys it knows — so a member would be un-paused by the
next save of the Engine passes page, which is exactly the bug a pause button must not have.
Its own read/write pair goes at the row directly, the way the engine roles and `maia_elos`
do. `services.analysis.claim_next_run` is the only thing that reads it in anger.

**Whether the owner has seen the app explained** — `tour_seen`, set once the orientation
tour has been finished or skipped. Not one of the fourteen and outside `replace` for the
reason `queue_paused` is. It lives here rather than in the browser because it is a fact
about the owner and not about a browser: a tour that came back on a second machine, or
after clearing site data, would be a tour that had not run once.

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
from backend.db.enums import EngineRole, Tier
from backend.db.models import AppSetting

# --- the keys -------------------------------------------------------------

MAIA_TARGET_ELO = "maia_target_elo"
# The list that replaced it. Not one of `SETTINGS`: those are single numbers with a clamp
# and a range, and this is a set of them, so it is read and written by its own pair of
# functions rather than through `set_value` / `replace`.
MAIA_ELOS = "maia_elos"
# The three switches over the Maia pass itself, each stored as 0 or 1. Ordinary members of
# `SETTINGS`: a flag is a number with a range of one step, and giving it its own machinery
# would buy nothing but a second way to read a row.
MAIA_ON_QUICK = "maia_on_quick"
MAIA_ON_DEEP = "maia_on_deep"
MAIA_BOTH_SIDES = "maia_both_sides"
QUICK_NODES = "quick_nodes"
DEEP_NODES = "deep_nodes"
DEEP_MULTIPV = "deep_multipv"
INACCURACY_THRESHOLD = "inaccuracy_threshold"
MISTAKE_THRESHOLD = "mistake_threshold"
BLUNDER_THRESHOLD = "blunder_threshold"
# The three role assignments, each a nullable engine id. Not in `SETTINGS` for the same
# reason `MAIA_ELOS` is not: those are single numbers with a range and a clamp, and an
# engine id has neither — the nearest sensible engine to one that is gone is no engine.
QUICK_ENGINE_ID = "quick_engine_id"
DEEP_ENGINE_ID = "deep_engine_id"
HUMAN_ENGINE_ID = "human_engine_id"

# The owner's Lichess personal API token, as the reference explorer sends it. Outside
# `SETTINGS` for the same reason the engine roles are: it is a credential, not a number
# with a range, and there is no value between "the right token" and "no token" to clamp to.
LICHESS_TOKEN = "lichess_token"

# Whether the workers are allowed to claim. Outside `SETTINGS` and outside `replace`'s
# whole-set rewrite on purpose: it is not a number the analysis form posts, and a key that
# form rewrote would resume a queue the owner had paused.
QUEUE_PAUSED = "queue_paused"
# Minutes between scheduled syncs of every connected account; no row means never. A
# number rather than a flag and a number because "on, but at no interval" is not a state.
AUTO_SYNC_MINUTES = "auto_sync_minutes"
# Whether the owner has been through the orientation tour. Outside `SETTINGS` for the same
# reason `queue_paused` is: it is a fact about the person rather than a number with a
# range, and a member of the set `replace` rewrites would be un-seen by the next save of
# the Engine passes page.
TOUR_SEEN = "tour_seen"

ROLE_KEYS: dict[EngineRole, str] = {
    EngineRole.QUICK: QUICK_ENGINE_ID,
    EngineRole.DEEP: DEEP_ENGINE_ID,
    EngineRole.HUMAN: HUMAN_ENGINE_ID,
}

# --- what each one falls back to, and what it may be ----------------------

# The quick pass is the one every imported game gets, so it is where the human-move columns
# are worth their 40-70%. A deep pass is not: it would recompute a policy identical to the
# one already stored, since Maia answers a position rather than a search budget. Both sides
# by default, because "what will a human opposite me fall into" is a question about the
# positions the opponent moves in.
MAIA_ON_QUICK_DEFAULT = 1
MAIA_ON_DEEP_DEFAULT = 0
MAIA_BOTH_SIDES_DEFAULT = 1
QUICK_NODES_DEFAULT = 250_000
DEEP_NODES_DEFAULT = 2_000_000
DEEP_MULTIPV_DEFAULT = 4
# Lichess's own judgment thresholds: winning-chance deltas of .1/.2/.3 on its -1..1 scale,
# which on this 0-100 win-percentage scale are 5/10/15 points. Same curve, same cuts, so a
# game reads the same here as it does on lichess.org until the owner says otherwise.
INACCURACY_DEFAULT = 5.0
MISTAKE_DEFAULT = 10.0
BLUNDER_DEFAULT = 15.0
# The levels an install that configured nothing asks Maia at: the top of what the model can
# answer, and only that one. The same default the single target elo had, as a list of one.
MAIA_ELOS_DEFAULT: tuple[int, ...] = (MAIA_MAX_RATING,)

# A budget of no nodes at all is not a cheaper pass, it is no pass; there is deliberately
# no ceiling, because how long the owner is willing to wait is theirs to decide.
MIN_NODES = 1
MIN_MULTIPV = 1
MAX_MULTIPV = 10
# The thresholds are win percentage, which is the whole of the scale.
MIN_THRESHOLD = 0.0
MAX_THRESHOLD = 100.0
# A flag's range: off, on, and nothing in between for a clamp to land on.
FLAG_OFF = 0
FLAG_ON = 1
# How many Maia levels one deployment may carry. Every level is a full extra policy query
# per ply of every run, so this is a budget as much as a UI limit; five columns is also
# about as many as the game panel can put side by side and still be read.
MAX_MAIA_ELOS = 5


class SettingsError(ValueError):
    """A change to the settings that is not a coherent set of them."""


@dataclass(frozen=True, slots=True)
class Setting:
    """One stored number: what it falls back to, and the range it is pulled into."""

    key: str
    default: int | float
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
        # The top of what Maia can answer: an owner who has said nothing about the rating
        # they are playing towards is asked about the strongest human the model knows.
        default=MAIA_MAX_RATING,
        low=MAIA_MIN_RATING,
        high=MAIA_MAX_RATING,
        whole=True,
    ),
    Setting(
        key=MAIA_ON_QUICK,
        default=MAIA_ON_QUICK_DEFAULT,
        low=FLAG_OFF,
        high=FLAG_ON,
        whole=True,
    ),
    Setting(
        key=MAIA_ON_DEEP,
        default=MAIA_ON_DEEP_DEFAULT,
        low=FLAG_OFF,
        high=FLAG_ON,
        whole=True,
    ),
    Setting(
        key=MAIA_BOTH_SIDES,
        default=MAIA_BOTH_SIDES_DEFAULT,
        low=FLAG_OFF,
        high=FLAG_ON,
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


def clean_maia_elos(values: object) -> list[int]:
    """Whatever was given as the deployment's Maia levels, as levels it can have.

    Sorted, deduped, each pulled inside what the model can answer for, and no more than
    `MAX_MAIA_ELOS` of them — the lowest ones win a list that is too long, because a
    truncation has to be decided somewhere and dropping the top of the range keeps the
    levels nearest the owner's own play. Anything that is not a rating is dropped rather
    than refused, and a list with nothing left in it is the default: there is no such thing
    as a deployment that asks Maia at no rating at all.
    """
    if isinstance(values, bool) or isinstance(values, int | float):
        values = [values]
    if not isinstance(values, list | tuple):
        return list(MAIA_ELOS_DEFAULT)
    setting = BY_KEY[MAIA_TARGET_ELO]
    levels = {
        int(setting.clamp(value))
        for value in values
        if not isinstance(value, bool) and isinstance(value, int | float)
    }
    if not levels:
        return list(MAIA_ELOS_DEFAULT)
    return sorted(levels)[:MAX_MAIA_ELOS]


def get_maia_elos(session: Session) -> list[int]:
    """Every rating Maia is asked at on this deployment, lowest first.

    The list row if there is one, else the single target elo an install from before the
    list existed still has (a migration converts it, so that fallback is for a row written
    by hand), else the default. Cleaned on the way out as well as on the way in, because
    this is JSON in a database a person can open.
    """
    row = session.get(AppSetting, MAIA_ELOS)
    if row is not None:
        cleaned = clean_maia_elos(row.value)
        if cleaned:
            return cleaned
    legacy = stored(session, MAIA_TARGET_ELO)
    if legacy is not None:
        return [int(legacy)]
    return list(MAIA_ELOS_DEFAULT)


def set_maia_elos(session: Session, values: object | None) -> list[int]:
    """Store the levels, or clear them. Returns the levels in force afterwards.

    Clearing writes no row, exactly as the single settings do: "nobody chose" and "chose
    nothing" are one state, and the state is the default. The legacy `maia_target_elo` row
    goes on every write, so the two keys can never disagree about what is in force.
    """
    session.execute(delete(AppSetting).where(AppSetting.key.in_((MAIA_ELOS, MAIA_TARGET_ELO))))
    if values is None:
        session.commit()
        return list(MAIA_ELOS_DEFAULT)
    levels = clean_maia_elos(values)
    session.add(AppSetting(key=MAIA_ELOS, value=levels))
    session.commit()
    return levels


def get_maia_target_elo(session: Session) -> int:
    """The first rating Maia is asked at — what a caller that wants one level reads.

    Kept because plenty of them do: a runner plan carries one level over the wire for a
    client that predates the list, and a surface that shows a single number shows this one.
    """
    return get_maia_elos(session)[0]


def get_role_engine_id(session: Session, role: EngineRole) -> int | None:
    """The engine the owner assigned to this role, or None because nobody has.

    Only the id is stored, and only the id is answered: whether that engine still exists,
    is switched on, or is of a kind the role can use is `services.engines`'s question, and
    asking it here would put half of it in two places.
    """
    row = session.get(AppSetting, ROLE_KEYS[EngineRole(role)])
    if row is None:
        return None
    value = row.value
    if isinstance(value, bool) or not isinstance(value, int):
        # A hand-edited row. Unassigned is the honest reading of a value that is not an id.
        return None
    return value


def set_role_engine_id(session: Session, role: EngineRole, engine_id: int | None) -> int | None:
    """Assign an engine to a role, or unassign it. Returns what is assigned afterwards.

    None deletes the row rather than writing a null, as every other setting does: "the
    owner has not chosen" and "the owner chose nothing" are one state, and the state is
    that the role does not run.
    """
    key = ROLE_KEYS[EngineRole(role)]
    if engine_id is None:
        session.execute(delete(AppSetting).where(AppSetting.key == key))
        session.commit()
        return None
    row = session.get(AppSetting, key)
    if row is None:
        session.add(AppSetting(key=key, value=int(engine_id)))
    else:
        row.value = int(engine_id)
    session.commit()
    return int(engine_id)


def get_lichess_token(session: Session) -> str | None:
    """The owner's Lichess personal API token, or None because nobody has pasted one.

    Read at the moment it is needed rather than held anywhere, so a token pasted into the
    page is in force for the next lookup and a token revoked upstream is not cached past
    the request that discovers it. Anything in the row that is not a non-empty string is
    read as no token at all — the same treatment a hand-edited engine id gets.
    """
    row = session.get(AppSetting, LICHESS_TOKEN)
    if row is None or not isinstance(row.value, str):
        return None
    return row.value.strip() or None


def set_lichess_token(session: Session, value: str | None) -> str | None:
    """Store a token, or clear it. Returns what is stored afterwards.

    An empty string clears rather than stores: a form that posts a blank box means "take
    it away", and there is no use for a row holding nothing. Cleared, the row is deleted —
    "the owner has not chosen" is the absence of a row here as it is everywhere else.
    """
    token = (value or "").strip()
    if not token:
        session.execute(delete(AppSetting).where(AppSetting.key == LICHESS_TOKEN))
        session.commit()
        return None
    row = session.get(AppSetting, LICHESS_TOKEN)
    if row is None:
        session.add(AppSetting(key=LICHESS_TOKEN, value=token))
    else:
        row.value = token
    session.commit()
    return token


def get_queue_paused(session: Session) -> bool:
    """Whether the owner has stopped the workers claiming new runs.

    No row means not paused: a deployment that has never touched the button drains its
    queue, which is the only state an install can be in before there is a button to press.
    """
    row = session.get(AppSetting, QUEUE_PAUSED)
    return False if row is None else bool(row.value)


def set_queue_paused(session: Session, paused: bool) -> bool:
    """Pause or resume the queue. Returns the state in force afterwards.

    Resuming deletes the row rather than writing a 0, the way every other write here treats
    "the owner has not chosen": there is one fallback and it is the absence of a row.
    """
    if not paused:
        session.execute(delete(AppSetting).where(AppSetting.key == QUEUE_PAUSED))
        session.commit()
        return False
    row = session.get(AppSetting, QUEUE_PAUSED)
    if row is None:
        session.add(AppSetting(key=QUEUE_PAUSED, value=FLAG_ON))
    else:
        row.value = FLAG_ON
    session.commit()
    return True


def get_tour_seen(session: Session) -> bool:
    """Whether the owner has been through the orientation tour, or waved it away.

    No row means they have not: an install nobody has opened is exactly the install the
    tour is for, which is why the absence of a row is the state that starts it.
    """
    row = session.get(AppSetting, TOUR_SEEN)
    return False if row is None else bool(row.value)


def set_tour_seen(session: Session, seen: bool) -> bool:
    """Record the tour as done, or put it back. Returns the state in force afterwards.

    "Show the tour again" writes False, which deletes the row rather than storing a 0 —
    the same treatment every other write here gives "the owner has not chosen".
    """
    if not seen:
        session.execute(delete(AppSetting).where(AppSetting.key == TOUR_SEEN))
        session.commit()
        return False
    row = session.get(AppSetting, TOUR_SEEN)
    if row is None:
        session.add(AppSetting(key=TOUR_SEEN, value=FLAG_ON))
    else:
        row.value = FLAG_ON
    session.commit()
    return True


def _flag(session: Session, key: str) -> bool:
    """One 0/1 setting as the bool its callers want, its default where no row says."""
    value = stored(session, key)
    return bool(BY_KEY[key].default if value is None else value)


def get_maia_on_quick(session: Session) -> bool:
    """Whether a quick pass queued now also asks the human-move model."""
    return _flag(session, MAIA_ON_QUICK)


def get_maia_on_deep(session: Session) -> bool:
    """Whether a deep pass queued now also asks the human-move model.

    Off unless the owner turns it on: Maia answers a position rather than a search budget,
    so a deep run's policy is the quick run's policy computed a second time.
    """
    return _flag(session, MAIA_ON_DEEP)


def get_maia_both_sides(session: Session) -> bool:
    """Whether Maia is asked about every ply, or only the ones the owner moved in."""
    return _flag(session, MAIA_BOTH_SIDES)


def maia_for_tier(session: Session, tier: Tier) -> bool:
    """Whether a run of this tier, queued now, carries a Maia pass at all."""
    return get_maia_on_deep(session) if Tier(tier) is Tier.DEEP else get_maia_on_quick(session)


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


def _or_default(values: Mapping[str, int | float | None], key: str) -> float:
    """One threshold as it would be in force: the value given, else the key's default."""
    value = values.get(key)
    return float(BY_KEY[key].default if value is None else value)


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


def set_maia_target_elo(session: Session, value: int | None) -> int:
    """Ask Maia at this one level and nothing else. Returns the level in force after.

    The list, set to one entry — which is what "the target elo" now means. None is not a
    third state here: it clears the row, and the level in force is the default.
    """
    return set_maia_elos(session, None if value is None else [value])[0]


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
            "empty is its default (5, 10, 15 win-percentage points)."
        )


def _clean(setting: Setting, value: object) -> int | float | None:
    """A stored JSON value as this setting's number, or None where it is not one."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return setting.clamp(value)


# --- the sync schedule ----------------------------------------------------


# The floor. Every sync is at least one request to a public API per account, and the
# archives answer nothing new inside a minute anyway; below this the box is a typo.
MIN_AUTO_SYNC_MINUTES = 1


def get_auto_sync_minutes(session: Session) -> int | None:
    """Minutes between scheduled syncs, or None because the owner has not switched it on.

    Anything in the row that is not a whole number at or above the floor is read as off —
    the same treatment a hand-edited engine id gets.
    """
    row = session.get(AppSetting, AUTO_SYNC_MINUTES)
    if row is None or isinstance(row.value, bool) or not isinstance(row.value, int | float):
        return None
    minutes = int(row.value)
    return minutes if minutes >= MIN_AUTO_SYNC_MINUTES else None


def set_auto_sync_minutes(session: Session, minutes: int | None) -> int | None:
    """Schedule a sync every `minutes`, or switch it off. Returns what is in force.

    Off deletes the row rather than writing a 0, the way every other write here treats
    "the owner has not chosen". A value under the floor is pulled up to it rather than
    refused: the box said "as often as you can", and this is that.
    """
    if minutes is None:
        session.execute(delete(AppSetting).where(AppSetting.key == AUTO_SYNC_MINUTES))
        session.commit()
        return None
    wanted = max(MIN_AUTO_SYNC_MINUTES, int(minutes))
    row = session.get(AppSetting, AUTO_SYNC_MINUTES)
    if row is None:
        session.add(AppSetting(key=AUTO_SYNC_MINUTES, value=wanted))
    else:
        row.value = wanted
    session.commit()
    return wanted


def get_disabled_sync_sources(session: Session) -> list[str]:
    row = session.get(AppSetting, "disabled_sync_sources")
    return list(row.value) if row is not None and isinstance(row.value, list) else []


def set_disabled_sync_sources(session: Session, sources: list[str]) -> None:
    row = session.get(AppSetting, "disabled_sync_sources")
    if row is None:
        session.add(AppSetting(key="disabled_sync_sources", value=sorted(set(sources))))
    else:
        row.value = sorted(set(sources))
    session.commit()

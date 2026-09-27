"""Collections: named, coloured groups of the owner's games, filled by hand or by a rule.

A collection is a grouping and a filter dimension, and nothing else. It never hides a game:
a game in one is counted in the library, Stats, the dashboard and the explorer exactly as it
was before, and `GameFilters.collection` is what narrows any of them to it. That is the
whole integration — every screen built on the one filter vocabulary gets collections by
having been built on it.

Games get in two ways. By hand (`add_games`, `added_by="manual"`), from a selection of rows
or from the game page. And by a rule: a subset of the `/games` vocabulary (`RULE_KEYS`)
that every game an import stores is matched against as it arrives (`assign_on_import`,
`added_by="rule"`). A rule never re-runs over old games on its own — that is the explicit
`apply_rule` — so a game the owner took out by hand stays out however many syncs follow,
and a rule written today does not reach a game imported yesterday, not even when that game's
side is only learned later (`Collection.rule_set_at`).

Every write here commits and then announces itself on the service event hub as
`collections.changed`, which is what refreshes the Collections screen's cards and the chips
on every open list. The frame says whether games moved (`membership`): only then are the stats
answers scoped to a collection dropped, and only then does a screen refetch its games,
Stats and explorer — a rename moves none of them.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import ColumnElement, and_, delete, exists, func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.db.enums import Color, Source, Speed
from backend.db.models import Collection, Game, GameCollection
from backend.db.types import utcnow
from backend.services import events as events_service
from backend.services import stats as stats_service
from backend.services.games import GameFilters, game_conditions

logger = logging.getLogger(__name__)

EVENT_CHANGED = "collections.changed"

# The palette a collection may take a colour from: keys into the app's tokens rather than
# colours, so a theme recolours every collection and no row stores a hex.
COLORS = ("accent", "good", "otb", "way-back", "mistake", "info", "blunder")
DEFAULT_COLOR = "accent"

NAME_MAX = 40

ADDED_MANUAL = "manual"
ADDED_RULE = "rule"

# What a rule may say: the part of the library's filter vocabulary that describes a game as
# it arrives. No dates (a rule is about games still to come), no free text, no analysis
# state (nothing is analysed at import), no collection and no "whose" (a rule only ever
# takes in the owner's own games).
RULE_KEYS = ("source", "speed", "time_control", "rated", "color", "eco", "opponent", "variant")

# How many ids one statement names; SQLite has a ceiling on bound parameters.
ID_CHUNK = 500

# The difference between "leave it as it is" and "set it to nothing" in an update.
UNSET: Any = object()

# Moved by every write that can change a rule — a collection made, changed or deleted — so
# a `RuleBook` an import stream is holding knows to read the rules again. Only ever
# compared for equality; the lock is what keeps two writers from both landing on one value.
_RULES_LOCK = threading.Lock()
_rules_version = 0


class CollectionError(ValueError):
    """A collection that cannot be written the way it was asked for."""


class CollectionNameTakenError(CollectionError):
    """Another collection already has this name, whatever its case."""


class CollectionRuleError(CollectionError):
    """A rule that names something the rule vocabulary does not have."""


class NoRuleError(CollectionError):
    """ "Apply the rule" asked of a collection that has none."""


class UnknownCollectionError(LookupError):
    """No collection with that id or name."""


# --- rules ----------------------------------------------------------------


def normalize_rule(rule: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """A rule in its stored form, or None for "no rule"; raises on anything it cannot mean.

    An absent key, a None and an empty string all mean "not narrowed by this", so a form
    that sends every field it has is read the way it looks. A rule that narrows by nothing
    is no rule at all — stored as NULL rather than as a filter that matches every import.
    """
    if rule is None:
        return None
    if not isinstance(rule, Mapping):
        raise CollectionRuleError("a rule is an object of filters")
    unknown = sorted(set(rule) - set(RULE_KEYS))
    if unknown:
        raise CollectionRuleError(
            f"a rule cannot filter by {', '.join(unknown)}; it can use {', '.join(RULE_KEYS)}"
        )
    stored: dict[str, Any] = {}
    for key in RULE_KEYS:
        value = rule.get(key)
        if value is None or value == "" or value == []:
            continue
        stored[key] = _rule_value(key, value)
    return stored or None


def _rule_value(key: str, value: Any) -> Any:
    try:
        if key == "source":
            return str(Source(value))
        if key == "speed":
            values = [value] if isinstance(value, str) else list(value)
            return list(dict.fromkeys(str(Speed(item)) for item in values))
        if key == "color":
            return str(Color(value))
    except (TypeError, ValueError):
        raise CollectionRuleError(f"{value!r} is not a {key} a rule can name") from None
    if key == "rated":
        if not isinstance(value, bool):
            raise CollectionRuleError("rated is true or false")
        return value
    if not isinstance(value, str):
        raise CollectionRuleError(f"{key} is text")
    text = value.strip()
    if not text:
        raise CollectionRuleError(f"{key} cannot be blank")
    if len(text) > 128:
        raise CollectionRuleError(f"{key} is too long")
    return text


def rule_filters(rule: Mapping[str, Any]) -> GameFilters:
    """A stored rule as the library filter it is: always the owner's own games."""
    speeds = rule.get("speed")
    return GameFilters(
        mine=True,
        source=Source(rule["source"]) if rule.get("source") else None,
        speeds=tuple(Speed(speed) for speed in speeds) if speeds else None,
        time_control=rule.get("time_control"),
        rated=rule.get("rated"),
        color=Color(rule["color"]) if rule.get("color") else None,
        eco=rule.get("eco"),
        opponent=rule.get("opponent"),
        variant=rule.get("variant"),
    )


@dataclass(frozen=True, slots=True)
class _Rule:
    """One collection's rule, read and turned into WHERE clauses once."""

    collection_id: int
    names_colour: bool
    # When the rule took the form it has now (`Collection.rule_set_at`).
    set_at: datetime
    conditions: tuple[ColumnElement[bool], ...]


class RuleBook:
    """Every collection's rule, read once and held for as long as nothing rewrites one.

    An import stream stores its games one transaction at a time, and asking the collections
    table for its rules — and rebuilding each rule's filter — for every one of them is a few
    thousand identical reads for a first sync. A stream builds one of these when it starts
    and hands it to every game (`import_service.ingest_games`). `current` reads the rules
    again when a write in this process has changed them since (`_rules_version`), so a rule
    edited in the middle of a sync is heard at the next game, as it was when the rules were
    read per game. A collection deleted meanwhile by another process is caught by the match
    itself, which only answers for a collection that still exists.

    Nothing is read until the first `current`, so a caller that turns out to have no games
    to offer — most reconciles — costs no query for having made one.
    """

    __slots__ = ("_rules", "_version")

    def __init__(self) -> None:
        self._rules: tuple[_Rule, ...] = ()
        # Never a real version, so the first `current` reads.
        self._version = -1

    def current(self, session: Session) -> tuple[_Rule, ...]:
        if self._version != _rules_version:
            self._load(session)
        return self._rules

    def _load(self, session: Session) -> None:
        # Read before the rows: a write landing between the two leaves this book a version
        # behind, and the next `current` reads again rather than keeping what it missed.
        version = _rules_version
        rows = session.execute(
            select(Collection.id, Collection.rule, Collection.rule_set_at)
            .where(Collection.rule.is_not(None))
            .order_by(Collection.id)
        ).all()
        rules: list[_Rule] = []
        for collection_id, rule, set_at in rows:
            if not rule:
                continue
            # A stored rule this version cannot read is skipped and logged rather than
            # allowed to fail an import: the game matters more than the grouping.
            try:
                conditions = tuple(game_conditions(rule_filters(rule)))
            except (AttributeError, KeyError, TypeError, ValueError) as exc:
                logger.warning(
                    "collection %s has a rule that cannot be read: %s", collection_id, exc
                )
                continue
            rules.append(
                _Rule(
                    collection_id=collection_id,
                    names_colour=bool(rule.get("color")),
                    set_at=set_at,
                    conditions=conditions,
                )
            )
        self._rules = tuple(rules)
        self._version = version


def _rules_changed() -> None:
    global _rules_version
    with _RULES_LOCK:
        _rules_version += 1


# --- reading --------------------------------------------------------------


def list_collections(session: Session) -> list[Collection]:
    """Every collection, by name regardless of case."""
    rows = session.scalars(select(Collection).order_by(Collection.id))
    return sorted(rows, key=lambda row: (row.name.casefold(), row.id))


def get_collection(session: Session, collection_id: int) -> Collection:
    collection = session.get(Collection, int(collection_id))
    if collection is None:
        raise UnknownCollectionError(f"no collection with id {collection_id}")
    return collection


def resolve_collection(session: Session, ref: str | int) -> Collection:
    """A collection by id or by name, the name matched regardless of case.

    For a caller that speaks in names — a chat model asking about "the league" — as well as
    one that holds an id. A name that is all digits is tried as an id first.
    """
    if isinstance(ref, int) or (isinstance(ref, str) and ref.strip().isdigit()):
        found = session.get(Collection, int(ref))
        if found is not None:
            return found
    wanted = str(ref).strip().casefold()
    for collection in session.scalars(select(Collection)):
        if collection.name.casefold() == wanted:
            return collection
    raise UnknownCollectionError(f"no collection called {ref!r}")


def game_counts(session: Session, collection_ids: Iterable[int] | None = None) -> dict[int, int]:
    """How many games each collection holds, in one grouped query."""
    statement = select(GameCollection.collection_id, func.count()).group_by(
        GameCollection.collection_id
    )
    if collection_ids is not None:
        statement = statement.where(GameCollection.collection_id.in_(list(collection_ids)))
    return {collection_id: int(count) for collection_id, count in session.execute(statement)}


def collection_payload(collection: Collection, game_count: int) -> dict[str, Any]:
    return {
        "id": collection.id,
        "name": collection.name,
        "color": collection.color,
        "description": collection.description,
        "rule": dict(collection.rule) if collection.rule else None,
        "game_count": game_count,
        "created_at": collection.created_at.isoformat(),
    }


def payload(session: Session, collection: Collection) -> dict[str, Any]:
    """One collection as the API shows it, with its game count."""
    count = game_counts(session, [collection.id]).get(collection.id, 0)
    return collection_payload(collection, count)


def list_payloads(session: Session, *, with_summary: bool = False) -> list[dict[str, Any]]:
    """Every collection with its game count; with `with_summary`, each with its score line.

    The plain list is what the chips, the Collection filter, the command palette and every
    name lookup read, often, so it stays two cheap queries. The summary — the same one
    `detail_payload` gives, for the Collections screen's cards — is asked for by the one
    screen that shows it, and is computed for every collection at once
    (`stats.collection_outcome_summaries`).
    """
    counts = game_counts(session)
    rows = list_collections(session)
    payloads = [collection_payload(row, counts.get(row.id, 0)) for row in rows]
    if with_summary:
        summaries = stats_service.collection_outcome_summaries(session, [row.id for row in rows])
        for entry in payloads:
            entry["summary"] = summaries[entry["id"]]
    return payloads


def detail_payload(session: Session, collection_id: int) -> dict[str, Any]:
    """A collection with the score line its card leads with.

    `game_count` is every game in it, which is what the collection's card opens (every
    game, not the owner's alone). The summary is the owner's record over the
    same games, so it leaves out what has no owner side: a reference game put in by hand,
    and a game of theirs whose side is not known yet (`stats.outcome_summary`).
    """
    collection = get_collection(session, collection_id)
    return {
        **payload(session, collection),
        "summary": stats_service.outcome_summary(session, GameFilters(collection=collection.id)),
    }


def collections_of(session: Session, game_ids: Iterable[int]) -> dict[int, list[int]]:
    """Which collections each of these games is in, in one query per chunk of ids.

    Every id asked about is a key, with an empty list for a game in none, so a caller can
    index the answer without a default. Collection ids come in ascending order, which is
    the order they were made in — stable, so a row's chips do not shuffle between pages.
    """
    ids = _unique(game_ids)
    found: dict[int, list[int]] = {game_id: [] for game_id in ids}
    for chunk in _chunks(ids):
        statement = (
            select(GameCollection.game_id, GameCollection.collection_id)
            .where(GameCollection.game_id.in_(chunk))
            .order_by(GameCollection.game_id, GameCollection.collection_id)
        )
        for game_id, collection_id in session.execute(statement):
            found[game_id].append(collection_id)
    return found


# --- writing --------------------------------------------------------------


def create_collection(
    session: Session,
    *,
    name: str,
    color: str = DEFAULT_COLOR,
    description: str | None = None,
    rule: Mapping[str, Any] | None = None,
    apply_to_existing: bool = False,
    game_ids: Sequence[int] = (),
) -> Collection:
    """Make a collection, optionally filling it straight away.

    `apply_to_existing` runs the rule once over the library as it is, the way "Also add the
    games you already have that match" reads; `game_ids` are put in by hand, which is what
    "New collection from these N" is. Both in the same commit as the collection itself.
    `apply_to_existing` without a rule has nothing to apply and is simply nothing.
    """
    stored_rule = normalize_rule(rule)
    collection = Collection(
        name=_valid_name(session, name),
        color=_valid_color(color),
        description=_valid_description(description),
        rule=stored_rule,
    )
    session.add(collection)
    _flush_name(session, collection.name)
    added = 0
    if game_ids:
        added += _insert_members(
            session, collection.id, _existing_games(session, game_ids), ADDED_MANUAL
        )
    if apply_to_existing and stored_rule is not None:
        added += _insert_members(
            session, collection.id, _rule_matches(session, stored_rule), ADDED_RULE
        )
    session.commit()
    _rules_changed()
    notify_changed(collection.id, membership=added > 0)
    return collection


def update_collection(
    session: Session,
    collection_id: int,
    *,
    name: Any = UNSET,
    color: Any = UNSET,
    description: Any = UNSET,
    rule: Any = UNSET,
) -> Collection:
    """Change what was named; `UNSET` leaves a field alone and `rule=None` clears the rule.

    Changing a rule changes nothing about the games already in the collection: a rule is
    about imports still to come, and "apply to existing" is its own action. A rule that
    really changed restamps `rule_set_at`, so a game imported before the new form existed
    is not taken in by it later either, when its side is learned; saving the same rule
    again is no change and keeps the stamp.

    No game moves, so the announcement says so (`membership=False`) and nothing scoped to
    the collection has to be computed again.
    """
    collection = get_collection(session, collection_id)
    if name is not UNSET:
        collection.name = _valid_name(session, name, keep=collection.id)
    if color is not UNSET:
        collection.color = _valid_color(color)
    if description is not UNSET:
        collection.description = _valid_description(description)
    if rule is not UNSET:
        stored_rule = normalize_rule(rule)
        if stored_rule != collection.rule:
            collection.rule = stored_rule
            collection.rule_set_at = utcnow()
    _flush_name(session, collection.name)
    session.commit()
    _rules_changed()
    notify_changed(collection.id, membership=False)
    return collection


def delete_collection(session: Session, collection_id: int) -> None:
    """Forget the collection and its memberships. The games themselves are untouched."""
    collection = get_collection(session, collection_id)
    emptied = session.execute(
        delete(GameCollection).where(GameCollection.collection_id == collection.id)
    )
    session.delete(collection)
    session.commit()
    _rules_changed()
    # A filter naming a collection that is gone matches nothing, which is a change for a
    # collection that held games and none for one that was empty.
    notify_changed(int(collection_id), membership=bool(emptied.rowcount))


def add_games(session: Session, collection_id: int, game_ids: Sequence[int]) -> int:
    """Put games in by hand; how many were not already there. Unknown ids are ignored."""
    collection = get_collection(session, collection_id)
    added = _insert_members(
        session, collection.id, _existing_games(session, game_ids), ADDED_MANUAL
    )
    session.commit()
    if added:
        notify_changed(collection.id, membership=True)
    return added


def remove_games(session: Session, collection_id: int, game_ids: Sequence[int]) -> int:
    """Take games out, however they got in; how many were there to take.

    A game a rule put in and a hand took out stays out: rules only look at games as they
    are imported, and this game has already been.
    """
    collection = get_collection(session, collection_id)
    removed = 0
    for chunk in _chunks(_unique(game_ids)):
        result = session.execute(
            delete(GameCollection).where(
                GameCollection.collection_id == collection.id,
                GameCollection.game_id.in_(chunk),
            )
        )
        removed += int(result.rowcount or 0)
    session.commit()
    if removed:
        notify_changed(collection.id, membership=True)
    return removed


def apply_rule(session: Session, collection_id: int) -> int:
    """Run the collection's rule once over the library as it is; how many games joined.

    The explicit catch-up for a rule written after the games it describes had arrived. It
    brings back a game a hand took out, which is what asking for it means.
    """
    collection = get_collection(session, collection_id)
    if not collection.rule:
        raise NoRuleError(f"collection {collection.name!r} has no rule to apply")
    added = _insert_members(
        session, collection.id, _rule_matches(session, collection.rule), ADDED_RULE
    )
    session.commit()
    if added:
        notify_changed(collection.id, membership=True)
    return added


def assign_on_import(
    session: Session,
    game_ids: Sequence[int],
    *,
    rules: RuleBook | None = None,
    colour_rules_only: bool = False,
    as_imported: bool = False,
) -> list[int]:
    """Put freshly stored games into every collection whose rule they match.

    Called by the import pipeline inside the transaction that stores the game, so a game
    and its memberships appear together or not at all; it neither commits nor announces
    anything — the caller does both once the game is committed (`notify_changed`).
    Answers the collections that took a game in, which is what the caller announces.

    `rules` is the stream's `RuleBook`, so a sync reads the rules once rather than once per
    game; without one they are read here. Every rule is asked in one query per chunk of
    games, a column each, rather than one query per rule.

    `colour_rules_only` and `as_imported` are for a game the import could not answer for
    in full (`accounts.reconcile_games`). `colour_rules_only`: its side was unknown, so only
    a rule that names a colour has not had its say. `as_imported`: a rule takes it only if
    that rule already stood, in the form it has now, when the game was imported — this is
    the import's answer given late, not a rule reaching back to games already in the
    library, which only `apply_rule` does.
    """
    ids = _unique(game_ids)
    if not ids:
        return []
    book = rules if rules is not None else RuleBook()
    wanted = [rule for rule in book.current(session) if rule.names_colour or not colour_rules_only]
    if not wanted:
        return []
    columns = [
        _rule_matches_column(rule, as_imported=as_imported).label(f"rule_{index}")
        for index, rule in enumerate(wanted)
    ]
    matched: list[list[int]] = [[] for _ in wanted]
    for chunk in _chunks(ids):
        for game_id, *answers in session.execute(
            select(Game.id, *columns).where(Game.id.in_(chunk))
        ):
            for found, answer in zip(matched, answers, strict=True):
                if answer:
                    found.append(game_id)
    touched: list[int] = []
    for rule, found in zip(wanted, matched, strict=True):
        if _insert_members(session, rule.collection_id, found, ADDED_RULE):
            touched.append(rule.collection_id)
    return touched


def _rule_matches_column(rule: _Rule, *, as_imported: bool) -> ColumnElement[bool]:
    """Whether a game meets `rule`, as a column: the rule's filter, and the rule still there.

    The collection is asked for because a `RuleBook` can outlive it — a stream's book, and
    a collection another process deleted meanwhile — and a membership naming a collection
    that is gone is one the foreign key refuses, which would fail the game's import.
    """
    conditions: list[ColumnElement[bool]] = [
        exists().where(Collection.id == rule.collection_id),
        *rule.conditions,
    ]
    if as_imported:
        conditions.append(Game.imported_at >= rule.set_at)
    return and_(*conditions)


def notify_changed(collection_id: int | None, *, membership: bool) -> None:
    """Tell every open screen that a collection or its membership changed.

    None for a change that touched several at once. `membership` says whether games moved
    in or out — only then can a filter naming a collection answer differently, so only then
    are those stats answers dropped, first, so the refetch the event triggers is answered
    from the new membership. Every other cached answer keeps serving: a collection hides no
    game. A change to the collection alone — a name, a colour, a rule not applied — is
    `False`, and the screens refetch the collections and nothing else.

    Called once per write that commits — a hand edit, `apply_rule`, or a whole import whose
    rules took games in (`import_service.announce_collections`), never once per imported
    game, which is what keeps a sync of a few hundred league games from being a refetch
    storm.
    """
    if membership:
        stats_service.forget_collection_payloads()
    events_service.emit(
        {"event": EVENT_CHANGED, "collection_id": collection_id, "membership": membership}
    )


# --- helpers ----------------------------------------------------------------


def _valid_name(session: Session, name: Any, *, keep: int | None = None) -> str:
    if not isinstance(name, str) or not name.strip():
        raise CollectionError("a collection needs a name")
    cleaned = " ".join(name.split())
    if len(cleaned) > NAME_MAX:
        raise CollectionError(f"a collection's name is at most {NAME_MAX} characters")
    wanted = cleaned.casefold()
    for other_id, other_name in session.execute(select(Collection.id, Collection.name)):
        if other_id != keep and other_name.casefold() == wanted:
            raise CollectionNameTakenError(f"there is already a collection called {other_name!r}")
    return cleaned


def _flush_name(session: Session, name: str) -> None:
    """Write the collection now, so a name taken since `_valid_name` read the names says so.

    `_valid_name` answers the ordinary case with a sentence; this is the two requests that
    both read the name as free before either wrote it, where the unique index is the only
    one who knows, and its refusal is the same refusal rather than a server error.
    """
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise CollectionNameTakenError(f"there is already a collection called {name!r}") from None


def _valid_color(color: Any) -> str:
    if color is None:
        return DEFAULT_COLOR
    if color not in COLORS:
        raise CollectionError(f"{color!r} is not a colour; choose one of {', '.join(COLORS)}")
    return str(color)


def _valid_description(description: Any) -> str | None:
    if description is None:
        return None
    if not isinstance(description, str):
        raise CollectionError("a description is text")
    return description.strip() or None


def _existing_games(session: Session, game_ids: Iterable[int]) -> list[int]:
    """The ids that name a stored game, once each; the rest are quietly dropped."""
    present: list[int] = []
    for chunk in _chunks(_unique(game_ids)):
        present.extend(session.scalars(select(Game.id).where(Game.id.in_(chunk))))
    return present


def _rule_matches(session: Session, rule: Mapping[str, Any]) -> list[int]:
    return list(session.scalars(select(Game.id).where(*game_conditions(rule_filters(rule)))))


def _insert_members(
    session: Session, collection_id: int, game_ids: Sequence[int], added_by: str
) -> int:
    """Add the games not already in the collection; how many that was.

    The membership table's key decides what "already in" means, not a read before the
    write: two writes that overlap — a double-submitted Add to…, an assistant and the page
    adding the same game, a rule catching a game `apply_rule` is also adding — would both
    pass a read and the second would fail on the key. Here the second simply adds nothing.
    """
    ids = _unique(game_ids)
    if not ids:
        return 0
    now = utcnow()
    added = 0
    # Four parameters a row, so fewer rows a statement than an id list takes.
    for chunk in _chunks(ids, ID_CHUNK // 4):
        statement = (
            sqlite_insert(GameCollection)
            .values(
                [
                    {
                        "game_id": game_id,
                        "collection_id": collection_id,
                        "added_by": added_by,
                        "added_at": now,
                    }
                    for game_id in chunk
                ]
            )
            .on_conflict_do_nothing(index_elements=["game_id", "collection_id"])
        )
        added += int(session.execute(statement).rowcount or 0)
    return added


def _unique(ids: Iterable[int]) -> list[int]:
    return list(dict.fromkeys(int(item) for item in ids))


def _chunks(ids: list[int], size: int = ID_CHUNK) -> list[list[int]]:
    return [ids[start : start + size] for start in range(0, len(ids), size)]

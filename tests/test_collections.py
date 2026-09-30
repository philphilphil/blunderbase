"""Collections: named groups of games, filled by hand or by a rule over new imports.

The service tests drive `services.collections` and the import pipeline over an in-memory
library; the API tests drive the real app over a migrated file. Games arrive through the
same `ingest_games` a Lichess sync uses, because "a rule sees every import" is the claim.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import delete, event, func, inspect, select
from sqlalchemy.orm import Session

from backend.api.app import create_app
from backend.config import Settings
from backend.db.enums import Color, JobStatus, Platform, Result, Source, Speed
from backend.db.migrate import alembic_config, upgrade_to_head
from backend.db.models import Account, Collection, Game, GameCollection, ImportJob
from backend.db.session import get_engine, get_sessionmaker
from backend.services import accounts as accounts_service
from backend.services import collections as collections_service
from backend.services import events as events_service
from backend.services import games as games_service
from backend.services import import_service, stats
from backend.services.games import GameFilters
from backend.services.import_service import ParsedGame
from tests.conftest import running_app, socket_headers

OWNER = "blunderbase"
LEAGUE_RULE = {"source": "lichess", "time_control": "2700+45", "rated": True}
# Four plies of a Ruy Lopez: legal, short, and the same for every game here — the source
# ID is what keeps them apart.
MOVES = ["e2e4", "e7e5", "g1f3", "b8c6"]
SANS = ["e4", "e5", "Nf3", "Nc6"]
START = datetime(2026, 9, 1, 19, 0, tzinfo=UTC)


def _game(
    source_id: str,
    *,
    rated: bool | None = True,
    time_control: str = "2700+45",
    speed: Speed = Speed.CLASSICAL,
    white: str = OWNER,
    black: str = "leaguemate",
    result: Result = Result.WHITE_WIN,
    days: int = 0,
    black_rating: int | None = 1800,
) -> ParsedGame:
    return ParsedGame(
        source=Source.LICHESS,
        source_id=source_id,
        white_name=white,
        black_name=black,
        result=result,
        pgn="from the API",
        moves_uci=list(MOVES),
        moves_san=list(SANS),
        rated=rated,
        speed=speed,
        time_control=time_control,
        played_at=START + timedelta(days=days),
        white_rating=1700,
        black_rating=black_rating,
    )


def _sync(session: Session, *games: ParsedGame) -> list[int]:
    """Store games the way a Lichess sync does; the ids of the games it created."""
    job = ImportJob(source=Source.LICHESS, status=JobStatus.RUNNING)
    before = set(session.scalars(select(Game.id)))
    import_service.ingest_games(session, job, list(games), analyze=False)
    return sorted(set(session.scalars(select(Game.id))) - before)


def _members(session: Session, collection_id: int) -> dict[int, str]:
    rows = session.execute(
        select(GameCollection.game_id, GameCollection.added_by).where(
            GameCollection.collection_id == collection_id
        )
    )
    return {game_id: added_by for game_id, added_by in rows}


@pytest.fixture()
def owner(session: Session) -> Account:
    account = Account(platform=Platform.LICHESS, username=OWNER, is_owner=True)
    session.add(account)
    session.commit()
    return account


@pytest.fixture()
def heard() -> Iterator[list[dict[str, Any]]]:
    """Every event the service hub publishes while the test runs."""
    events: list[dict[str, Any]] = []
    cancel = events_service.subscribe(events.append)
    yield events
    cancel()


def _changed(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [event for event in events if event["event"] == collections_service.EVENT_CHANGED]


def _moved(collection_id: int | None, *, membership: bool = True) -> dict[str, Any]:
    """The frame a write announces itself with; `membership` is whether games moved."""
    return {
        "event": "collections.changed",
        "collection_id": collection_id,
        "membership": membership,
    }


# --- making, naming, listing -------------------------------------------------


def test_a_collection_is_made_and_listed_by_name_regardless_of_case(session: Session) -> None:
    collections_service.create_collection(session, name="zugzwang club", color="good")
    league = collections_service.create_collection(
        session, name="  45-45   League ", description=" Tuesdays ", rule=LEAGUE_RULE
    )

    listed = collections_service.list_payloads(session)

    assert [row["name"] for row in listed] == ["45-45 League", "zugzwang club"]
    assert listed[0] == {
        "id": league.id,
        "name": "45-45 League",
        "color": "accent",
        "description": "Tuesdays",
        "pinned": False,
        "rule": LEAGUE_RULE,
        "game_count": 0,
        "created_at": league.created_at.isoformat(),
    }


def test_a_name_is_taken_whatever_its_case(session: Session) -> None:
    league = collections_service.create_collection(session, name="45-45 League")
    other = collections_service.create_collection(session, name="Club")

    with pytest.raises(collections_service.CollectionNameTakenError):
        collections_service.create_collection(session, name="45-45 league")
    with pytest.raises(collections_service.CollectionNameTakenError):
        collections_service.update_collection(session, other.id, name="45-45 LEAGUE")
    # Renaming a collection to its own name in another case is not a clash with itself.
    renamed = collections_service.update_collection(session, league.id, name="45-45 LEAGUE")
    assert renamed.name == "45-45 LEAGUE"


@pytest.mark.parametrize(
    "changes",
    [
        {"name": ""},
        {"name": "x" * 41},
        {"name": "ok", "color": "hotpink"},
        {"name": "ok", "rule": {"since": "2026-01-01"}},
        {"name": "ok", "rule": {"source": "nowhere"}},
        {"name": "ok", "rule": {"speed": ["glacial"]}},
        {"name": "ok", "rule": {"rated": "yes"}},
    ],
)
def test_a_bad_name_colour_or_rule_is_refused(session: Session, changes: dict[str, Any]) -> None:
    with pytest.raises(collections_service.CollectionError):
        collections_service.create_collection(session, **changes)
    assert session.scalar(select(func.count(Collection.id))) == 0


def test_an_empty_rule_is_no_rule(session: Session) -> None:
    made = collections_service.create_collection(
        session, name="By hand", rule={"source": None, "speed": [], "opponent": ""}
    )
    assert made.rule is None
    with pytest.raises(collections_service.NoRuleError):
        collections_service.apply_rule(session, made.id)


def test_a_collection_is_found_by_id_or_by_name(session: Session) -> None:
    league = collections_service.create_collection(session, name="45-45 League")

    assert collections_service.resolve_collection(session, league.id) is league
    assert collections_service.resolve_collection(session, str(league.id)) is league
    assert collections_service.resolve_collection(session, " 45-45 league ") is league
    with pytest.raises(collections_service.UnknownCollectionError):
        collections_service.resolve_collection(session, "nope")


# --- by hand -------------------------------------------------------------------


def test_games_go_in_and_come_out_by_hand(session: Session, owner: Account) -> None:
    first, second = _sync(session, _game("aaaa0001"), _game("aaaa0002"))
    club = collections_service.create_collection(session, name="Club")

    assert collections_service.add_games(session, club.id, [first, second, first, 999]) == 2
    assert collections_service.add_games(session, club.id, [first]) == 0
    assert _members(session, club.id) == {first: "manual", second: "manual"}

    assert collections_service.remove_games(session, club.id, [first, 999]) == 1
    assert _members(session, club.id) == {second: "manual"}
    assert collections_service.payload(session, club)["game_count"] == 1


def test_a_new_collection_can_start_with_the_selected_games(
    session: Session, owner: Account
) -> None:
    ids = _sync(session, _game("aaaa0001"), _game("aaaa0002"))

    made = collections_service.create_collection(session, name="From these", game_ids=ids)

    assert _members(session, made.id) == {game_id: "manual" for game_id in ids}


def test_deleting_a_collection_leaves_its_games(session: Session, owner: Account) -> None:
    ids = _sync(session, _game("aaaa0001"))
    club = collections_service.create_collection(session, name="Club", game_ids=ids)

    collections_service.delete_collection(session, club.id)

    assert session.scalar(select(func.count()).select_from(GameCollection)) == 0
    assert session.scalar(select(func.count(Game.id))) == 1
    with pytest.raises(collections_service.UnknownCollectionError):
        collections_service.get_collection(session, club.id)


# --- by rule -------------------------------------------------------------------


def test_a_rule_takes_the_rated_league_game_and_nothing_else(
    session: Session, owner: Account
) -> None:
    league = collections_service.create_collection(session, name="45-45 League", rule=LEAGUE_RULE)

    rated, casual, blitz = _sync(
        session,
        _game("league01"),
        _game("casual01", rated=False),
        _game("blitz001", time_control="180+2", speed=Speed.BLITZ),
    )

    assert _members(session, league.id) == {rated: "rule"}
    assert casual and blitz


def test_a_rule_never_takes_somebody_elses_game(session: Session, owner: Account) -> None:
    league = collections_service.create_collection(session, name="League", rule=LEAGUE_RULE)
    job = ImportJob(source=Source.LICHESS, status=JobStatus.RUNNING)

    import_service.ingest_games(
        session,
        job,
        [_game("strange1", white="carlsen", black="caruana")],
        analyze=False,
        presume_owner=False,
    )

    assert _members(session, league.id) == {}


def test_a_game_added_by_name_is_matched_too(
    session: Session, owner: Account, heard: list[dict[str, Any]]
) -> None:
    league = collections_service.create_collection(session, name="League", rule=LEAGUE_RULE)
    heard.clear()

    outcome = import_service.import_one(session, _game("single01"), analyze=False)

    assert outcome.game is not None
    assert _members(session, league.id) == {outcome.game.id: "rule"}
    assert _changed(heard) == [_moved(league.id)]


def test_a_rule_does_not_reach_back_until_asked(session: Session, owner: Account) -> None:
    older = _sync(session, _game("league01"), _game("league02"), _game("casual01", rated=False))
    league = collections_service.create_collection(session, name="League", rule=LEAGUE_RULE)

    assert _members(session, league.id) == {}
    assert collections_service.apply_rule(session, league.id) == 2
    assert _members(session, league.id) == {older[0]: "rule", older[1]: "rule"}
    assert collections_service.apply_rule(session, league.id) == 0


def test_apply_to_existing_fills_a_new_collection_at_once(session: Session, owner: Account) -> None:
    first, second, casual = _sync(
        session, _game("league01"), _game("league02"), _game("casual01", rated=False)
    )

    league = collections_service.create_collection(
        session, name="League", rule=LEAGUE_RULE, apply_to_existing=True, game_ids=[casual]
    )

    assert _members(session, league.id) == {first: "rule", second: "rule", casual: "manual"}


def test_taking_a_game_out_by_hand_survives_the_next_import(
    session: Session, owner: Account
) -> None:
    league = collections_service.create_collection(session, name="League", rule=LEAGUE_RULE)
    kept, dropped = _sync(session, _game("league01"), _game("league02"))
    collections_service.remove_games(session, league.id, [dropped])

    (later,) = _sync(session, _game("league03"), _game("league01"))

    assert _members(session, league.id) == {kept: "rule", later: "rule"}


def test_changing_a_rule_leaves_the_games_already_in(session: Session, owner: Account) -> None:
    league = collections_service.create_collection(session, name="League", rule=LEAGUE_RULE)
    (first,) = _sync(session, _game("league01"))

    collections_service.update_collection(session, league.id, rule=None)
    _sync(session, _game("league02"))

    assert _members(session, league.id) == {first: "rule"}


# --- deleting games ---------------------------------------------------------------


def test_deleting_games_takes_their_memberships(
    session: Session, owner: Account, heard: list[dict[str, Any]]
) -> None:
    first, second, loose = _sync(session, _game("aaaa0001"), _game("aaaa0002"), _game("aaaa0003"))
    club = collections_service.create_collection(session, name="Club", game_ids=[first, second])
    heard.clear()

    games_service.delete_games(session, [first])

    assert _members(session, club.id) == {second: "manual"}
    # Games left a collection, so its cached summaries go and the screens hear of it.
    assert _changed(heard) == [_moved(None)]

    # A game in no collection moves nothing and says nothing.
    heard.clear()
    games_service.delete_games(session, [loose])
    assert _changed(heard) == []


def test_emptying_the_library_empties_every_collection_but_keeps_them(
    session: Session, owner: Account
) -> None:
    ids = _sync(session, _game("aaaa0001"), _game("aaaa0002"))
    club = collections_service.create_collection(
        session, name="Club", game_ids=ids, rule=LEAGUE_RULE
    )

    games_service.delete_all_games(session)

    assert session.scalar(select(func.count()).select_from(GameCollection)) == 0
    assert collections_service.get_collection(session, club.id).rule == LEAGUE_RULE


# --- filtering ---------------------------------------------------------------------


def test_the_library_filters_by_collection_and_by_rated(session: Session, owner: Account) -> None:
    rated, casual, unknown = _sync(
        session, _game("rated001"), _game("casual01", rated=False), _game("nosay001", rated=None)
    )
    club = collections_service.create_collection(session, name="Club", game_ids=[rated, casual])

    def ids(filters: GameFilters) -> list[int]:
        return sorted(game.id for game in games_service.search_games(session, filters))

    assert ids(GameFilters(collection=club.id)) == [rated, casual]
    assert games_service.count_games(session, GameFilters(collection=club.id)) == 2
    assert ids(GameFilters(rated=True)) == [rated]
    assert ids(GameFilters(rated=False)) == [casual]
    assert ids(GameFilters(collection=club.id, rated=False)) == [casual]
    assert unknown not in ids(GameFilters(rated=True)) + ids(GameFilters(rated=False))


def test_stats_narrow_to_a_collection_and_follow_its_membership(
    session: Session, owner: Account
) -> None:
    first, second, _other = _sync(session, _game("aaaa0001"), _game("aaaa0002"), _game("aaaa0003"))
    club = collections_service.create_collection(session, name="Club", game_ids=[first])

    def games_in_club() -> int:
        payload = stats.get_stats(
            session, "performance_by_speed", filters=GameFilters(collection=club.id)
        )
        return payload["total"]["games"]

    assert games_in_club() == 1
    # Inside the cache's window: the membership change is what has to invalidate it.
    collections_service.add_games(session, club.id, [second])
    assert games_in_club() == 2


def test_a_collection_counts_in_the_whole_library_too(session: Session, owner: Account) -> None:
    ids = _sync(session, _game("aaaa0001"), _game("aaaa0002"))
    collections_service.create_collection(session, name="Club", game_ids=ids[:1])

    payload = stats.get_stats(session, "performance_by_speed")

    assert payload["total"]["games"] == 2


def test_a_game_knows_its_collections(session: Session, owner: Account) -> None:
    first, second = _sync(session, _game("aaaa0001"), _game("aaaa0002"))
    club = collections_service.create_collection(session, name="Club", game_ids=[first])
    league = collections_service.create_collection(session, name="League", game_ids=[first])

    rows = games_service.game_summaries(session, games_service.search_games(session, GameFilters()))
    by_id = {row["id"]: row["collections"] for row in rows}
    cards = games_service.game_cards(session, games_service.search_games(session, GameFilters()))
    detail = games_service.get_game_detail(session, first)

    assert by_id == {first: [club.id, league.id], second: []}
    assert {card["id"]: card["collections"] for card in cards} == by_id
    assert detail is not None and detail["game"]["collections"] == [club.id, league.id]


# --- the summary ----------------------------------------------------------------------


def test_the_summary_is_the_score_line_of_the_collection(session: Session, owner: Account) -> None:
    win, loss, draw, _outside = _sync(
        session,
        _game("win00001", days=0, black_rating=1800),
        _game("loss0001", result=Result.BLACK_WIN, days=3, black_rating=1900),
        _game("draw0001", result=Result.DRAW, days=7, black_rating=None),
        _game("outside1"),
    )
    club = collections_service.create_collection(session, name="Club", game_ids=[win, loss, draw])

    detail = collections_service.detail_payload(session, club.id)

    assert detail["game_count"] == 3
    assert detail["summary"] == {
        "games": 3,
        "wins": 1,
        "draws": 1,
        "losses": 1,
        "points": 1.5,
        "avg_opponent_rating": 1850,
        # Nothing is analysed here, so there is no rate to give rather than a zero.
        "blunders_per_game": None,
        "first_played_at": START.isoformat(),
        "last_played_at": (START + timedelta(days=7)).isoformat(),
    }


def test_every_collections_summary_at_once_is_each_ones_own(
    session: Session, owner: Account
) -> None:
    win, loss, draw, _outside = _sync(
        session,
        _game("win00001", days=0),
        _game("loss0001", result=Result.BLACK_WIN, days=3, black_rating=1900),
        _game("draw0001", result=Result.DRAW, days=7, black_rating=None),
        _game("outside1"),
    )
    club = collections_service.create_collection(session, name="Club", game_ids=[win, loss])
    # Overlapping the first: a game in two collections counts in both.
    league = collections_service.create_collection(session, name="League", game_ids=[loss, draw])
    empty = collections_service.create_collection(session, name="Empty")

    listed = collections_service.list_payloads(session, with_summary=True)

    by_id = {row["id"]: row for row in listed}
    for collection in (club, league, empty):
        detail = collections_service.detail_payload(session, collection.id)
        assert by_id[collection.id] == detail
    assert by_id[club.id]["summary"]["games"] == 2
    assert by_id[league.id]["summary"]["points"] == 0.5
    assert by_id[empty.id]["summary"]["games"] == 0
    # The plain list is what it always was.
    assert "summary" not in collections_service.list_payloads(session)[0]


def test_the_summaries_are_cached_until_games_move(
    session: Session, owner: Account, monkeypatch: pytest.MonkeyPatch
) -> None:
    first, second = _sync(session, _game("aaaa0001"), _game("aaaa0002"))
    club = collections_service.create_collection(session, name="Club", game_ids=[first])
    folds: list[tuple[int, ...]] = []
    fold = stats._collection_outcome_summaries

    def counted(session: Session, ids: tuple[int, ...]) -> dict[int, dict[str, Any]]:
        folds.append(ids)
        return fold(session, ids)

    monkeypatch.setattr(stats, "_collection_outcome_summaries", counted)

    before = collections_service.list_payloads(session, with_summary=True)
    # A second screen asking, and a rename that moved no game: both from the cache.
    collections_service.update_collection(session, club.id, name="Club night")
    renamed = collections_service.list_payloads(session, with_summary=True)
    assert len(folds) == 1
    assert renamed[0]["summary"] is before[0]["summary"]
    assert renamed[0]["name"] == "Club night"

    # Games moving in is what drops it: the next ask folds again, over the new members.
    collections_service.add_games(session, club.id, [second])
    after = collections_service.list_payloads(session, with_summary=True)
    assert len(folds) == 2
    assert after[0]["summary"]["games"] == 2


# --- events -----------------------------------------------------------------------------


def test_every_change_is_announced(
    session: Session, owner: Account, heard: list[dict[str, Any]]
) -> None:
    first, second = _sync(session, _game("aaaa0001"), _game("aaaa0002"))
    club = collections_service.create_collection(session, name="Club")
    collections_service.update_collection(session, club.id, color="good", name="Club 2")
    collections_service.update_collection(session, club.id, rule=LEAGUE_RULE)
    collections_service.add_games(session, club.id, [first, second])
    collections_service.remove_games(session, club.id, [first])
    collections_service.apply_rule(session, club.id)
    collections_service.delete_collection(session, club.id)
    league = collections_service.create_collection(session, name="League", game_ids=[first])
    empty = collections_service.create_collection(session, name="Empty")
    collections_service.delete_collection(session, empty.id)

    assert _changed(heard) == [
        # Made empty, renamed and recoloured, re-ruled without applying: no game moved.
        _moved(club.id, membership=False),
        _moved(club.id, membership=False),
        _moved(club.id, membership=False),
        # In, out, and back by the rule.
        _moved(club.id),
        _moved(club.id),
        _moved(club.id),
        # Deleting one that held games empties every filter that named it.
        _moved(club.id),
        # Made with games in it; and an empty one made and deleted, which moved nothing.
        _moved(league.id),
        _moved(empty.id, membership=False),
        _moved(empty.id, membership=False),
    ]


def test_a_sync_announces_the_games_its_rules_took(
    session: Session, owner: Account, heard: list[dict[str, Any]]
) -> None:
    league = collections_service.create_collection(session, name="League", rule=LEAGUE_RULE)
    heard.clear()

    _sync(session, _game("league01"), _game("casual01", rated=False))

    assert _changed(heard) == [_moved(league.id)]


def test_a_sync_whose_rule_takes_many_games_announces_once_and_forgets_the_stats(
    session: Session, owner: Account, heard: list[dict[str, Any]]
) -> None:
    league = collections_service.create_collection(session, name="League", rule=LEAGUE_RULE)

    def games_in_league() -> int:
        payload = stats.get_stats(
            session, "performance_by_speed", filters=GameFilters(collection=league.id)
        )
        return payload["total"].get("games", 0)

    # Cached empty, inside the TTL: only the import's announcement can make it right.
    assert games_in_league() == 0
    heard.clear()

    _sync(session, *(_game(f"league{index:02}") for index in range(12)))

    assert len(_members(session, league.id)) == 12
    assert _changed(heard) == [_moved(league.id)]
    assert games_in_league() == 12


def test_a_sync_filling_two_collections_announces_once_for_both(
    session: Session, owner: Account, heard: list[dict[str, Any]]
) -> None:
    collections_service.create_collection(session, name="League", rule=LEAGUE_RULE)
    collections_service.create_collection(session, name="Classical", rule={"speed": ["classical"]})
    heard.clear()

    _sync(session, _game("league01"), _game("league02"))

    assert _changed(heard) == [_moved(None)]


def test_a_sync_that_fails_part_way_still_announces_what_it_filed(
    session: Session, owner: Account, heard: list[dict[str, Any]]
) -> None:
    league = collections_service.create_collection(session, name="League", rule=LEAGUE_RULE)
    heard.clear()

    def stream() -> Iterator[ParsedGame]:
        yield _game("league01")
        raise RuntimeError("the connection dropped")

    job = ImportJob(source=Source.LICHESS, status=JobStatus.RUNNING)
    with pytest.raises(RuntimeError):
        import_service.ingest_games(session, job, stream(), analyze=False)

    assert len(_members(session, league.id)) == 1
    assert _changed(heard) == [_moved(league.id)]


def test_a_game_stored_with_a_side_the_caller_knows_meets_the_colour_rules(
    session: Session, heard: list[dict[str, Any]]
) -> None:
    # No account at all: a correspondence handle, whose side the owner said.
    as_white = collections_service.create_collection(
        session, name="As white", rule={"color": "white"}
    )
    heard.clear()

    outcome = import_service.import_one(
        session, _game("iccf0001", white="myiccfname"), analyze=False, owner_side=Color.WHITE
    )

    assert outcome.game is not None
    assert outcome.game.owner_color == Color.WHITE and outcome.game.is_owner_game
    assert _members(session, as_white.id) == {outcome.game.id: "rule"}
    assert _changed(heard) == [_moved(as_white.id)]


def test_learning_a_games_side_asks_the_colour_rules_and_no_others(
    session: Session, owner: Account, heard: list[dict[str, Any]]
) -> None:
    as_white = collections_service.create_collection(
        session, name="As white", rule={"color": "white"}
    )
    league = collections_service.create_collection(session, name="League", rule=LEAGUE_RULE)
    # A sync under a name that is no account yet: the owner's game, side unknown.
    (game_id,) = _sync(session, _game("otbname1", white="otbname"))
    assert session.get(Game, game_id).owner_color is None
    assert _members(session, as_white.id) == {}
    # The league rule could answer, and did; the owner then took the game out by hand.
    assert _members(session, league.id) == {game_id: "rule"}
    collections_service.remove_games(session, league.id, [game_id])
    heard.clear()

    accounts_service.register_account(session, Platform.LICHESS, "otbname")

    assert session.get(Game, game_id).owner_color == Color.WHITE
    assert _members(session, as_white.id) == {game_id: "rule"}
    assert _members(session, league.id) == {}
    assert _changed(heard) == [_moved(as_white.id)]


def test_a_reference_game_that_turns_out_to_be_the_owners_meets_every_rule(
    session: Session, owner: Account
) -> None:
    league = collections_service.create_collection(session, name="League", rule=LEAGUE_RULE)
    job = ImportJob(source=Source.LICHESS, status=JobStatus.RUNNING)
    import_service.ingest_games(
        session,
        job,
        [_game("stranger", white="secondhandle")],
        analyze=False,
        presume_owner=False,
    )
    game_id = session.scalars(select(Game.id).where(Game.source_id == "stranger")).one()
    assert _members(session, league.id) == {}

    accounts_service.register_account(session, Platform.LICHESS, "secondhandle")

    assert session.get(Game, game_id).is_owner_game
    assert _members(session, league.id) == {game_id: "rule"}


def _age(session: Session, game_id: int, minutes: int) -> None:
    """Say the game was imported this long ago, so "before the rule" is not a race."""
    game = session.get(Game, game_id)
    assert game is not None
    game.imported_at = game.imported_at - timedelta(minutes=minutes)
    session.commit()


def test_learning_a_side_does_not_let_a_newer_colour_rule_reach_an_old_game(
    session: Session, owner: Account, heard: list[dict[str, Any]]
) -> None:
    (old,) = _sync(session, _game("otbname1", white="otbname"))
    _age(session, old, 60)
    # Written after the game arrived: the import never asked it about this game.
    as_white = collections_service.create_collection(
        session, name="As white", rule={"color": "white"}
    )
    (new,) = _sync(session, _game("otbname2", white="otbname"))
    heard.clear()

    accounts_service.register_account(session, Platform.LICHESS, "otbname")

    assert session.get(Game, old).owner_color == Color.WHITE
    assert session.get(Game, new).owner_color == Color.WHITE
    # Only the game imported under the rule is what the import would have filed.
    assert _members(session, as_white.id) == {new: "rule"}
    assert _changed(heard) == [_moved(as_white.id)]
    # And the explicit catch-up is still how the old one gets in.
    assert collections_service.apply_rule(session, as_white.id) == 1


def test_a_rule_rewritten_after_the_import_does_not_take_the_game_later(
    session: Session, owner: Account
) -> None:
    as_white = collections_service.create_collection(
        session, name="As white", rule={"color": "black"}
    )
    (game_id,) = _sync(session, _game("otbname1", white="otbname"))
    _age(session, game_id, 60)
    # The import met the old form of the rule; this form never saw the game arrive.
    collections_service.update_collection(session, as_white.id, rule={"color": "white"})
    # Saving the same rule again changes nothing, the stamp included.
    stamp = collections_service.get_collection(session, as_white.id).rule_set_at
    collections_service.update_collection(session, as_white.id, rule={"color": "white"})
    assert collections_service.get_collection(session, as_white.id).rule_set_at == stamp

    accounts_service.register_account(session, Platform.LICHESS, "otbname")

    assert _members(session, as_white.id) == {}


def test_a_reference_game_is_only_taken_by_the_rules_that_stood_when_it_arrived(
    session: Session, owner: Account
) -> None:
    older = collections_service.create_collection(session, name="League", rule=LEAGUE_RULE)
    # Stood two hours before the game arrived, which then arrived an hour before the newer
    # rule, so neither "before" is a race on the clock.
    older.rule_set_at = older.rule_set_at - timedelta(minutes=120)
    session.commit()
    job = ImportJob(source=Source.LICHESS, status=JobStatus.RUNNING)
    import_service.ingest_games(
        session, job, [_game("stranger", white="secondhandle")], analyze=False, presume_owner=False
    )
    game_id = session.scalars(select(Game.id).where(Game.source_id == "stranger")).one()
    _age(session, game_id, 60)
    newer = collections_service.create_collection(
        session, name="Classical", rule={"speed": ["classical"]}
    )

    accounts_service.register_account(session, Platform.LICHESS, "secondhandle")

    assert _members(session, older.id) == {game_id: "rule"}
    assert _members(session, newer.id) == {}


# --- the rules, read once per import ------------------------------------------------------


def _rule_reads(session: Session) -> tuple[list[str], Any]:
    """Every statement that reads the collections' rules, and the hook to stop listening."""
    reads: list[str] = []
    engine = session.get_bind()

    def listen(_conn: Any, _cursor: Any, statement: str, *_args: Any) -> None:
        if "collections.rule IS NOT NULL" in statement:
            reads.append(statement)

    event.listen(engine, "before_cursor_execute", listen)
    return reads, lambda: event.remove(engine, "before_cursor_execute", listen)


def test_a_sync_reads_the_rules_once_and_files_every_game_as_before(
    session: Session, owner: Account
) -> None:
    league = collections_service.create_collection(session, name="League", rule=LEAGUE_RULE)
    as_black = collections_service.create_collection(
        session, name="As black", rule={"color": "black"}
    )
    reads, stop = _rule_reads(session)
    try:
        rated, casual, black = _sync(
            session,
            _game("league01"),
            _game("casual01", rated=False),
            _game("black001", white="leaguemate", black=OWNER),
            _game("league01"),
        )
    finally:
        stop()

    assert len(reads) == 1
    assert _members(session, league.id) == {rated: "rule", black: "rule"}
    assert _members(session, as_black.id) == {black: "rule"}
    assert casual


def test_a_rule_written_during_a_sync_is_heard_at_the_next_game(
    session: Session, owner: Account
) -> None:
    made: list[int] = []

    def stream() -> Iterator[ParsedGame]:
        yield _game("league01")
        made.append(
            collections_service.create_collection(session, name="League", rule=LEAGUE_RULE).id
        )
        yield _game("league02")

    job = ImportJob(source=Source.LICHESS, status=JobStatus.RUNNING)
    import_service.ingest_games(session, job, stream(), analyze=False)

    second = session.scalars(select(Game.id).where(Game.source_id == "league02")).one()
    assert _members(session, made[0]) == {second: "rule"}


def test_a_collection_deleted_under_a_held_rule_book_fails_no_import(
    session: Session, owner: Account
) -> None:
    league = collections_service.create_collection(session, name="League", rule=LEAGUE_RULE)
    book = collections_service.RuleBook()
    assert [rule.collection_id for rule in book.current(session)] == [league.id]
    # Gone behind the book's back, the way another process would delete it.
    session.execute(delete(Collection).where(Collection.id == league.id))
    job = ImportJob(source=Source.LICHESS, status=JobStatus.RUNNING)
    session.add(job)
    session.commit()

    outcome = import_service.ingest_game(
        session, job, _game("league01"), analyze=False, rules=book
    )
    session.commit()

    assert outcome.created and outcome.collections == ()
    assert session.scalar(select(func.count()).select_from(GameCollection)) == 0


# --- writes that overlap -----------------------------------------------------------------


def test_adding_a_game_twice_at_once_adds_it_once(session: Session, owner: Account) -> None:
    (game_id,) = _sync(session, _game("aaaa0001"))
    club = collections_service.create_collection(session, name="Club")

    # What the loser of two overlapping adds meets: the membership its read did not see.
    assert collections_service._insert_members(session, club.id, [game_id], "manual") == 1
    assert collections_service._insert_members(session, club.id, [game_id], "rule") == 0
    session.commit()

    assert _members(session, club.id) == {game_id: "manual"}


def test_a_name_taken_between_the_check_and_the_write_is_still_name_taken(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    collections_service.create_collection(session, name="League")
    # The other request's check ran before this one's write: it saw the name free.
    monkeypatch.setattr(collections_service, "_valid_name", lambda _session, name, keep=None: name)

    with pytest.raises(collections_service.CollectionNameTakenError):
        collections_service.create_collection(session, name="League")
    assert session.scalar(select(func.count()).select_from(Collection)) == 1


def test_a_collection_stats_answer_computed_across_a_membership_change_is_not_kept() -> None:
    computed: list[int] = []

    def overtaken() -> int:
        # The membership write lands while this computation is reading the old library.
        stats.forget_collection_payloads()
        computed.append(1)
        return len(computed)

    key = stats._cache_key("test-overtaken", GameFilters(collection=1))
    assert stats._cached(key, overtaken) == 1
    # Not served from the cache: the next caller computes against the new library.
    assert stats._cached(key, lambda: 2) == 2
    assert stats._cached(key, lambda: 3) == 2


def test_an_answer_about_no_collection_computed_across_a_membership_change_is_kept() -> None:
    def across_a_write() -> str:
        stats.forget_collection_payloads()
        return "library"

    key = stats._cache_key("test-whole-library", GameFilters())
    assert stats._cached(key, across_a_write) == "library"
    # A collection hides no game, so the whole library's answer did not move: it is kept.
    assert stats._cached(key, lambda: "scanned again") == "library"


def test_a_membership_write_forgets_only_the_answers_scoped_to_a_collection(
    session: Session, owner: Account
) -> None:
    first, second, _other = _sync(session, _game("aaaa0001"), _game("aaaa0002"), _game("aaaa0003"))
    club = collections_service.create_collection(session, name="Club", game_ids=[first])
    scoped = GameFilters(collection=club.id)

    library = stats.get_stats(session, "performance_by_speed")
    in_club = stats.get_stats(session, "performance_by_speed", filters=scoped)
    dashboard = stats.get_dashboard(session, filters=scoped)
    assert in_club["total"]["games"] == 1
    whole_key = stats._cache_key("get_stats", "performance_by_speed", GameFilters(), {})
    scoped_key = stats._cache_key("get_stats", "performance_by_speed", scoped, {})
    assert whole_key in stats._CACHE and scoped_key in stats._CACHE
    cached_before = set(stats._CACHE)

    collections_service.add_games(session, club.id, [second])

    # The unscoped entry is the very object it was, still serving; every scoped one is gone.
    assert whole_key in stats._CACHE
    assert stats.get_stats(session, "performance_by_speed") is library
    assert not any(stats._collection_scoped(key) for key in stats._CACHE)
    assert {key for key in cached_before if not stats._collection_scoped(key)} <= set(
        stats._CACHE
    )
    assert stats.get_stats(session, "performance_by_speed", filters=scoped)["total"]["games"] == 2
    assert stats.get_dashboard(session, filters=scoped) is not dashboard


def test_a_change_that_moves_no_game_keeps_even_the_collections_answers(
    session: Session, owner: Account
) -> None:
    (first,) = _sync(session, _game("aaaa0001"))
    club = collections_service.create_collection(session, name="Club", game_ids=[first])
    scoped = GameFilters(collection=club.id)
    before = stats.get_stats(session, "performance_by_speed", filters=scoped)

    collections_service.update_collection(session, club.id, name="Renamed", color="good")
    collections_service.update_collection(session, club.id, rule=LEAGUE_RULE)

    assert stats.get_stats(session, "performance_by_speed", filters=scoped) is before


def test_the_summary_scores_only_games_with_a_side_of_the_owners(
    session: Session, owner: Account
) -> None:
    (mine,) = _sync(session, _game("mine0001"))
    job = ImportJob(source=Source.LICHESS, status=JobStatus.RUNNING)
    import_service.ingest_games(
        session,
        job,
        [_game("model001", white="carlsen", black="caruana")],
        analyze=False,
        presume_owner=False,
    )
    reference = session.scalars(select(Game.id).where(Game.source_id == "model001")).one()
    club = collections_service.create_collection(session, name="Club", game_ids=[mine, reference])

    detail = collections_service.detail_payload(session, club.id)

    # Every game in it is what the page lists (whose=all); the score is the owner's.
    assert detail["game_count"] == 2
    assert games_service.count_games(session, GameFilters(collection=club.id, mine=None)) == 2
    assert detail["summary"]["games"] == 1


# --- the migration -----------------------------------------------------------------------


def test_the_migration_goes_down_and_up_again(settings: Settings) -> None:
    upgrade_to_head(settings)
    config = alembic_config(settings)

    command.downgrade(config, "0029_engine_declared_options")
    tables = set(inspect(get_engine(settings)).get_table_names())
    assert "collections" not in tables and "game_collections" not in tables

    command.upgrade(config, "head")
    inspector = inspect(get_engine(settings))
    assert {"collections", "game_collections"} <= set(inspector.get_table_names())
    assert ("collection_id",) in {
        tuple(index["column_names"]) for index in inspector.get_indexes("game_collections")
    }


def test_a_rule_set_before_the_stamp_existed_is_dated_by_its_collection(
    settings: Settings,
) -> None:
    upgrade_to_head(settings)
    config = alembic_config(settings)
    command.downgrade(config, "0030_collections")
    engine = get_engine(settings)
    assert "rule_set_at" not in {
        column["name"] for column in inspect(engine).get_columns("collections")
    }
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "INSERT INTO collections (name, color, rule, created_at) "
            "VALUES ('League', 'accent', '{\"rated\": true}', '2026-09-20 18:00:00.000000')"
        )

    command.upgrade(config, "head")

    columns = {column["name"]: column for column in inspect(engine).get_columns("collections")}
    assert columns["rule_set_at"]["nullable"] is False
    with engine.connect() as connection:
        stamped = connection.exec_driver_sql(
            "SELECT rule_set_at, created_at FROM collections"
        ).one()
    assert stamped[0] == stamped[1]


def test_the_upgrade_pins_no_collection_the_rail_never_showed(
    settings: Settings,
) -> None:
    upgrade_to_head(settings)
    config = alembic_config(settings)
    command.downgrade(config, "0034_game_ply_offset")
    engine = get_engine(settings)
    with engine.begin() as connection:
        for name in ("club", "Archive", "League"):
            connection.exec_driver_sql(
                "INSERT INTO collections (name, color, rule_set_at, created_at) "
                f"VALUES ('{name}', 'accent', '2026-09-20 18:00:00', '2026-09-20 18:00:00')"
            )

    command.upgrade(config, "head")

    with engine.connect() as connection:
        pinned = connection.exec_driver_sql(
            "SELECT name FROM collections WHERE pinned ORDER BY name"
        ).scalars()
        assert list(pinned) == []


# --- the HTTP surface ----------------------------------------------------------------------


@pytest.fixture()
def api(settings: Settings) -> Iterator[tuple[TestClient, list[int]]]:
    """The app over a migrated library of three games: two league games and a casual one."""
    upgrade_to_head(settings)
    with get_sessionmaker(settings)() as session:
        session.add(Account(platform=Platform.LICHESS, username=OWNER, is_owner=True))
        session.commit()
        ids = _sync(
            session,
            _game("league01", days=0),
            _game("league02", days=1, result=Result.DRAW),
            _game("casual01", days=2, rated=False),
        )
    settings.analysis_workers = False
    with running_app(create_app(settings)) as client:
        yield client, ids


def test_the_api_makes_lists_and_describes_a_collection(
    api: tuple[TestClient, list[int]],
) -> None:
    client, (first, second, casual) = api

    made = client.post(
        "/collections",
        json={
            "name": "45-45 League",
            "color": "way-back",
            "rule": {"source": "lichess", "time_control": "2700+45", "rated": True},
            "apply_to_existing": True,
        },
    )
    assert made.status_code == 201, made.text
    body = made.json()
    assert body["game_count"] == 2
    assert body["rule"] == LEAGUE_RULE
    assert body["description"] is None

    assert client.post("/collections", json={"name": "45-45 LEAGUE"}).json()["error"] == (
        "name_taken"
    )
    assert client.post("/collections", json={"name": "x", "color": "pink"}).status_code == 422
    assert (
        client.post("/collections", json={"name": "x", "rule": {"since": "2026-01-01"}}).status_code
        == 422
    )

    listed = client.get("/collections").json()["collections"]
    assert [row["name"] for row in listed] == ["45-45 League"]

    detail = client.get(f"/collections/{body['id']}").json()
    assert detail["summary"]["games"] == 2
    assert detail["summary"]["wins"] == 1
    assert detail["summary"]["draws"] == 1
    assert detail["summary"]["points"] == 1.5
    assert client.get("/collections/999").json()["error"] == "unknown_collection"
    assert casual not in (first, second)


def test_the_api_lists_every_score_line_only_when_asked(
    api: tuple[TestClient, list[int]],
) -> None:
    client, (first, second, casual) = api
    club = client.post("/collections", json={"name": "Club", "game_ids": [first, second]}).json()
    client.post("/collections", json={"name": "Empty"})

    plain = client.get("/collections").json()["collections"]
    assert [row["name"] for row in plain] == ["Club", "Empty"]
    assert all("summary" not in row for row in plain)
    assert plain[0]["description"] is None and plain[0]["rule"] is None

    overview = client.get("/collections", params={"with_summary": True})
    assert overview.status_code == 200, overview.text
    rows = {row["name"]: row for row in overview.json()["collections"]}
    assert rows["Club"]["summary"] == client.get(f"/collections/{club['id']}").json()["summary"]
    assert rows["Club"]["summary"]["games"] == 2
    assert rows["Club"]["summary"]["points"] == 1.5
    assert rows["Empty"]["summary"]["games"] == 0
    assert rows["Club"]["game_count"] == 2 and casual not in (first, second)


def test_the_api_patches_only_what_it_is_sent(api: tuple[TestClient, list[int]]) -> None:
    client, _ids = api
    made = client.post(
        "/collections", json={"name": "League", "description": "Tuesdays", "rule": LEAGUE_RULE}
    ).json()

    renamed = client.patch(f"/collections/{made['id']}", json={"name": "Liga"}).json()
    assert renamed["name"] == "Liga"
    assert renamed["description"] == "Tuesdays"
    assert renamed["rule"] == LEAGUE_RULE

    assert renamed["pinned"] is False
    pinned = client.patch(f"/collections/{made['id']}", json={"pinned": True}).json()
    assert pinned["pinned"] is True
    assert pinned["name"] == "Liga"

    cleared = client.patch(f"/collections/{made['id']}", json={"rule": None}).json()
    assert cleared["rule"] is None
    assert cleared["pinned"] is True
    assert client.post(f"/collections/{made['id']}/apply-rule").json()["error"] == "no_rule"

    assert client.delete(f"/collections/{made['id']}").status_code == 204
    assert client.get("/collections").json()["collections"] == []


def test_the_api_moves_games_in_and_out(api: tuple[TestClient, list[int]]) -> None:
    client, (first, second, casual) = api
    club = client.post("/collections", json={"name": "Club"}).json()

    added = client.post(f"/collections/{club['id']}/games", json={"game_ids": [first, casual, 9]})
    assert added.json()["added"] == 2
    assert added.json()["collection"]["game_count"] == 2

    removed = client.post(f"/collections/{club['id']}/games/remove", json={"game_ids": [first]})
    assert removed.json()["removed"] == 1
    assert removed.json()["collection"]["game_count"] == 1

    ruled = client.patch(f"/collections/{club['id']}", json={"rule": LEAGUE_RULE})
    assert ruled.status_code == 200
    applied = client.post(f"/collections/{club['id']}/apply-rule").json()
    # Asking for it brings back the game a hand took out: that is what "apply" means.
    assert applied["added"] == 2
    assert applied["collection"]["game_count"] == 3


def test_the_games_list_carries_and_filters_by_collections(
    api: tuple[TestClient, list[int]],
) -> None:
    client, (first, second, casual) = api
    club = client.post("/collections", json={"name": "Club", "game_ids": [first, casual]}).json()

    rows = {row["id"]: row["collections"] for row in client.get("/games").json()["games"]}
    assert rows == {first: [club["id"]], second: [], casual: [club["id"]]}
    cards = client.get("/games", params={"cards": True}).json()["games"]
    assert {row["id"]: row["collections"] for row in cards} == rows
    assert client.get(f"/games/{first}").json()["game"]["collections"] == [club["id"]]
    engine = client.put(f"/games/{first}/engine", json={"hidden": False}).json()
    assert engine["collections"] == [club["id"]]

    in_club = client.get("/games", params={"collection": club["id"]}).json()
    assert {row["id"] for row in in_club["games"]} == {first, casual}
    assert in_club["total"] == 2
    rated = client.get("/games", params={"collection": club["id"], "rated": True}).json()
    assert [row["id"] for row in rated["games"]] == [first]

    speed = client.get(
        "/stats/performance_by_speed", params={"collection": club["id"], "rated": False}
    )
    assert speed.status_code == 200, speed.text
    assert speed.json()["total"]["games"] == 1


def test_a_membership_change_reaches_the_event_socket(
    api: tuple[TestClient, list[int]],
) -> None:
    client, (first, _second, _casual) = api
    club = client.post("/collections", json={"name": "Club"}).json()

    with client.websocket_connect("/events", headers=socket_headers(client)) as socket:
        client.post(f"/collections/{club['id']}/games", json={"game_ids": [first]})
        for _ in range(20):
            event = socket.receive_json()
            if event.get("event") == "collections.changed":
                break
        assert event == _moved(club["id"])


def test_a_rule_naming_a_colour_takes_only_the_games_played_with_it(
    session: Session, owner: Account
) -> None:
    rule = {**LEAGUE_RULE, "color": "black"}
    league = collections_service.create_collection(session, name="As black", rule=rule)

    (as_white, as_black) = _sync(
        session, _game("white001"), _game("black001", white="leaguemate", black=OWNER)
    )

    assert _members(session, league.id) == {as_black: "rule"}
    assert session.get(Game, as_black).owner_color == Color.BLACK
    assert as_white

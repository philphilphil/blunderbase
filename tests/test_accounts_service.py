from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.db.enums import Color, Platform, Result, Source
from backend.db.models import Account, Game
from backend.services import accounts, games

OWNER = "phib2"


def _add_game(
    session: Session,
    *,
    source: Source = Source.CHESSCOM,
    white: str = OWNER,
    black: str = "rival",
    white_rating: int | None = 1500,
    black_rating: int | None = 1600,
    result: Result = Result.WHITE_WIN,
    **changes: Any,
) -> Game:
    """One stored game, the way a sync that had no account row to read left it behind."""
    game = Game(
        source=source,
        dedup_hash=f"{source}:{white}:{black}:{changes.get('source_id', '')}",
        white_name=white,
        black_name=black,
        white_rating=white_rating,
        black_rating=black_rating,
        result=result,
        pgn="",
        **changes,
    )
    session.add(game)
    session.commit()
    return game


def test_an_account_is_created_once_however_the_username_is_capitalised(
    session: Session,
) -> None:
    first = accounts.register_account(session, Platform.CHESSCOM, OWNER)
    again = accounts.register_account(session, Platform.CHESSCOM, "PHIB2")

    assert again.id == first.id
    stored = session.scalars(select(Account)).one()
    assert (stored.platform, stored.username, stored.is_owner) == (
        Platform.CHESSCOM,
        OWNER,
        True,
    )


def test_registering_an_account_backfills_the_games_it_already_played(
    session: Session,
) -> None:
    """The production case: 1027 games synced before any account row named their owner."""
    as_white = _add_game(session, white=OWNER, black="rival")
    as_black = _add_game(session, white="rival", black=OWNER)
    assert as_white.owner_color is None

    account = accounts.register_account(session, Platform.CHESSCOM, OWNER)

    assert as_white.owner_color is Color.WHITE
    assert as_white.white_account_id == account.id
    assert as_black.owner_color is Color.BLACK
    assert as_black.black_account_id == account.id


def test_the_backfill_folds_case_the_way_the_platforms_do(session: Session) -> None:
    game = _add_game(session, white="PhiB2")

    accounts.register_account(session, Platform.CHESSCOM, "phib2")

    assert game.owner_color is Color.WHITE


def test_an_existing_account_becomes_the_owners_when_a_sync_asks_for_it(
    session: Session,
) -> None:
    session.add(Account(platform=Platform.CHESSCOM, username=OWNER, is_owner=False))
    session.commit()
    game = _add_game(session, white=OWNER)

    account = accounts.register_account(session, Platform.CHESSCOM, OWNER)

    assert account.is_owner is True
    assert game.owner_color is Color.WHITE


def test_a_game_the_owner_did_not_play_in_keeps_no_colour(session: Session) -> None:
    stranger = _add_game(session, white="someone", black="rival")

    accounts.register_account(session, Platform.CHESSCOM, OWNER)

    assert stranger.owner_color is None
    assert stranger.white_account_id is None and stranger.black_account_id is None


def test_an_account_does_not_claim_the_same_name_on_another_platform(
    session: Session,
) -> None:
    elsewhere = _add_game(session, source=Source.LICHESS, white=OWNER)

    accounts.register_account(session, Platform.CHESSCOM, OWNER)

    assert elsewhere.owner_color is None
    assert elsewhere.white_account_id is None


def test_a_pgn_game_is_claimed_by_the_username_alone(session: Session) -> None:
    """A PGN belongs to no platform, which is the rule the import applies on the way in."""
    game = _add_game(session, source=Source.PGN, white="rival", black=OWNER)

    account = accounts.register_account(session, Platform.CHESSCOM, OWNER)

    assert game.owner_color is Color.BLACK
    assert game.black_account_id == account.id


def test_a_pgn_game_stays_unclaimed_when_two_accounts_share_a_username(
    session: Session,
) -> None:
    session.add_all(
        [
            Account(platform=Platform.LICHESS, username=OWNER, is_owner=False),
            Account(platform=Platform.CHESSCOM, username=OWNER, is_owner=False),
        ]
    )
    session.commit()
    game = _add_game(session, source=Source.PGN, white=OWNER)

    accounts.reconcile_games(session)

    assert game.owner_color is None
    assert game.white_account_id is None


def test_a_colour_that_is_already_set_is_never_overwritten(session: Session) -> None:
    """A repair fills in what an import could not know; it does not revise its decisions."""
    game = _add_game(session, white="rival", black=OWNER, owner_color=Color.WHITE)

    accounts.register_account(session, Platform.CHESSCOM, OWNER)

    assert game.owner_color is Color.WHITE
    assert game.black_account_id is not None


def test_a_reconciliation_reports_what_it_filled_in(session: Session) -> None:
    _add_game(session, white=OWNER, source_id="1")
    _add_game(session, white="rival", black=OWNER, source_id="2")
    _add_game(session, white="someone", black="rival", source_id="3")
    session.add(Account(platform=Platform.CHESSCOM, username=OWNER, is_owner=True))
    session.commit()

    filled = accounts.reconcile_games(session)

    assert (filled.linked, filled.colored) == (2, 2)
    assert accounts.reconcile_games(session) == accounts.Reconciled(linked=0, colored=0)


def test_learning_the_owners_colour_throws_away_the_stats_folded_without_it(
    session: Session,
) -> None:
    """A game with no owner counts all of its plies; one with an owner counts half of them.

    So a summary folded before the account existed is not stale by any run's reckoning and
    is wrong all the same — it is cleared here, and the backfill sweep folds it again.
    """
    game = _add_game(session, white=OWNER, owner_color=None)
    game.stat_summary = {"run_id": 7, "owner_moves": 4}
    game.stat_owner_moves = 4
    game.stat_blunders = 2
    game.stat_worst_win_loss = 40.0
    session.commit()

    accounts.register_account(session, Platform.CHESSCOM, OWNER)

    assert game.owner_color is Color.WHITE
    assert game.stat_summary is None
    assert (game.stat_owner_moves, game.stat_blunders, game.stat_worst_win_loss) == (
        None,
        None,
        None,
    )


def test_the_game_summary_reports_the_opponent_and_the_ratings_after_a_repair(
    session: Session,
) -> None:
    """What the /games table and the dashboard cards read, and what they showed empty."""
    game = _add_game(
        session, white="rival", black=OWNER, white_rating=1600, black_rating=1500
    )
    assert "opponent" not in games.game_summary(game)

    accounts.register_account(session, Platform.CHESSCOM, OWNER)

    summary = games.game_summary(game)
    assert summary["color"] == "black"
    assert summary["opponent"] == "rival"
    assert summary["opponent_rating"] == 1600
    assert summary["rating"] == 1500
    assert summary["outcome"] == "loss"


def test_an_account_is_found_whatever_case_it_is_asked_for(session: Session) -> None:
    account = accounts.register_account(session, Platform.LICHESS, "Phib")

    assert accounts.find_account(session, Platform.LICHESS, "PHIB") == account
    assert accounts.find_account(session, Platform.CHESSCOM, "phib") is None
    assert accounts.find_account(session, Platform.LICHESS, "  ") is None

from __future__ import annotations

import threading
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import event, func, inspect, select, update
from sqlalchemy.orm import Session

from backend.db.enums import (
    Classification,
    Color,
    EngineKind,
    NoteSource,
    Platform,
    Result,
    RunStatus,
    Source,
    Speed,
    Tier,
)
from backend.db.models import (
    Account,
    AnalysisRun,
    Engine,
    Game,
    GamePosition,
    MoveEval,
    Note,
    Position,
    PositionMove,
    PositionTotal,
)
from backend.services import analysis, explorer, notes, stats
from backend.services import games as games_service
from backend.services import live as live_service
from backend.services.games import GameFilters
from backend.services.import_service import run_import

OWNER = "blunderbase"
START_EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"
AFTER_E4_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -"
# Two kings, two rooks and pawns: well under the endgame material threshold.
ENDGAME_FEN = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 4 30"

# The same Ruy Lopez the fixture's first two games play, by a move order that reaches it
# from the other side: a transposition, which is what a positional book has to count.
TRANSPOSED_PGN = """[Event "Rated Blitz game"]
[Site "https://lichess.org/qg000007"]
[Date "2026.04.01"]
[White "blunderbase"]
[Black "transposer"]
[Result "1-0"]
[UTCDate "2026.04.01"]
[UTCTime "12:00:00"]
[WhiteElo "1770"]
[BlackElo "1750"]
[TimeControl "300+3"]
[ECO "C65"]
[Opening "Ruy Lopez: Berlin Defense"]
[Termination "Normal"]

1. Nf3 Nc6 2. e4 e5 3. Bb5 Nf6 4. d3 d6 1-0
"""


@dataclass(slots=True)
class Library:
    """The six imported fixture games, addressable by the site ID they came in with."""

    session: Session
    by_source_id: dict[str, Game]

    def __getitem__(self, source_id: str) -> Game:
        return self.by_source_id[source_id]

    @property
    def all(self) -> list[Game]:
        return list(self.by_source_id.values())


@pytest.fixture()
def library(session: Session, fixtures_dir: Path) -> Library:
    """The fixture PGN imported through the real pipeline, owned by one account."""
    session.add(Account(platform=Platform.LICHESS, username=OWNER, is_owner=True))
    session.commit()
    job = run_import(session, Source.PGN, path=str(fixtures_dir / "query_games.pgn"))
    assert job.games_imported == 6, job.errors
    stored = session.scalars(select(Game).order_by(Game.id)).all()
    return Library(session=session, by_source_id={game.source_id: game for game in stored})


@pytest.fixture()
def engine_row(session: Session) -> Engine:
    engine = Engine(name="stockfish-test", kind=EngineKind.UCI, path="/nonexistent/stockfish")
    session.add(engine)
    session.commit()
    return engine


def analyse(
    session: Session,
    game: Game,
    evals: Sequence[dict[str, Any]],
    *,
    engine: Engine | None = None,
    tier: Tier = Tier.QUICK,
    status: RunStatus = RunStatus.DONE,
    ply_start: int | None = None,
    ply_end: int | None = None,
    created_at: datetime | None = None,
) -> AnalysisRun:
    """Hand-write one finished run over a game, the way a worker eventually will."""
    run = AnalysisRun(
        game_id=game.id,
        engine_id=engine.id if engine is not None else None,
        tier=tier,
        status=status,
        ply_start=ply_start,
        ply_end=ply_end,
        finished_at=datetime.now(UTC),
    )
    if created_at is not None:
        run.created_at = created_at
    session.add(run)
    session.flush()
    for entry in evals:
        ply = entry["ply"]
        session.add(
            MoveEval(
                run_id=run.id,
                ply=ply,
                move_san=entry.get("san", game.moves_san[ply] if ply < game.ply_count else None),
                move_uci=entry.get("uci", game.moves_uci[ply] if ply < game.ply_count else None),
                classification=entry.get("classification"),
                win_loss=entry.get("win_loss"),
                win_before=entry.get("win_before"),
                win_after=entry.get("win_after"),
                eval_after_cp=entry.get("cp"),
                best_move_uci=entry.get("best_move_uci"),
                best_lines=entry.get("best_lines"),
                maia_policy=entry.get("maia_policy"),
                position_id=entry.get("position_id"),
            )
        )
    session.commit()
    return run


@pytest.fixture()
def analysed(library: Library, engine_row: Engine) -> Library:
    """Quick passes over the short Ruy Lopez and the long Italian, plus a decoy.

    The decoy — a game where only the opponent blundered — is what proves every count
    below is the owner's own moves and not simply every classified ply.
    """
    session = library.session
    analyse(
        session,
        library["qg000001"],
        [
            {"ply": 0, "classification": Classification.GOOD, "win_loss": 1.0, "win_after": 52.0},
            {"ply": 1, "classification": Classification.BLUNDER, "win_loss": 50.0},
            {"ply": 2, "classification": Classification.INACCURACY, "win_loss": 6.0},
            {"ply": 3, "classification": Classification.BLUNDER, "win_loss": 51.0},
            {"ply": 4, "classification": Classification.MISTAKE, "win_loss": 12.0},
            {"ply": 6, "classification": Classification.BLUNDER, "win_loss": 30.0},
            {
                "ply": 8,
                "classification": Classification.BLUNDER,
                "win_loss": 42.0,
                "win_after": 12.0,
                "best_move_uci": "d2d3",
            },
        ],
        engine=engine_row,
    )
    analyse(
        session,
        library["qg000006"],
        [
            {"ply": 20, "classification": Classification.GOOD, "win_loss": 2.0},
            {"ply": 24, "classification": Classification.INACCURACY, "win_loss": 7.0},
            {"ply": 26, "classification": Classification.MISTAKE, "win_loss": 15.0},
            {"ply": 28, "classification": Classification.BLUNDER, "win_loss": 35.0},
            {
                "ply": 30,
                "classification": Classification.BLUNDER,
                "win_loss": 55.0,
                "best_move_uci": "g1h2",
            },
        ],
        engine=engine_row,
    )
    analyse(
        session,
        library["qg000003"],
        [{"ply": 5, "classification": Classification.BLUNDER, "win_loss": 60.0}],
        engine=engine_row,
    )
    return library


# --------------------------------------------------------------------------- games


def test_search_returns_every_owned_game_newest_first(library: Library) -> None:
    found = games_service.search_games(library.session, GameFilters())
    assert [game.source_id for game in found] == [
        "qg000006",
        "qg000005",
        "qg000004",
        "qg000003",
        "qg000002",
        "qg000001",
    ]


def test_search_paginates(library: Library) -> None:
    session = library.session
    page = games_service.search_games(session, GameFilters(), limit=2, offset=2)
    assert [game.source_id for game in page] == ["qg000004", "qg000003"]
    assert games_service.count_games(session, GameFilters()) == 6


def test_filters_narrow_by_colour_speed_and_eco(library: Library) -> None:
    session = library.session
    black = games_service.search_games(session, GameFilters(color=Color.BLACK))
    assert [game.source_id for game in black] == ["qg000005"]

    blitz = games_service.search_games(session, GameFilters(speed=Speed.BLITZ))
    assert {game.source_id for game in blitz} == {"qg000001", "qg000002", "qg000005"}

    # An ECO filter is a prefix, so "C6" is the whole Ruy Lopez range and not one code.
    ruy = games_service.search_games(session, GameFilters(eco="C6"))
    assert {game.source_id for game in ruy} == {"qg000001", "qg000002"}
    berlin = games_service.search_games(session, GameFilters(eco="C65"))
    assert {game.source_id for game in berlin} == {"qg000001"}


def test_outcome_is_read_from_the_owner_side_of_the_board(library: Library) -> None:
    session = library.session
    wins = games_service.search_games(session, GameFilters(outcome="win"))
    # The Sicilian was black's win, and it counts as a win even though the result is 0-1.
    assert {game.source_id for game in wins} == {"qg000001", "qg000004", "qg000005", "qg000006"}
    losses = games_service.search_games(session, GameFilters(outcome="loss"))
    assert [game.source_id for game in losses] == ["qg000002"]
    draws = games_service.search_games(session, GameFilters(outcome="draw"))
    assert [game.source_id for game in draws] == ["qg000003"]
    assert games_service.outcome_of(library["qg000005"]) == "win"
    assert library["qg000005"].result == Result.BLACK_WIN


def test_unknown_outcome_is_rejected(library: Library) -> None:
    with pytest.raises(ValueError, match="unknown outcome"):
        games_service.search_games(library.session, GameFilters(outcome="victory"))


def test_opponent_filter_looks_at_the_other_side_whichever_colour(library: Library) -> None:
    session = library.session
    # Owner was black here, so the opponent is the white player.
    assert [
        game.source_id
        for game in games_service.search_games(session, GameFilters(opponent="SICILIANfan"))
    ] == ["qg000005"]
    # And the owner's own name never matches the opponent filter.
    assert games_service.search_games(session, GameFilters(opponent=OWNER)) == []


def test_like_metacharacters_are_not_wildcards(library: Library) -> None:
    assert games_service.search_games(library.session, GameFilters(opponent="%")) == []
    assert games_service.search_games(library.session, GameFilters(text="ruy_an")) == []


def test_free_text_searches_the_metadata_a_game_is_looked_up_by(library: Library) -> None:
    session = library.session
    assert {
        game.source_id for game in games_service.search_games(session, GameFilters(text="berlin"))
    } == {"qg000001", "qg000002"}
    assert {
        game.source_id for game in games_service.search_games(session, GameFilters(text="giuoco"))
    } == {"qg000006"}


def test_has_blunders_counts_only_the_owners_own_moves(analysed: Library) -> None:
    session = analysed.session
    with_blunders = games_service.search_games(session, GameFilters(has_blunders=True))
    # qg000003's only blunder is on a black ply and the owner had white there.
    assert {game.source_id for game in with_blunders} == {"qg000001", "qg000006"}
    without = games_service.search_games(session, GameFilters(has_blunders=False))
    assert "qg000003" in {game.source_id for game in without}


def test_deep_analyzed_filter(analysed: Library, engine_row: Engine) -> None:
    session = analysed.session
    assert games_service.search_games(session, GameFilters(deep_analyzed=True)) == []
    analyse(
        session,
        analysed["qg000001"],
        [{"ply": 6, "classification": Classification.MISTAKE, "win_loss": 11.0}],
        engine=engine_row,
        tier=Tier.DEEP,
        ply_start=6,
        ply_end=8,
    )
    found = games_service.search_games(session, GameFilters(deep_analyzed=True))
    assert [game.source_id for game in found] == ["qg000001"]


def test_analyzed_filter_means_a_finished_pass(analysed: Library, engine_row: Engine) -> None:
    session = analysed.session
    done = games_service.search_games(session, GameFilters(analyzed=True))
    assert {game.source_id for game in done} == {"qg000001", "qg000003", "qg000006"}

    missing = games_service.search_games(session, GameFilters(analyzed=False))
    assert {game.source_id for game in missing} == {"qg000002", "qg000004", "qg000005"}

    analyse(
        session,
        analysed["qg000002"],
        [],
        engine=engine_row,
        status=RunStatus.QUEUED,
    )
    still_missing = games_service.search_games(session, GameFilters(analyzed=False))
    assert "qg000002" in {game.source_id for game in still_missing}


def test_a_queued_run_is_not_an_analysis(library: Library, engine_row: Engine) -> None:
    analyse(
        library.session,
        library["qg000001"],
        [{"ply": 6, "classification": Classification.BLUNDER, "win_loss": 30.0}],
        engine=engine_row,
        status=RunStatus.QUEUED,
    )
    assert games_service.search_games(library.session, GameFilters(has_blunders=True)) == []


def test_game_detail_carries_moves_clocks_and_evals(analysed: Library) -> None:
    detail = games_service.get_game_detail(analysed.session, analysed["qg000001"].id)
    assert detail is not None
    assert len(detail["moves"]) == 10
    first = detail["moves"][0]
    assert first["san"] == "e4"
    assert first["uci"] == "e2e4"
    assert first["clock"] == 295.0
    assert first["color"] == "white"
    assert first["by_owner"] is True
    blunder = detail["moves"][8]
    assert blunder["classification"] == "blunder"
    assert blunder["win_loss"] == 42.0
    assert blunder["best_move_uci"] == "d2d3"
    # Ply 5 was never analysed, so it carries the move and nothing else.
    assert "classification" not in detail["moves"][5]
    assert [run["tier"] for run in detail["runs"]] == ["quick"]


def test_a_deep_run_wins_only_over_the_plies_it_covers(
    analysed: Library, engine_row: Engine
) -> None:
    session = analysed.session
    game = analysed["qg000001"]
    deep = analyse(
        session,
        game,
        [
            {"ply": 6, "classification": Classification.MISTAKE, "win_loss": 11.0},
            {"ply": 8, "classification": Classification.MISTAKE, "win_loss": 19.0},
        ],
        engine=engine_row,
        tier=Tier.DEEP,
        ply_start=6,
        ply_end=8,
    )
    detail = games_service.get_game_detail(session, game.id)
    assert detail is not None
    assert detail["moves"][8]["classification"] == "mistake"
    assert detail["moves"][8]["run_id"] == deep.id
    # Outside the deep window the quick pass still answers.
    assert detail["moves"][4]["classification"] == "mistake"
    assert detail["moves"][4]["win_loss"] == 12.0
    assert detail["moves"][4]["run_id"] != deep.id


def test_a_maia_run_adds_a_policy_without_replacing_the_eval(analysed: Library) -> None:
    session = analysed.session
    maia = Engine(name="maia-1700", kind=EngineKind.MAIA, path="/nonexistent/maia")
    session.add(maia)
    session.commit()
    analyse(
        session,
        analysed["qg000001"],
        [{"ply": 8, "maia_policy": {"1700": [{"uci": "d2d3", "p": 0.41}]}}],
        engine=maia,
    )
    detail = games_service.get_game_detail(session, analysed["qg000001"].id)
    assert detail is not None
    move = detail["moves"][8]
    assert move["maia"] == {"1700": [{"uci": "d2d3", "p": 0.41}]}
    assert move["classification"] == "blunder"
    assert move["win_loss"] == 42.0


def test_game_detail_narrows_to_a_ply_range(analysed: Library) -> None:
    detail = games_service.get_game_detail(
        analysed.session, analysed["qg000001"].id, ply_range=(6, 8)
    )
    assert detail is not None
    assert [move["ply"] for move in detail["moves"]] == [6, 7, 8]
    assert detail["ply_range"] == [6, 8]


def test_game_detail_ships_the_book_of_the_positions_the_library_repeats(
    analysed: Library,
) -> None:
    """The book rides along with the game, keyed by the ply its position sits before.

    The fixture's first game is a Ruy Lopez the library plays twice, so the first six
    positions of it are book and everything after 3…a6 is the owner's alone.
    """
    session = analysed.session
    detail = games_service.get_game_detail(session, analysed["qg000001"].id)
    assert detail is not None
    book = detail["book"]

    assert sorted(book) == [0, 1, 2, 3, 4, 5]
    assert book[0]["games"] == 6
    assert book[0]["score"] == 0.75
    assert [(move["san"], move["games"]) for move in book[0]["moves"]] == [("e4", 5), ("d4", 1)]
    # A tie between two continuations goes to the move that sorts first, as in the explorer.
    assert [(move["san"], move["games"]) for move in book[4]["moves"]] == [("Bb5", 2), ("Bc4", 2)]
    # Nothing comes back empty: a key means there is something to draw under it.
    assert all(entry["moves"] for entry in book.values())

    # And it is the explorer's own answer for the same position, quantity for quantity —
    # the two screens read one fold. Only what a per-position *page* adds is missing.
    page = explorer.opening_explorer(session, fen=AFTER_E4_E5)["moves"]
    assert book[2]["moves"] == [
        {key: value for key, value in node.items() if key not in {"eco", "name", "note"}}
        for node in page
    ]
    assert book[2]["moves"][0]["avg_win_loss"] is not None


def test_the_shipped_book_stops_where_a_position_stops_repeating(library: Library) -> None:
    """Two of the owner's games is the cut, and it is the position's count that decides."""
    session = library.session
    game = library["qg000001"]
    book = games_service.game_book(session, game.id)

    assert max(book) == 5
    assert book[5]["games"] == 2
    assert 6 not in book

    # Not because the position after 3…a6 has nothing to say — it has a continuation and a
    # game standing in it. It is left out because only one game ever stood there.
    after_a6 = session.scalars(
        select(GamePosition.position_id).where(
            GamePosition.game_id == game.id, GamePosition.ply == 6
        )
    ).one()
    assert [move["san"] for move in explorer.position_books(
        session, [after_a6], min_games=1
    )[after_a6]["moves"]] == ["Ba4"]
    assert explorer.position_books(session, [after_a6]) == {}


def test_a_game_nothing_else_repeats_ships_no_book_for_three_queries(session: Session) -> None:
    """The common case, and it has to be free: one game, so every position is a singleton.

    Of 463k positions in a real library 452k are reached by exactly one game, so this is
    what most plies of most games look like. Three statements settle the whole game — the
    plies it stood on, the positions they name, and how many games reached those — and
    nothing folds.
    """
    session.add(Account(platform=Platform.LICHESS, username=OWNER, is_owner=True))
    session.commit()
    job = run_import(session, Source.PGN, text=TRANSPOSED_PGN, analyze=False)
    assert job.games_imported == 1, job.errors
    game = session.scalars(select(Game)).one()

    with counting_statements(session) as statements:
        book = games_service.game_book(session, game.id)

    assert book == {}
    assert len(statements) == 3
    detail = games_service.get_game_detail(session, game.id)
    assert detail is not None and detail["book"] == {}


def test_the_shipped_book_reads_the_same_built_or_cold(
    library: Library, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The stored book is a cache, so the strip must not be able to tell which path answered.

    Six games clear no real hotness threshold, so it is lowered to put the opening positions
    on the built side of the cut and leave the deeper ones cold — which makes both paths,
    and a game that runs through the two of them, part of the comparison.
    """
    session = library.session
    monkeypatch.setattr(explorer, "BOOK_MIN_OCCURRENCES", 2)
    cold = games_service.game_book(session, library["qg000001"].id)
    assert cold

    while explorer.rebuild_position_books(session):
        pass
    assert explorer.find_position(session, START_EPD).book_state == explorer.BOOK_BUILT

    assert games_service.game_book(session, library["qg000001"].id) == cold


def test_the_shipped_book_follows_a_ply_window(analysed: Library) -> None:
    """A windowed request carries the book of the positions that window can stand on —
    which is one more than the moves it lists, because the board can sit after the last."""
    detail = games_service.get_game_detail(
        analysed.session, analysed["qg000001"].id, ply_range=(2, 4)
    )
    assert detail is not None
    assert sorted(detail["book"]) == [2, 3, 4, 5]


def test_game_detail_gathers_notes_on_the_game_and_on_its_positions(library: Library) -> None:
    session = library.session
    game = library["qg000001"]
    notes.save_note(session, "stop playing Ba4 on autopilot", ["ruy"], game_id=game.id)
    notes.save_note(session, "the Berlin again", ["opening"], fen=START_EPD)

    detail = games_service.get_game_detail(session, game.id)
    assert detail is not None
    scopes = {note["scope"] for note in detail["notes"]}
    assert scopes == {"game", "position"}
    position_note = next(note for note in detail["notes"] if note["scope"] == "position")
    assert position_note["ply"] == 0


def test_get_game_detail_of_an_unknown_game_is_none(library: Library) -> None:
    assert games_service.get_game_detail(library.session, 9999) is None


def test_get_last_games_and_cards(analysed: Library) -> None:
    session = analysed.session
    last = games_service.get_last_games(session, amount=2)
    assert [game.source_id for game in last] == ["qg000006", "qg000005"]

    card = games_service.game_card(session, analysed["qg000001"], worst=2)
    assert card["analyzed"] is True
    assert card["deep"] is False
    assert card["opponent"] == "ruyfan"
    assert [moment["win_loss"] for moment in card["worst_moments"]] == [42.0, 30.0]
    assert card["eval_curve"] == [{"ply": 0, "win": 52.0}, {"ply": 8, "win": 12.0}]


def _no_fallback(*args: Any, **kwargs: Any) -> dict[str, Any]:
    raise AssertionError("the card was recomputed when the stored one should have answered")


def test_a_stored_card_answers_without_touching_the_evals(
    analysed: Library, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The whole point of the column: a page of cards must not read move_evals at all."""
    session = analysed.session
    game = analysed["qg000001"]
    games_service.refresh_card(session, game)
    session.commit()

    monkeypatch.setattr(games_service, "build_card", _no_fallback)
    card = games_service.game_cards(session, [game], worst=2)[0]

    assert card["analyzed"] is True
    assert card["deep"] is False
    assert card["opponent"] == "ruyfan"
    assert [moment["win_loss"] for moment in card["worst_moments"]] == [42.0, 30.0]
    assert card["eval_curve"] == [{"ply": 0, "win": 52.0}, {"ply": 8, "win": 12.0}]


def test_a_stored_card_and_a_computed_one_are_the_same_payload(analysed: Library) -> None:
    session = analysed.session
    game = analysed["qg000001"]
    computed = games_service.game_card(session, game, worst=3)

    games_service.refresh_card(session, game)
    session.commit()

    assert games_service.game_card(session, game, worst=3) == computed


def test_asking_for_more_moments_than_a_card_keeps_reads_the_evals(
    analysed: Library, monkeypatch: pytest.MonkeyPatch
) -> None:
    session = analysed.session
    game = analysed["qg000001"]
    games_service.refresh_card(session, game)
    session.commit()
    assert game.card is not None
    assert len(game.card["worst_moments"]) == games_service.CARD_WORST_MOMENTS

    asked: list[int] = []
    build_card = games_service.build_card

    def _counted(session: Session, game: Game, *, worst: int) -> dict[str, Any]:
        asked.append(worst)
        return build_card(session, game, worst=worst)

    monkeypatch.setattr(games_service, "build_card", _counted)
    card = games_service.game_card(session, game, worst=8)

    assert asked == [8]
    assert [moment["win_loss"] for moment in card["worst_moments"]] == [
        42.0,
        30.0,
        12.0,
        6.0,
        1.0,
    ]


def test_a_card_that_kept_every_moment_answers_any_amount(
    library: Library, engine_row: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Fewer moments than the cap means the game had no more, not that the card was cut."""
    session = library.session
    game = library["qg000001"]
    analyse(
        session,
        game,
        [
            {"ply": 0, "classification": Classification.MISTAKE, "win_loss": 12.0},
            {"ply": 2, "classification": Classification.BLUNDER, "win_loss": 40.0},
        ],
        engine=engine_row,
    )
    games_service.refresh_card(session, game)
    session.commit()

    monkeypatch.setattr(games_service, "build_card", _no_fallback)
    card = games_service.game_card(session, game, worst=8)

    assert [moment["win_loss"] for moment in card["worst_moments"]] == [40.0, 12.0]


def test_rebuilding_the_cards_covers_every_analysed_game(analysed: Library) -> None:
    session = analysed.session
    assert all(game.card is None for game in analysed.all)

    rebuilt = games_service.rebuild_game_cards(session, chunk=2)

    assert rebuilt == 3
    # Re-read rather than trusting the fixture's instances: the sweep lets go of them, and
    # what matters is what it committed.
    stored = {
        game.source_id: game.card
        for game in session.scalars(select(Game))
        if game.card is not None
    }
    assert set(stored) == {"qg000001", "qg000003", "qg000006"}
    assert stored["qg000001"]["eval_curve"] == [{"ply": 0, "win": 52.0}, {"ply": 8, "win": 12.0}]
    assert [moment["win_loss"] for moment in stored["qg000001"]["worst_moments"]] == [
        42.0,
        30.0,
        12.0,
        6.0,
        1.0,
    ]


def test_player_profile_series_are_per_platform_and_speed(library: Library) -> None:
    profile = games_service.get_player_profile(library.session)
    assert profile["volume"]["games"] == 6
    assert profile["volume"]["wins"] == 4
    assert profile["volume"]["score"] == 0.75
    assert profile["volume"]["by_speed"] == {"blitz": 3, "bullet": 1, "rapid": 2}
    assert profile["accounts"][0]["games"] == 6

    keyed = {(row["platform"], row["speed"]): row for row in profile["ratings"]}
    assert keyed[("lichess", "blitz")]["current"] == 1820
    assert keyed[("lichess", "rapid")]["min"] == 1800
    assert keyed[("lichess", "bullet")]["games"] == 1


def test_player_profile_splits_a_two_account_library_by_platform(library: Library) -> None:
    """Which platform a game counts under is the account that played it, not its source.

    The one-account fixture never tells the account lookup from the source fallback; two
    accounts on two sites do, and the profile reads those ids off the game rows.
    """
    session = library.session
    chesscom = Account(platform=Platform.CHESSCOM, username="blunderbase-cc", is_owner=True)
    session.add(chesscom)
    session.commit()
    # The two January blitz games move to the other site; the owner played white in both.
    for source_id in ("qg000001", "qg000002"):
        library[source_id].white_account_id = chesscom.id
    session.commit()

    profile = games_service.get_player_profile(session)

    assert profile["volume"]["games"] == 6
    assert profile["volume"]["by_platform"] == {"chesscom": 2, "lichess": 4}
    assert {row["username"]: row["games"] for row in profile["accounts"]} == {
        OWNER: 4,
        "blunderbase-cc": 2,
    }
    keyed = {(row["platform"], row["speed"]): row for row in profile["ratings"]}
    assert keyed[("chesscom", "blitz")]["games"] == 2
    assert keyed[("chesscom", "blitz")]["current"] == 1760
    # And the site the owner still plays on keeps only the blitz game that stayed.
    assert keyed[("lichess", "blitz")]["games"] == 1
    assert keyed[("lichess", "blitz")]["current"] == 1820


def test_player_profile_keeps_a_fully_recent_series_uncapped(library: Library) -> None:
    """The fixture's games all fall within a year of each other, so a tiny cap doesn't thin them."""
    profile = games_service.get_player_profile(library.session, max_points=2)
    blitz = next(row for row in profile["ratings"] if row["speed"] == "blitz")
    assert blitz["games"] == 3
    assert len(blitz["points"]) == 3
    assert blitz["points"][-1]["rating"] == 1820


def test_downsample_keeps_a_dense_recent_cluster_intact() -> None:
    """A year-old-plus prefix gets thinned; the last year, however dense, does not."""
    start = datetime(2021, 1, 1, tzinfo=UTC)
    old = [
        {"at": (start + timedelta(days=i)).isoformat(), "rating": 1500 + i, "game_id": i}
        for i in range(900)
    ]
    # A burst of activity in the series' final month, well within the last year.
    cluster_start_day = 1399
    cluster = [
        {
            "at": (start + timedelta(days=cluster_start_day + i * 30 / 99)).isoformat(),
            "rating": 2000 + i,
            "game_id": 900 + i,
        }
        for i in range(100)
    ]
    points = old + cluster

    result = games_service._downsample(points, 200)

    kept_ats = {point["at"] for point in result}
    assert {point["at"] for point in cluster} <= kept_ats  # whole recent cluster survives
    assert result[0]["at"] == points[0]["at"]  # first point of the series is kept
    assert result[-1]["at"] == points[-1]["at"]  # last point is kept
    assert [point["at"] for point in result] == sorted(point["at"] for point in result)
    assert len(kept_ats) == len(result)  # no duplicates

    old_ats = {point["at"] for point in old}
    kept_old = kept_ats & old_ats
    assert 0 < len(kept_old) < len(old)  # old prefix thinned, not dropped entirely
    assert len(result) <= 220  # stays roughly within budget, plus the recency-floor slack


# ------------------------------------------------------------------------ explorer


def test_tree_from_the_initial_position(library: Library) -> None:
    tree = explorer.opening_explorer(library.session)
    assert tree["fen"] == START_EPD
    assert tree["totals"]["games"] == 6
    assert tree["totals"]["score"] == 0.75
    keyed = {node["uci"]: node for node in tree["moves"]}
    assert keyed["e2e4"]["games"] == 5
    assert keyed["e2e4"]["san"] == "e4"
    assert keyed["d2d4"]["games"] == 1
    assert keyed["e2e4"]["owner_moves"] == 4
    assert keyed["e2e4"]["wins"] == 3


def test_tree_filtered_to_one_colour(library: Library) -> None:
    tree = explorer.opening_explorer(library.session, color=Color.WHITE)
    assert tree["totals"]["games"] == 5
    keyed = {node["uci"]: node for node in tree["moves"]}
    assert keyed["e2e4"]["games"] == 4
    assert keyed["e2e4"]["owner_moves"] == 4


def test_the_book_walk_stops_at_the_first_move_played_only_once(library: Library) -> None:
    tree = explorer.opening_explorer(library.session)
    assert [(node["san"], node["games"]) for node in tree["main_line"]] == [
        ("e4", 5),
        ("e5", 4),
        ("Nf3", 4),
        ("Nc6", 4),
        ("Bb5", 2),
        ("a6", 1),
    ]
    assert tree["book_depth"] == 5
    assert tree["leaves_book_with"]["san"] == "a6"
    assert tree["leaves_book_because"] == "novelty"


def test_an_eco_query_roots_at_the_deepest_shared_position(library: Library) -> None:
    tree = explorer.opening_explorer(library.session, eco="C6")
    assert [node["san"] for node in tree["path"]] == ["e4", "e5", "Nf3", "Nc6", "Bb5"]
    assert tree["side_to_move"] == "black"
    assert tree["totals"]["games"] == 2
    assert tree["totals"]["score"] == 0.5
    assert {node["san"] for node in tree["moves"]} == {"a6", "Nf6"}


def test_the_tree_averages_the_eval_given_away_per_continuation(analysed: Library) -> None:
    after_e4_e5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -"
    tree = explorer.opening_explorer(analysed.session, fen=after_e4_e5)
    knight = next(node for node in tree["moves"] if node["uci"] == "g1f3")
    # Four games play Nf3 here; only qg000001's run reaches this ply, so the average eval
    # drop is that one game's and the other three do not dilute it with a zero.
    assert knight["games"] == 4
    assert knight["evaluated"] == 1
    assert knight["avg_win_loss"] == 6.0
    assert knight["blunders"] == 0


def test_a_continuation_the_owner_never_played_reports_no_accuracy(analysed: Library) -> None:
    """The tree is the owner's, so a move only the opponent made says nothing about them.

    After 3.Bc4 it is Black's move and the owner is White in both games that get here, one
    of which — the decoy — has that very ply classified a blunder. Counting it would put an
    opponent's mistake in a column headed by the owner's name; reporting a clean zero
    instead would credit them with a move they never played. Both are wrong, so the answer
    is no owner moves, no blunders and no average at all.
    """
    session = analysed.session
    after_bc4 = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq -"
    decoy = analysed["qg000003"]
    assert decoy.owner_color == Color.WHITE
    blunder = session.scalars(
        select(MoveEval).join(AnalysisRun).where(AnalysisRun.game_id == decoy.id, MoveEval.ply == 5)
    ).one()
    assert blunder.classification == Classification.BLUNDER  # Black's move, and a bad one

    tree = explorer.opening_explorer(session, fen=after_bc4)
    assert tree["side_to_move"] == "black"
    bishop = next(node for node in tree["moves"] if node["uci"] == "f8c5")
    assert bishop["games"] == 2
    assert bishop["owner_moves"] == 0
    assert bishop["blunders"] == 0
    assert bishop["evaluated"] == 0
    assert bishop["avg_win_loss"] is None


def test_a_book_built_before_the_owner_only_rule_still_reads_as_the_owner(
    analysed: Library, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No migration, no rebuild: the read path is what makes an old row the owner's.

    A `position_moves` row is keyed by owner colour and `side_to_move` belongs to the
    position, so a row where the two differ folded the opponent's moves and nothing else —
    whatever it stored in the accuracy columns. Poking a pre-fix build's numbers back into
    such a row stands in for a library nobody has swept, and the tree must not repeat them.
    """
    session = analysed.session
    after_bc4 = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq -"
    monkeypatch.setattr(explorer, "BOOK_MIN_OCCURRENCES", 2)
    while explorer.rebuild_position_books(session):
        pass
    position = explorer.find_position(session, after_bc4)
    assert position.book_state == explorer.BOOK_BUILT

    session.execute(
        update(PositionMove)
        .where(PositionMove.position_id == position.id, PositionMove.move_uci == "f8c5")
        .values(evaluated=1, blunders=1, loss_sum=60.0)
    )
    session.commit()

    bishop = next(
        node
        for node in explorer.opening_explorer(session, fen=after_bc4)["moves"]
        if node["uci"] == "f8c5"
    )
    assert bishop["games"] == 2  # the frequency columns are untouched
    assert bishop["owner_moves"] == 0
    assert bishop["blunders"] == 0
    assert bishop["evaluated"] == 0
    assert bishop["avg_win_loss"] is None


def test_find_positions_lists_the_games_that_reached_one(library: Library) -> None:
    rows = explorer.find_positions(library.session, START_EPD)
    assert len(rows) == 6
    assert rows[0]["game"]["id"] == library["qg000006"].id
    assert rows[0]["ply"] == 0
    assert rows[0]["move_san"] == "e4"

    white_only = explorer.find_positions(library.session, START_EPD, color=Color.BLACK)
    assert [row["game"]["source_id"] for row in white_only] == ["qg000005"]


def test_the_stored_book_answers_exactly_as_the_live_fold_does(
    analysed: Library, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The book is a cache, so a built position and a cold one have to be indistinguishable.

    Every position starts dirty, so the first pass over these queries is the live fold; the
    second is the same queries after the sweep has built the hot ones and marked the rest
    cold. Six games clear no real hotness threshold, so the threshold is lowered to put the
    opening positions on the built side of the cut and leave the deep ones on the other —
    which is what makes both paths, and the walk that mixes them, part of the comparison.
    """
    session = analysed.session
    monkeypatch.setattr(explorer, "BOOK_MIN_OCCURRENCES", 2)

    queries: list[dict[str, Any]] = [
        {},
        {"color": Color.WHITE},
        {"color": Color.BLACK},
        {"fen": AFTER_E4_E5},
        {"fen": AFTER_E4_E5, "min_games": 2},
        {"fen": AFTER_E4_E5, "limit": 1},
        {"eco": "C6"},
    ]
    live = [explorer.opening_explorer(session, **query) for query in queries]

    while explorer.rebuild_position_books(session):
        pass
    assert explorer.find_position(session, START_EPD).book_state == explorer.BOOK_BUILT
    assert {state for state in session.scalars(select(Position.book_state))} == {
        explorer.BOOK_BUILT,
        explorer.BOOK_COLD,
    }

    assert [explorer.opening_explorer(session, **query) for query in queries] == live


def test_find_positions_caps_the_newest_games_in_the_database(library: Library) -> None:
    """The ordering and the cap are SQL's: the tail is never fetched to be thrown away."""
    rows = explorer.find_positions(library.session, START_EPD, limit=2)
    assert [row["game"]["source_id"] for row in rows] == ["qg000006", "qg000005"]


def test_only_the_positions_enough_games_reach_are_worth_a_book(library: Library) -> None:
    """The long tail is deliberately left out: a six-game library is entirely long tail."""
    session = library.session
    settled = 0
    while done := explorer.rebuild_position_books(session):
        settled += done

    assert settled == session.scalar(select(func.count()).select_from(Position))
    assert {state for state in session.scalars(select(Position.book_state))} == {
        explorer.BOOK_COLD
    }
    assert session.scalar(select(func.count()).select_from(PositionMove)) == 0
    assert session.scalar(select(func.count()).select_from(PositionTotal)) == 0


def test_an_import_sends_the_positions_it_touched_back_to_the_sweep(
    library: Library, monkeypatch: pytest.MonkeyPatch
) -> None:
    session = library.session
    monkeypatch.setattr(explorer, "BOOK_MIN_OCCURRENCES", 2)
    while explorer.rebuild_position_books(session):
        pass
    assert explorer.find_position(session, START_EPD).book_state == explorer.BOOK_BUILT

    run_import(session, Source.PGN, text=TRANSPOSED_PGN)

    assert explorer.find_position(session, START_EPD).book_state == explorer.BOOK_DIRTY
    # And the answer is right again straight away, because a dirty position folds live.
    assert explorer.opening_explorer(session)["totals"]["games"] == 7


def test_a_finished_run_sends_the_games_positions_back_to_the_sweep(
    library: Library, engine_row: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    session = library.session
    monkeypatch.setattr(explorer, "BOOK_MIN_OCCURRENCES", 2)
    while explorer.rebuild_position_books(session):
        pass

    run = AnalysisRun(
        game_id=library["qg000001"].id,
        engine_id=engine_row.id,
        tier=Tier.QUICK,
        status=RunStatus.RUNNING,
    )
    session.add(run)
    session.commit()
    analysis.complete_run(
        session,
        run,
        [MoveEval(ply=1, classification=Classification.BLUNDER, win_loss=50.0)],
    )

    assert explorer.find_position(session, START_EPD).book_state == explorer.BOOK_DIRTY


def test_emptying_the_library_throws_the_whole_book_away(
    library: Library, monkeypatch: pytest.MonkeyPatch
) -> None:
    session = library.session
    monkeypatch.setattr(explorer, "BOOK_MIN_OCCURRENCES", 2)
    while explorer.rebuild_position_books(session):
        pass
    assert session.scalar(select(func.count()).select_from(PositionMove)) > 0

    games_service.delete_all_games(session)

    assert session.scalar(select(func.count()).select_from(PositionMove)) == 0
    assert session.scalar(select(func.count()).select_from(PositionTotal)) == 0
    # The positions themselves survive a wipe, so they go back to the sweep rather than out.
    assert {state for state in session.scalars(select(Position.book_state))} == {
        explorer.BOOK_DIRTY
    }


def test_the_book_walk_counts_a_game_that_transposed_into_the_line(library: Library) -> None:
    """The walk is positional: standing in the position is what counts, not how you got there.

    The seventh game plays the same Ruy Lopez by a different move order, so it never
    appears in the first four plies of the line and joins it at the fifth. Bb5 goes from
    two games to three — and that is exactly where the difference between a *position's*
    statistics and a *line's* depth shows: from the initial array the transposing game
    never played those first four moves, so the Berlin it agrees on is not a line anyone
    played end to end and the depth stops at Bb5. Ask from the Berlin's own position, where
    the transposition is real, and it is book.
    """
    session = library.session
    before = explorer.opening_explorer(session)
    assert [(node["san"], node["games"]) for node in before["main_line"]][4:] == [
        ("Bb5", 2),
        ("a6", 1),
    ]

    run_import(session, Source.PGN, text=TRANSPOSED_PGN)

    after = explorer.opening_explorer(session)
    assert [(node["san"], node["games"]) for node in after["main_line"]] == [
        ("e4", 5),
        ("e5", 4),
        ("Nf3", 4),
        ("Nc6", 4),
        # Three games stand here, but only the two that came the direct way played the
        # whole line to get here, and they part company immediately afterwards.
        ("Bb5", 3),
        ("a6", 1),
    ]
    assert after["book_depth"] == 5
    assert after["leaves_book_because"] == "line not played"

    after_bb5 = "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq -"
    berlin = explorer.opening_explorer(session, fen=after_bb5)
    assert [(node["san"], node["games"]) for node in berlin["main_line"]] == [
        ("Nf6", 2),
        ("d3", 2),
        ("d6", 1),
    ]
    assert berlin["book_depth"] == 2
    assert berlin["leaves_book_because"] == "novelty"


def _games_that_played(session: Session, ucis: Sequence[str]) -> set[int]:
    """Games whose first plies are exactly these moves, worked out the naive way.

    Deliberately not the service's own join: a check that the reported depth is a line
    somebody played is worth nothing if it is computed by the code under test.
    """
    played: dict[int, dict[int, str | None]] = {}
    for game_id, ply, move_uci in session.execute(
        select(GamePosition.game_id, GamePosition.ply, GamePosition.move_uci)
    ):
        played.setdefault(game_id, {})[ply] = move_uci
    return {
        game_id
        for game_id, moves in played.items()
        if all(moves.get(ply) == uci for ply, uci in enumerate(ucis))
    }


def test_the_book_depth_stops_where_the_line_stops_being_one_anyone_played(
    library: Library,
) -> None:
    """A depth is a claim about a line, so it has to be a line games actually played.

    The greedy walk chooses each move from the games standing in that one position, which
    lets it stitch a run out of games that never met — every step reporting a real two, no
    game having played the whole thing. What comes back is capped to the deepest prefix
    `BOOK_MIN_GAMES` games played end to end.
    """
    session = library.session
    run_import(session, Source.PGN, text=TRANSPOSED_PGN)

    tree = explorer.opening_explorer(session)
    depth = tree["book_depth"]
    ucis = [node["uci"] for node in tree["main_line"]]
    # Every step of the walk is still chosen positionally — three games stand after Bb5.
    assert [node["games"] for node in tree["main_line"][:depth]] == [5, 4, 4, 4, 3]
    assert len(_games_that_played(session, ucis[:depth])) >= explorer.BOOK_MIN_GAMES
    # And one move further is where it stops being a line: the departing move belongs to a
    # single game, which is what ends the book rather than what extends it.
    assert len(_games_that_played(session, ucis[: depth + 1])) < explorer.BOOK_MIN_GAMES


def test_a_position_no_game_reached_is_an_empty_tree(library: Library) -> None:
    fen = "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1"
    tree = explorer.opening_explorer(library.session, fen=fen)
    assert tree["moves"] == []
    assert tree["totals"]["games"] == 0
    assert tree["leaves_book_because"] == "no games"
    assert explorer.find_positions(library.session, fen) == []


def test_the_tree_names_the_queried_position_out_of_the_book(library: Library) -> None:
    after_e4_e5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -"
    tree = explorer.opening_explorer(library.session, fen=after_e4_e5)
    # No line, so only the position itself is looked up and nothing knows how deep it is.
    assert tree["opening"] == {"eco": "C20", "name": "King's Pawn Game", "ply": None}


def test_a_line_past_the_book_takes_its_name_from_an_ancestor(library: Library) -> None:
    # 1.d4 Nf6 2.c4 e6 3.Nf3 d5 4.Nc3 Bb4 — the Ragozin, which the book does name.
    ragozin = ["d2d4", "g8f6", "c2c4", "e7e6", "g1f3", "d7d5", "b1c3", "f8b4"]
    tree = explorer.opening_explorer(library.session, line=ragozin)
    assert tree["opening"] == {
        "eco": "D38",
        "name": "Queen's Gambit Declined: Ragozin Defense",
        "ply": 8,
    }

    # …and eight plies further, where the book has nothing at all to say. The name is the
    # ancestor's and `ply` says which ancestor, which is the whole reason `line` exists.
    deeper = [*ragozin, "c1g5", "h7h6", "g5h4", "c7c5", "e2e3", "b8c6", "a2a3", "b4c3"]
    assert explorer.opening_explorer(library.session, line=deeper)["opening"] == tree["opening"]


def test_the_line_names_the_opening_and_never_chooses_the_position(library: Library) -> None:
    after_e4 = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"
    tree = explorer.opening_explorer(
        library.session, fen=after_e4, line=["d2d4", "g8f6", "c2c4", "e7e6"]
    )
    # The tree is still the initial array's; only the name came from the line.
    assert tree["fen"] == after_e4
    assert tree["totals"]["games"] == 6
    assert tree["opening"]["name"] == "Indian Defense: Normal Variation"


def test_an_unplayable_move_truncates_the_naming_walk(library: Library) -> None:
    tree = explorer.opening_explorer(library.session, line=["e2e4", "e7e5", "e2e4"])
    assert tree["opening"] == {"eco": "C20", "name": "King's Pawn Game", "ply": 2}
    garbled = explorer.opening_explorer(library.session, line=["not-a-move"])
    assert garbled["opening"] is None


def test_a_position_the_book_does_not_name_reports_no_opening(library: Library) -> None:
    assert explorer.opening_explorer(library.session)["opening"] is None


def test_a_continuation_names_the_opening_it_leads_into(library: Library) -> None:
    """Both first moves are named a ply in, so both continuations carry a name."""
    tree = explorer.opening_explorer(library.session)
    keyed = {node["uci"]: node for node in tree["moves"]}
    assert keyed["e2e4"]["eco"] == "B00"
    assert keyed["e2e4"]["name"] == "King's Pawn Game"
    assert keyed["d2d4"]["eco"] == "A40"
    assert keyed["d2d4"]["name"] == "Queen's Pawn Game"


def test_an_unnamed_child_does_not_inherit_the_parents_name(library: Library) -> None:
    """1.e4 e5 2.Nf3 Nc6 3.Bb5 a6, the Morphy Defense, is named — but nobody in the
    library plays anything from here except 4.Ba4, and that position is not in the book.
    The continuation has to report no name rather than repeating its parent's.
    """
    morphy = "r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq -"
    tree = explorer.opening_explorer(library.session, fen=morphy)
    assert tree["opening"] == {"eco": "C70", "name": "Ruy Lopez: Morphy Defense", "ply": None}
    keyed = {node["uci"]: node for node in tree["moves"]}
    assert keyed["b5a4"]["eco"] is None
    assert keyed["b5a4"]["name"] is None


def test_an_illegal_continuation_gets_no_name_rather_than_raising(library: Library) -> None:
    """A move node's `uci` always comes from a game that actually played it, so this is
    only ever reached defensively — but a caller-supplied `fen` can still make the root
    itself unparseable, and that must not turn into a 500."""
    session = library.session
    moves: list[dict] = [{"uci": "e2e4"}]
    explorer._annotate_continuations(session, moves, "not a position")
    assert moves == [{"uci": "e2e4", "eco": None, "name": None, "note": None}]

    moves = [{"uci": "e2e5"}]  # e2 to e5 in one move: not legal from the start
    explorer._annotate_continuations(session, moves, explorer.START_EPD)
    assert moves == [{"uci": "e2e5", "eco": None, "name": None, "note": None}]


def test_a_continuation_carries_the_owners_note_on_where_it_leads(library: Library) -> None:
    """A note about a move is a note about the position it reaches, and the newest wins.

    The note is written with a full FEN, counters and an illegal en-passant square and all,
    the way anything pasted into the app arrives; it has to land on the same position the
    tree walked its way to, or the table and the notes card would be talking past each
    other.
    """
    session = library.session
    after_e4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
    notes.save_note(session, "played this for years")
    older = notes.save_note(session, "the open games, when I want a fight", fen=after_e4)
    newer = notes.save_note(session, "stop playing the Italian on autopilot", fen=after_e4)

    keyed = {node["uci"]: node for node in explorer.opening_explorer(session)["moves"]}
    assert keyed["e2e4"]["note"] == {
        "id": newer.id,
        "text": "stop playing the Italian on autopilot",
    }
    assert older.id != newer.id


def test_a_continuation_with_nothing_written_about_it_reports_no_note(library: Library) -> None:
    """Null rather than a missing key — and never the queried position's own note, which
    belongs to the card under the table rather than to every row in it."""
    session = library.session
    notes.save_note(session, "the first move is the whole plan", fen=START_EPD)

    keyed = {node["uci"]: node for node in explorer.opening_explorer(session)["moves"]}
    assert keyed["e2e4"]["note"] is None
    assert keyed["d2d4"]["note"] is None


def test_an_empty_tree_still_carries_the_book_name(library: Library) -> None:
    # 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O Be7 6.Re1 b5 — nobody in the library has
    # gone this far, so there is no tree to show, and the position is still called something.
    line = ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4", "g8f6", "e1g1", "f8e7",
            "f1e1", "b7b5"]
    tree = explorer.opening_explorer(
        library.session,
        fen="r1bqk2r/2ppbppp/p1n2n2/1p2p3/B3P3/5N2/PPPP1PPP/RNBQR1K1 w kq -",
        line=line,
    )
    assert tree["totals"]["games"] == 0
    assert tree["opening"] == {"eco": "C84", "name": "Ruy Lopez: Closed", "ply": 10}


def test_get_or_create_position_normalises_and_is_idempotent(session: Session) -> None:
    first = explorer.get_or_create_position(
        session, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    )
    session.commit()
    second = explorer.get_or_create_position(session, START_EPD)
    assert first.id == second.id
    assert first.fen == START_EPD
    assert first.side_to_move == Color.WHITE
    assert len(first.zobrist_key) == 16
    assert session.scalar(select(Position).where(Position.fen == START_EPD)) is not None


def test_a_fen_that_is_not_a_position_is_rejected(session: Session) -> None:
    with pytest.raises(ValueError, match="not a position"):
        explorer.normalize_fen("not a fen at all")


# --------------------------------------------------------------------------- stats


def test_blunders_by_phase(analysed: Library) -> None:
    payload = stats.get_stats(analysed.session, "blunders_by_phase")
    keyed = {bucket["key"]: bucket for bucket in payload["buckets"]}
    assert set(keyed) == {"opening", "middlegame"}
    assert keyed["opening"]["moves"] == 6
    assert keyed["opening"]["blunder"] == 2
    assert keyed["opening"]["mistake"] == 1
    assert keyed["opening"]["inaccuracy"] == 1
    assert keyed["middlegame"]["moves"] == 4
    assert keyed["middlegame"]["blunder"] == 2
    assert payload["total"]["moves"] == 10
    assert payload["total"]["blunder"] == 4
    assert payload["total"]["blunder_rate"] == 0.4


def test_the_endgame_bucket_reads_the_position_the_eval_points_at(
    library: Library, engine_row: Engine
) -> None:
    session = library.session
    endgame = explorer.get_or_create_position(session, ENDGAME_FEN)
    session.commit()
    analyse(
        session,
        library["qg000004"],
        [
            {"ply": 0, "classification": Classification.GOOD, "win_loss": 1.0},
            {
                "ply": 2,
                "classification": Classification.BLUNDER,
                "win_loss": 44.0,
                "position_id": endgame.id,
            },
        ],
        engine=engine_row,
    )
    payload = stats.get_stats(session, "blunders_by_phase")
    keyed = {bucket["key"]: bucket for bucket in payload["buckets"]}
    assert keyed["endgame"]["moves"] == 1
    assert keyed["endgame"]["blunder"] == 1
    assert keyed["opening"]["moves"] == 1


def test_phase_heuristic_directly() -> None:
    assert stats.phase_of(START_EPD, 0) == "opening"
    assert stats.phase_of(START_EPD, 40) == "middlegame"
    # Material decides regardless of how early it is.
    assert stats.phase_of(ENDGAME_FEN, 4) == "endgame"
    assert stats.phase_of(None, 4) == "opening"


def test_blunders_by_piece(analysed: Library) -> None:
    payload = stats.get_stats(analysed.session, "blunders_by_piece")
    keyed = {bucket["key"]: bucket for bucket in payload["buckets"]}
    assert keyed["pawn"]["moves"] == 1
    assert keyed["knight"]["moves"] == 3
    assert keyed["bishop"]["moves"] == 3
    assert keyed["bishop"]["blunder"] == 1
    # Castling is the king moving, whatever the SAN looks like.
    assert keyed["king"]["moves"] == 1
    assert keyed["king"]["blunder"] == 1
    assert keyed["rook"]["blunder"] == 1
    assert keyed["queen"]["blunder"] == 1


def test_piece_heuristic_directly() -> None:
    assert stats.piece_of("O-O", "e1g1", None) == "king"
    assert stats.piece_of("Nxe5", None, None) == "knight"
    assert stats.piece_of("exd5", None, None) == "pawn"
    assert stats.piece_of(None, "e2e4", START_EPD) == "pawn"
    assert stats.piece_of(None, "d1h5", START_EPD) == "queen"
    assert stats.piece_of(None, "e4e5", START_EPD) == "unknown"


def test_performance_by_speed(analysed: Library) -> None:
    payload = stats.get_stats(analysed.session, "performance_by_speed")
    keyed = {bucket["key"]: bucket for bucket in payload["buckets"]}
    assert keyed["blitz"]["games"] == 3
    assert keyed["blitz"]["wins"] == 2
    assert keyed["blitz"]["losses"] == 1
    assert keyed["blitz"]["score"] == 0.6667
    assert keyed["blitz"]["avg_opponent_rating"] == 1756.6667
    assert keyed["blitz"]["analyzed_games"] == 1
    assert keyed["blitz"]["blunders_per_game"] == 2.0
    assert keyed["rapid"]["score"] == 0.75
    assert keyed["bullet"]["score"] == 1.0
    assert payload["total"]["games"] == 6


def test_performance_by_hour_buckets_in_the_callers_timezone(library: Library) -> None:
    utc = stats.get_stats(library.session, "performance_by_hour")
    keyed = {bucket["key"]: bucket["games"] for bucket in utc["buckets"]}
    assert keyed == {"09": 1, "10": 1, "18": 2, "21": 1, "23": 1}
    assert [bucket["key"] for bucket in utc["buckets"]] == sorted(keyed)

    shifted = stats.get_stats(library.session, "performance_by_hour", tz_offset=2)
    moved = {bucket["key"]: bucket["games"] for bucket in shifted["buckets"]}
    assert moved == {"01": 1, "11": 1, "12": 1, "20": 2, "23": 1}
    assert shifted["tz_offset"] == 2.0


def test_time_trouble_loss(analysed: Library) -> None:
    payload = stats.get_stats(analysed.session, "time_trouble_loss")
    keyed = {bucket["key"]: bucket for bucket in payload["buckets"]}
    assert keyed["<10s"]["moves"] == 1
    assert keyed["<10s"]["blunder"] == 1
    assert keyed["<10s"]["avg_win_loss"] == 42.0
    assert keyed[">=60s"]["moves"] == 4
    assert keyed[">=60s"]["blunder"] == 1
    # The long game carries no clock times at all, so its moves are honestly unknown.
    assert keyed["unknown"]["moves"] == 5
    assert payload["thresholds"] == [10.0, 30.0, 60.0]


def test_time_trouble_thresholds_are_the_callers(analysed: Library) -> None:
    payload = stats.get_stats(analysed.session, "time_trouble_loss", thresholds=[150])
    keyed = {bucket["key"]: bucket for bucket in payload["buckets"]}
    assert keyed["<150s"]["moves"] == 2
    assert keyed[">=150s"]["moves"] == 3


def test_rating_trend(analysed: Library) -> None:
    payload = stats.get_stats(analysed.session, "rating_trend")
    keyed = {bucket["key"]: bucket for bucket in payload["buckets"]}
    assert [bucket["key"] for bucket in payload["buckets"]] == ["2026-01", "2026-02", "2026-03"]
    assert keyed["2026-01"]["games"] == 2
    assert keyed["2026-01"]["avg_rating"] == 1755.0
    assert keyed["2026-01"]["end_rating"] == 1760
    assert keyed["2026-01"]["owner_moves"] == 5
    assert keyed["2026-01"]["blunders"] == 2
    assert keyed["2026-01"]["blunders_per_100_moves"] == 40.0
    assert keyed["2026-02"]["avg_rating"] == 1700.0
    assert keyed["2026-03"]["blunders_per_100_moves"] == 40.0
    # Summing a rating across periods would be meaningless, so the total does not.
    assert "end_rating" not in payload["total"]


def test_rating_trend_takes_its_bucket_from_the_caller(analysed: Library) -> None:
    payload = stats.get_stats(analysed.session, "rating_trend", bucket="year")
    assert [bucket["key"] for bucket in payload["buckets"]] == ["2026"]
    with pytest.raises(ValueError, match="unknown bucket"):
        stats.get_stats(analysed.session, "rating_trend", bucket="fortnight")


def test_a_window_narrows_every_dimension(analysed: Library) -> None:
    payload = stats.get_stats(
        analysed.session,
        "performance_by_speed",
        since=datetime(2026, 3, 1, tzinfo=UTC),
    )
    assert payload["total"]["games"] == 2
    assert payload["since"] == "2026-03-01T00:00:00+00:00"


def test_the_dashboard_matches_six_dimensions_but_reads_games_once(
    analysed: Library, monkeypatch: pytest.MonkeyPatch
) -> None:
    session = analysed.session
    fold_every_summary(session)
    stats.reset_stats_cache()
    assert stats._summaries_ready(session) is True

    game_reads = counting(monkeypatch, stats, "_game_rows")
    eval_reads = counting(monkeypatch, stats, "_eval_rows")
    dashboard = stats.get_dashboard(session, days=90)

    assert game_reads == [1]
    assert eval_reads == [0]
    scope = GameFilters(
        since=datetime.fromisoformat(dashboard["since"]),
        until=datetime.fromisoformat(dashboard["until"]),
    )
    expected = {
        dimension: stats.get_stats(session, dimension, filters=scope)
        for dimension in stats.DIMENSIONS
    }
    assert dashboard["dimensions"] == expected


def test_filters_narrow_a_dimension(analysed: Library) -> None:
    payload = stats.get_stats(
        analysed.session, "blunders_by_phase", filters=GameFilters(speed=Speed.RAPID)
    )
    assert payload["total"]["moves"] == 5
    assert payload["total"]["blunder"] == 2


def test_compare_periods_reports_the_movement(analysed: Library) -> None:
    payload = stats.compare_periods(
        analysed.session,
        "performance_by_speed",
        (datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 2, 1, tzinfo=UTC)),
        (datetime(2026, 3, 1, tzinfo=UTC), datetime(2026, 4, 1, tzinfo=UTC)),
    )
    assert payload["then"]["total"]["games"] == 2
    assert payload["now"]["total"]["games"] == 2
    blitz = next(bucket for bucket in payload["delta"]["buckets"] if bucket["key"] == "blitz")
    # Two blitz games in January (one win, one loss), one in March (a win).
    assert blitz["games"] == -1
    assert blitz["score"] == 0.5
    rapid = next(bucket for bucket in payload["delta"]["buckets"] if bucket["key"] == "rapid")
    assert rapid["games"] == 1


def test_unknown_and_planned_dimensions_say_so(library: Library) -> None:
    with pytest.raises(stats.UnknownDimensionError, match="unknown stats dimension"):
        stats.get_stats(library.session, "blunders_by_vibe")
    with pytest.raises(stats.UnknownDimensionError, match="not implemented yet"):
        stats.get_stats(library.session, "blunders_by_motif")


def test_worst_recent_moments_rank_by_win_percentage_given_away(analysed: Library) -> None:
    moments = stats.get_worst_recent_moments(analysed.session, amount=3)
    assert [moment["win_loss"] for moment in moments] == [55.0, 42.0, 35.0]
    worst = moments[0]
    assert worst["san"] == "Qb3"
    assert worst["piece"] == "queen"
    assert worst["phase"] == "middlegame"
    assert worst["game"]["source_id"] == "qg000006"
    assert worst["fen"].endswith(" w - -")
    # The better move arrives as UCI and is rendered in the notation a human reads.
    assert worst["best_move_uci"] == "g1h2"
    assert worst["best_move_san"] == "Kh2"
    # The opponent's 50-point blunders are not the owner's training material.
    assert all(moment["game"]["source_id"] != "qg000003" for moment in moments)


def test_worst_recent_moments_over_a_day_window(analysed: Library) -> None:
    assert stats.get_worst_recent_moments(analysed.session, days=100000, amount=1)
    narrowed = stats.get_worst_recent_moments(
        analysed.session,
        amount=5,
        filters=GameFilters(since=datetime(2026, 3, 1, tzinfo=UTC)),
    )
    assert {moment["game"]["source_id"] for moment in narrowed} == {"qg000006"}


def test_stats_read_the_newest_full_run(library: Library, engine_row: Engine) -> None:
    session = library.session
    game = library["qg000001"]
    analyse(
        session,
        game,
        [{"ply": 0, "classification": Classification.BLUNDER, "win_loss": 90.0}],
        engine=engine_row,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    analyse(
        session,
        game,
        [{"ply": 0, "classification": Classification.GOOD, "win_loss": 1.0}],
        engine=engine_row,
        created_at=datetime(2026, 6, 1, tzinfo=UTC),
    )
    payload = stats.get_stats(session, "blunders_by_phase")
    assert payload["total"]["moves"] == 1
    assert payload["total"]["blunder"] == 0


def test_stats_ignore_partial_and_maia_runs(library: Library, engine_row: Engine) -> None:
    session = library.session
    game = library["qg000001"]
    maia = Engine(name="maia-1900", kind=EngineKind.MAIA, path="/nonexistent/maia")
    session.add(maia)
    session.commit()
    analyse(
        session,
        game,
        [{"ply": 0, "classification": Classification.BLUNDER, "win_loss": 80.0}],
        engine=engine_row,
        tier=Tier.DEEP,
        ply_start=0,
        ply_end=2,
    )
    analyse(
        session,
        game,
        [{"ply": 2, "classification": Classification.BLUNDER, "win_loss": 70.0}],
        engine=maia,
    )
    payload = stats.get_stats(session, "blunders_by_phase")
    assert payload["total"]["moves"] == 0


def test_get_player_profile_is_reachable_from_stats(library: Library) -> None:
    assert stats.get_player_profile(library.session)["volume"]["games"] == 6


# --------------------------------------------------------------------- stats cache


def counting(monkeypatch: pytest.MonkeyPatch, module: Any, name: str) -> list[int]:
    """Count the calls into the library a dimension makes, without changing its answer."""
    original = getattr(module, name)
    calls = [0]

    def counted(*args: Any, **kwargs: Any) -> Any:
        calls[0] += 1
        return original(*args, **kwargs)

    monkeypatch.setattr(module, name, counted)
    return calls


def test_a_repeated_dimension_is_not_recomputed(
    analysed: Library, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The refetch storm: the same question twice in a row is one scan of the library."""
    calls = counting(monkeypatch, stats, "_eval_rows")
    first = stats.get_stats(analysed.session, "blunders_by_phase")
    second = stats.get_stats(analysed.session, "blunders_by_phase")
    assert calls == [1]
    assert second is first
    assert first["total"]["blunder"] == 4


def test_a_cached_payload_is_recomputed_once_it_expires(
    analysed: Library, monkeypatch: pytest.MonkeyPatch
) -> None:
    moment = [1000.0]
    monkeypatch.setattr(stats, "_clock", lambda: moment[0])
    calls = counting(monkeypatch, stats, "_eval_rows")

    stats.get_stats(analysed.session, "blunders_by_phase")
    moment[0] += stats.STATS_CACHE_TTL_SECONDS / 2
    stats.get_stats(analysed.session, "blunders_by_phase")
    assert calls == [1]

    moment[0] += stats.STATS_CACHE_TTL_SECONDS
    stats.get_stats(analysed.session, "blunders_by_phase")
    assert calls == [2]


def test_resetting_the_cache_asks_the_library_again(
    analysed: Library, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = counting(monkeypatch, stats, "_eval_rows")
    stats.get_stats(analysed.session, "blunders_by_phase")
    stats.reset_stats_cache()
    stats.get_stats(analysed.session, "blunders_by_phase")
    assert calls == [2]


def test_different_filters_are_different_entries(
    analysed: Library, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = counting(monkeypatch, stats, "_eval_rows")
    everything = stats.get_stats(analysed.session, "blunders_by_phase")
    rapid = stats.get_stats(
        analysed.session, "blunders_by_phase", filters=GameFilters(speed=Speed.RAPID)
    )
    assert calls == [2]
    assert rapid["total"]["moves"] < everything["total"]["moves"]
    # And each is still served from its own entry afterwards.
    assert stats.get_stats(analysed.session, "blunders_by_phase") is everything
    assert calls == [2]


def test_the_options_are_part_of_the_key(
    analysed: Library, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two calls that differ only in an option are two answers, not one served twice."""
    games = counting(monkeypatch, stats, "_game_rows")
    assert stats.get_stats(analysed.session, "performance_by_hour")["tz_offset"] == 0.0
    assert stats.get_stats(analysed.session, "performance_by_hour", tz_offset=2)["tz_offset"] == 2.0
    assert games == [2]

    # An option that is a list is still a key: `thresholds` cannot go into one as it is.
    evals = counting(monkeypatch, stats, "_eval_rows")
    narrow = stats.get_stats(analysed.session, "time_trouble_loss", thresholds=[150])
    assert stats.get_stats(analysed.session, "time_trouble_loss", thresholds=[150]) is narrow
    assert stats.get_stats(analysed.session, "time_trouble_loss")["thresholds"] != [150.0]
    assert evals == [2]


def test_the_cache_is_capped_and_drops_the_oldest(
    analysed: Library, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Unbounded filter sets cannot grow it: one more entry pushes the first one out."""
    calls = counting(monkeypatch, stats, "_eval_rows")
    cap = stats.STATS_CACHE_MAX_ENTRIES
    oldest = GameFilters(opponent="opponent-0")
    for index in range(cap + 1):
        stats.get_stats(
            analysed.session,
            "blunders_by_phase",
            filters=GameFilters(opponent=f"opponent-{index}"),
        )
    assert calls == [cap + 1]

    # The newest is still there.
    stats.get_stats(
        analysed.session, "blunders_by_phase", filters=GameFilters(opponent=f"opponent-{cap}")
    )
    assert calls == [cap + 1]
    # The first one asked for is not: it was dropped to make room.
    stats.get_stats(analysed.session, "blunders_by_phase", filters=oldest)
    assert calls == [cap + 2]


def test_the_moments_are_cached_and_keyed_by_what_was_asked_for(
    analysed: Library, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = counting(monkeypatch, stats, "_eval_rows")
    moments = stats.get_worst_recent_moments(analysed.session, amount=3)
    assert stats.get_worst_recent_moments(analysed.session, amount=3) is moments
    assert calls == [1]
    assert len(stats.get_worst_recent_moments(analysed.session, amount=1)) == 1
    assert calls == [2]


def test_the_profile_is_cached(analysed: Library, monkeypatch: pytest.MonkeyPatch) -> None:
    calls = counting(monkeypatch, games_service, "get_player_profile")
    profile = stats.get_player_profile(analysed.session)
    assert stats.get_player_profile(analysed.session) is profile
    assert calls == [1]
    assert profile["volume"]["games"] == 6


def test_a_dimension_that_raises_is_never_cached(
    analysed: Library, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An error is not an answer: it is raised again, and it stands in for nothing."""
    calls = counting(monkeypatch, stats, "_game_rows")
    for _ in range(2):
        with pytest.raises(ValueError, match="unknown bucket"):
            stats.get_stats(analysed.session, "rating_trend", bucket="fortnight")
    assert stats.get_stats(analysed.session, "rating_trend", bucket="year")["buckets"]
    assert calls == [1]


# ------------------------------------------------------- stats cache, under concurrency
#
# These three drive `_cached` directly rather than a dimension. The rule being proved is
# what happens to callers that arrive *during* a scan, which needs a compute that blocks
# until the test says so — and a real dimension would be blocking with the library's one
# Session half-read on another thread, which proves nothing about the cache and plenty
# about SQLAlchemy. The dimensions' route into `_cached` is covered above.

# The compute a caller must never reach, because it is being served from the cache.
def never() -> Any:
    raise AssertionError("the library was scanned again")


def test_a_stale_payload_is_served_while_one_caller_recomputes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Expiry means "start a refresh", not "everyone scan": the meltdown, in one test."""
    moment = [1000.0]
    monkeypatch.setattr(stats, "_clock", lambda: moment[0])
    key = stats._cache_key("stale")
    assert stats._cached(key, lambda: "first") == "first"
    moment[0] += stats.STATS_CACHE_TTL_SECONDS + 1

    started, released = threading.Event(), threading.Event()

    def slow() -> Any:
        started.set()
        assert released.wait(10)
        return "second"

    refreshed: list[Any] = []
    thread = threading.Thread(target=lambda: refreshed.append(stats._cached(key, slow)))
    thread.start()
    assert started.wait(10)

    # Arriving mid-scan: the payload being replaced, at once, off no connection at all.
    assert stats._cached(key, never) == "first"

    released.set()
    thread.join(10)
    assert refreshed == ["second"]
    # And the refresh is what everyone gets from here.
    assert stats._cached(key, never) == "second"


def test_concurrent_misses_on_one_key_are_one_scan() -> None:
    """A key nobody has computed has nothing to serve stale, so the waiters queue — but on
    the one computation, not on a scan each."""
    key = stats._cache_key("miss")
    calls = [0]
    # All five are through before any of them is, so the four that are not the computer are
    # provably inside `_cached` while the computer sits in `slow`.
    at_the_door = threading.Barrier(5)
    inside, released = threading.Event(), threading.Event()

    def slow() -> Any:
        calls[0] += 1
        inside.set()
        assert released.wait(10)
        return "only"

    answers: list[Any] = []
    guard = threading.Lock()

    def call() -> None:
        at_the_door.wait(10)
        answer = stats._cached(key, slow)
        with guard:
            answers.append(answer)

    threads = [threading.Thread(target=call) for _ in range(5)]
    for thread in threads:
        thread.start()
    assert inside.wait(10)
    released.set()
    for thread in threads:
        thread.join(10)

    assert calls == [1]
    assert answers == ["only"] * 5


def test_a_refresh_that_raises_leaves_the_stale_payload_standing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The one caller that ran the scan wears the error; nobody else sees it."""
    moment = [1000.0]
    monkeypatch.setattr(stats, "_clock", lambda: moment[0])
    key = stats._cache_key("failing-refresh")
    assert stats._cached(key, lambda: "first") == "first"
    moment[0] += stats.STATS_CACHE_TTL_SECONDS + 1

    started, released = threading.Event(), threading.Event()

    def boom() -> Any:
        started.set()
        assert released.wait(10)
        raise RuntimeError("the scan failed")

    raised: list[RuntimeError] = []

    def refresh() -> None:
        try:
            stats._cached(key, boom)
        except RuntimeError as error:
            raised.append(error)

    thread = threading.Thread(target=refresh)
    thread.start()
    assert started.wait(10)
    assert stats._cached(key, never) == "first"

    released.set()
    thread.join(10)
    assert [str(error) for error in raised] == ["the scan failed"]
    # The entry it could not replace is untouched, and the slot is free to try again.
    assert stats._CACHE[key][1] == "first"
    assert stats._cached(key, lambda: "second") == "second"


# ------------------------------------------------------ stats, off the stored folds
#
# Every dimension has two ways to the same answer: hydrate every analysed ply of every
# game, or add up what each game folded once when its run finished. The first test here is
# the one that matters — the two are asked the same questions and have to give the same
# payload, byte for byte, or a deployment's numbers would move on the day its backfill
# finished.


def fold_every_summary(session: Session) -> int:
    """Run the backfill to the end the way the server's own boot task does, and in chunks
    small enough that finishing takes several of them."""
    folded = 0
    while done := stats.rebuild_stat_summaries(session, limit=2):
        folded += done
    return folded


def every_aggregation(session: Session, **narrowing: Any) -> dict[str, Any]:
    """Every dimension and the worst-moments ranking, over the same narrowing."""
    payloads: dict[str, Any] = {
        dimension: stats.get_stats(session, dimension, **narrowing)
        for dimension in stats.DIMENSIONS
    }
    payloads["worst_moments"] = stats.get_worst_recent_moments(session, amount=5, **narrowing)
    return payloads


def test_the_folded_and_the_scanned_answers_are_the_same_payload(
    analysed: Library, monkeypatch: pytest.MonkeyPatch
) -> None:
    session = analysed.session
    assert stats._summaries_ready(session) is False
    narrowings = {
        "everything": {},
        "rapid": {"filters": GameFilters(speed=Speed.RAPID)},
        "since march": {"filters": GameFilters(since=datetime(2026, 3, 1, tzinfo=UTC))},
    }
    scanned = {name: every_aggregation(session, **kwargs) for name, kwargs in narrowings.items()}

    assert fold_every_summary(session) == 3
    # Which also clears the memo of the library having been unfolded when it was asked.
    stats.reset_stats_cache()
    assert stats._summaries_ready(session) is True

    # Counted rather than assumed: an answer that agreed by quietly taking the scan again
    # would prove nothing about the folds at all.
    scans = [
        counting(monkeypatch, stats, name)
        for name in ("_eval_rows", "_blunder_counts", "_owner_move_counts")
    ]
    folded = {name: every_aggregation(session, **kwargs) for name, kwargs in narrowings.items()}
    assert scans == [[0], [0], [0]]
    assert folded == scanned
    # And the questions were not all answered with nothing.
    assert scanned["everything"]["blunders_by_phase"]["total"]["blunder"] == 4
    assert scanned["rapid"]["blunders_by_phase"]["total"]["moves"] == 5


def test_a_game_folds_its_own_counts_onto_its_row(analysed: Library) -> None:
    session = analysed.session
    fold_every_summary(session)

    game = session.get(Game, analysed["qg000006"].id)
    assert game is not None
    assert game.stat_owner_moves == 5
    assert game.stat_blunders == 2
    assert game.stat_worst_win_loss == 55.0
    assert game.stat_summary is not None
    assert game.stat_summary["phases"]["middlegame"]["blunder"] == 2
    assert game.stat_summary["pieces"]["queen"]["moves"] == 1

    # A game nothing has analysed folds to nothing at all, and is left out of every
    # aggregation exactly as it is left out of the scan.
    untouched = session.get(Game, analysed["qg000002"].id)
    assert untouched is not None
    assert untouched.stat_summary is None
    assert untouched.stat_owner_moves is None
    assert untouched.stat_worst_win_loss is None


@contextmanager
def counting_statements(session: Session) -> Iterator[list[str]]:
    """Every SQL statement the session's engine runs while the block is open."""
    statements: list[str] = []
    engine = session.get_bind()

    @event.listens_for(engine, "before_cursor_execute")
    def _record(conn, cursor, statement, parameters, context, executemany) -> None:  # type: ignore[no-untyped-def]
        statements.append(statement)

    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", _record)


def test_a_listing_never_reads_a_fold_and_the_ranking_reads_them_in_one_query(
    analysed: Library,
) -> None:
    """`stat_summary` is kilobytes of JSON per game that only the stats service reads.

    So it is deferred, and a page of games — which parses each row it does load — never
    fetches it at all. The one reader that hydrates games to read it asks for it on its own
    query, which is the half that matters: deferring a column a loop touches would trade
    one wide query for one narrow query per row.
    """
    session = analysed.session
    fold_every_summary(session)
    stats.reset_stats_cache()
    assert stats._summaries_ready(session) is True
    session.expunge_all()

    with counting_statements(session) as listing:
        listed = games_service.search_games(session, GameFilters(), limit=50)
    assert len(listed) == 6
    assert [statement for statement in listing if "stat_summary" in statement] == []
    assert all("stat_summary" in inspect(game).unloaded for game in listed)

    session.expunge_all()
    with counting_statements(session) as ranking:
        moments = stats.get_worst_recent_moments(session, amount=3)
    assert [moment["win_loss"] for moment in moments] == [55.0, 42.0, 35.0]
    assert len([statement for statement in ranking if "stat_summary" in statement]) == 1


def test_a_question_the_folds_cannot_answer_still_scans(
    analysed: Library, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A summary carries the default clock bands and the owner's blunders. Anything else is
    a question about the evals, and is asked of them however folded the library is."""
    session = analysed.session
    fold_every_summary(session)
    stats.reset_stats_cache()
    assert stats._summaries_ready(session) is True
    calls = counting(monkeypatch, stats, "_eval_rows")

    stats.get_stats(session, "time_trouble_loss")
    stats.get_worst_recent_moments(session, amount=3)
    assert calls == [0]

    custom = stats.get_stats(session, "time_trouble_loss", thresholds=[150])
    mistakes = stats.get_worst_recent_moments(
        session, amount=3, classifications=(Classification.MISTAKE,)
    )
    assert calls == [2]
    assert {bucket["key"] for bucket in custom["buckets"]} == {"<150s", ">=150s", "unknown"}
    assert [moment["classification"] for moment in mistakes] == ["mistake", "mistake"]


def test_moments_that_gave_away_exactly_as_much_rank_the_same_way_either_side(
    library: Library, engine_row: Engine
) -> None:
    """Ties are the common case, not the exotic one: every blunder into a forced mate gives
    away the same 99.88. Which of them the ranking shows has to be the same answer however
    it was reached, and the same answer on the next refresh."""
    session = library.session
    for source_id in ("qg000001", "qg000004", "qg000006"):
        analyse(
            session,
            library[source_id],
            [
                {"ply": 0, "classification": Classification.BLUNDER, "win_loss": 99.88},
                {"ply": 2, "classification": Classification.BLUNDER, "win_loss": 99.88},
            ],
            engine=engine_row,
        )
    scanned = stats.get_worst_recent_moments(session, amount=4)

    fold_every_summary(session)
    stats.reset_stats_cache()

    folded = stats.get_worst_recent_moments(session, amount=4)
    assert [(moment["game"]["id"], moment["ply"]) for moment in folded] == [
        (moment["game"]["id"], moment["ply"]) for moment in scanned
    ]
    # Oldest game first, then earliest ply, rather than whatever the scan reached first.
    assert [moment["ply"] for moment in folded] == [0, 2, 0, 2]


def test_the_backfill_folds_one_chunk_at_a_time_and_says_when_it_is_done(
    analysed: Library,
) -> None:
    """Resumable rather than one long transaction: three analysed games, two at a time."""
    session = analysed.session
    assert stats.rebuild_stat_summaries(session, limit=2) == 2
    assert stats.rebuild_stat_summaries(session, limit=2) == 1
    assert stats.rebuild_stat_summaries(session, limit=2) == 0


# --------------------------------------------------------------------------- notes


def test_a_standalone_note_is_timestamped(session: Session) -> None:
    note = notes.save_note(session, "  work on rook endings  ", ["plan", "endgame"])
    assert note.text == "work on rook endings"
    assert note.tags == ["plan", "endgame"]
    assert note.game_id is None and note.position_id is None
    assert note.created_at.tzinfo is not None
    assert note.updated_at is not None


def test_an_empty_note_is_rejected(session: Session) -> None:
    with pytest.raises(ValueError, match="a note needs text"):
        notes.save_note(session, "   ")


def test_a_note_on_a_fen_creates_the_position_if_it_is_new(session: Session) -> None:
    note = notes.save_note(session, "always mishandle this", fen=ENDGAME_FEN)
    assert note.position_id is not None
    stored = session.get(Position, note.position_id)
    assert stored is not None
    assert stored.fen == "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - -"


def test_a_note_on_a_game(library: Library) -> None:
    note = notes.save_note(
        library.session, "lost the thread here", ["ruy"], game_id=library["qg000001"].id
    )
    assert note.game_id == library["qg000001"].id
    found = notes.search_notes(library.session, game_id=library["qg000001"].id)
    assert [row.id for row in found] == [note.id]


def test_tags_are_trimmed_and_deduplicated(session: Session) -> None:
    note = notes.save_note(session, "text", [" Ruy ", "ruy", "", "endgame"])
    assert note.tags == ["Ruy", "endgame"]
    assert notes.normalize_tags(["a", "A", "b"]) == ["a", "b"]


def test_search_matches_free_text_case_insensitively(session: Session) -> None:
    notes.save_note(session, "The Berlin Defense keeps biting me", ["opening"])
    notes.save_note(session, "rook endings", ["endgame"])
    found = notes.search_notes(session, query="berlin")
    assert len(found) == 1
    assert "Berlin" in found[0].text


def test_search_ands_its_tags(session: Session) -> None:
    both = notes.save_note(session, "both", ["opening", "ruy"])
    notes.save_note(session, "one", ["opening"])
    assert [note.id for note in notes.search_notes(session, tags=["opening", "ruy"])] == [both.id]
    assert len(notes.search_notes(session, tags=["opening"])) == 2
    assert len(notes.search_notes(session, tags=["OPENING", "RUY"])) == 1


def test_search_narrows_by_date_and_returns_newest_first(session: Session) -> None:
    old = notes.save_note(session, "old thought", ["plan"])
    new = notes.save_note(session, "new thought", ["plan"])
    old.created_at = datetime(2026, 1, 1, tzinfo=UTC)
    session.commit()

    assert [note.id for note in notes.search_notes(session, tags=["plan"])] == [new.id, old.id]
    recent = notes.search_notes(session, since=datetime(2026, 6, 1, tzinfo=UTC))
    assert [note.id for note in recent] == [new.id]
    ancient = notes.search_notes(session, until=datetime(2026, 2, 1, tzinfo=UTC))
    assert [note.id for note in ancient] == [old.id]


def test_search_by_fen(session: Session) -> None:
    notes.save_note(session, "this endgame", fen=ENDGAME_FEN)
    notes.save_note(session, "unrelated")
    found = notes.search_notes(session, fen=ENDGAME_FEN)
    assert [note.text for note in found] == ["this endgame"]
    assert notes.search_notes(session, fen=START_EPD) == []


def test_search_respects_its_limit(session: Session) -> None:
    for index in range(5):
        notes.save_note(session, f"note {index}", ["plan"])
    assert len(notes.search_notes(session, tags=["plan"], limit=2)) == 2


def test_update_and_delete(session: Session) -> None:
    note = notes.save_note(session, "first draft", ["plan"])
    updated = notes.update_note(session, note.id, text="second draft", tags=["plan", "done"])
    assert updated.text == "second draft"
    assert updated.tags == ["plan", "done"]
    assert updated.created_at == note.created_at

    assert notes.delete_note(session, note.id) is True
    assert notes.delete_note(session, note.id) is False
    assert notes.get_note(session, note.id) is None
    with pytest.raises(notes.NoteNotFoundError):
        notes.update_note(session, note.id, text="gone")


def test_list_tags_counts_usage(session: Session) -> None:
    notes.save_note(session, "a", ["opening", "ruy"])
    notes.save_note(session, "b", ["opening"])
    assert notes.list_tags(session) == [
        {"tag": "opening", "notes": 2},
        {"tag": "ruy", "notes": 1},
    ]


def test_note_payload_is_json_shaped(session: Session) -> None:
    note = notes.save_note(session, "payload", ["plan"])
    payload = notes.note_payload(note)
    assert payload["text"] == "payload"
    assert payload["tags"] == ["plan"]
    assert isinstance(payload["created_at"], str)


def test_deleting_a_game_takes_its_notes_with_it(library: Library) -> None:
    session = library.session
    game = library["qg000001"]
    notes.save_note(session, "attached", game_id=game.id)
    session.delete(game)
    session.commit()
    assert session.scalars(select(Note)).all() == []


# --------------------------------------------------------------------------- lines


def test_a_line_is_kept_with_its_moves_in_san(library: Library) -> None:
    game = library["qg000001"]
    line = notes.save_line(library.session, game.id, 3, ["d7d6", "d2d4"])
    assert (line.game_id, line.base_ply) == (game.id, 3)
    payload = notes.line_payload(line)
    assert payload["moves"] == ["d7d6", "d2d4"]
    assert payload["sans"] == ["d6", "d4"]


def test_a_line_already_kept_is_not_kept_twice(library: Library) -> None:
    """Prefix in, the stored one comes back; extension in, the stored one grows."""
    session = library.session
    game = library["qg000001"]
    first = notes.save_line(session, game.id, 3, ["d7d6", "d2d4"])
    assert notes.save_line(session, game.id, 3, ["d7d6"]).id == first.id
    grown = notes.save_line(session, game.id, 3, ["d7d6", "d2d4", "e5d4"])
    assert grown.id == first.id
    assert grown.moves == ["d7d6", "d2d4", "e5d4"]
    # A different branch point is a different line, however the moves read.
    other = notes.save_line(session, game.id, 5, ["g8f6", "e1g1"])
    assert other.id != first.id
    assert [line.id for line in notes.get_lines(session, game.id)] == [first.id, other.id]


def test_a_line_that_could_not_have_been_played_is_refused(library: Library) -> None:
    with pytest.raises(ValueError):
        notes.save_line(library.session, library["qg000001"].id, 3, ["e2e4"])
    with pytest.raises(ValueError, match="at least one move"):
        notes.save_line(library.session, library["qg000001"].id, 3, [])
    with pytest.raises(notes.UnknownGameError):
        notes.save_line(library.session, 9999, 0, ["e2e4"])


def test_unpinning_a_line_keeps_the_note_written_about_it(library: Library) -> None:
    session = library.session
    game = library["qg000001"]
    note = notes.save_note(
        session, "d6 holds", line={"game_id": game.id, "base_ply": 3, "moves": ["d7d6"]}
    )
    line_id = note.line_id
    assert line_id is not None
    assert notes.delete_line(session, line_id) is True
    assert notes.delete_line(session, line_id) is False
    session.refresh(note)
    assert note.line_id is None
    assert note.text == "d6 holds"


def test_a_note_on_a_line_pins_it_and_lands_on_its_tip(library: Library) -> None:
    session = library.session
    game = library["qg000001"]
    note = notes.save_note(
        session,
        "the whole point of the line",
        line={"game_id": game.id, "base_ply": 3, "moves": ["d7d6", "d2d4"]},
    )
    assert note.game_id == game.id
    assert note.ply == 5
    # A line note knows its own position, which is what makes it resurface like a FEN one.
    assert note.position_id is not None
    payload = notes.note_payload(note)
    assert payload["line"]["sans"] == ["d6", "d4"]
    assert payload["game"]["white"] == "blunderbase"

    inside = notes.save_note(session, "and here", line_id=note.line_id, ply=4)
    assert inside.ply == 4
    with pytest.raises(ValueError, match="outside line"):
        notes.save_note(session, "nowhere", line_id=note.line_id, ply=9)
    with pytest.raises(notes.LineNotFoundError):
        notes.save_note(session, "nowhere", line_id=9999)


def test_a_note_on_a_ply_takes_the_position_of_that_ply(library: Library) -> None:
    session = library.session
    game = library["qg000001"]
    note = notes.save_note(session, "the tempo goes here", game_id=game.id, ply=4)
    assert note.position_id is not None
    assert notes.note_payload(note)["fen"] is not None
    with pytest.raises(ValueError, match="outside game"):
        notes.save_note(session, "past the end", game_id=game.id, ply=99)


TRANSPOSITION_PGN = """[Event "Direct"]
[Site "https://lichess.org/tp000001"]
[Date "2026.02.01"]
[White "blunderbase"]
[Black "ruyfan"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 1-0

[Event "The long way round"]
[Site "https://lichess.org/tp000002"]
[Date "2026.02.02"]
[White "blunderbase"]
[Black "ruyfan"]
[Result "0-1"]

1. Nf3 Nc6 2. Ng1 Nb8 3. e4 e5 4. Nf3 Nc6 5. Bc4 0-1
"""


def test_a_position_note_lands_on_the_ply_this_game_reached_it(session: Session) -> None:
    """A transposition: the note's own ply counts half-moves into the *other* game.

    Both games stand in the same position — one after five half-moves, one after nine — and
    the move list draws the marker where this game arrived, not where the note was written.
    """
    job = run_import(session, Source.PGN, text=TRANSPOSITION_PGN, analyze=False)
    assert job.games_imported == 2, job.errors
    direct, long_way = session.scalars(select(Game).order_by(Game.id)).all()
    note = notes.save_note(session, "the Italian bishop", game_id=long_way.id, ply=9)
    assert note.ply == 9 and note.position_id is not None

    rows = games_service.game_notes(session, direct.id)

    assert [row["scope"] for row in rows] == ["position"]
    assert rows[0]["ply"] == 5
    # And the game it was written against still reports its own ply, from the other loop.
    own = games_service.game_notes(session, long_way.id)
    assert [(row["scope"], row["ply"]) for row in own] == [("game", 9)]


def test_the_game_notes_a_line_note_shows_up_in(library: Library) -> None:
    session = library.session
    game = library["qg000001"]
    branch = {"game_id": game.id, "base_ply": 3, "moves": ["d7d6"]}
    notes.save_note(session, "on the line", line=branch)
    rows = games_service.game_notes(session, game.id)
    assert [row["scope"] for row in rows] == ["line"]
    assert rows[0]["ply"] == 4
    assert rows[0]["line_id"]


# --------------------------------------------------------------------------- notes: scope


def test_search_narrows_by_scope_and_by_line(library: Library) -> None:
    session = library.session
    game = library["qg000001"]
    free = notes.save_note(session, "a plan for the month", ["plan"])
    on_game = notes.save_note(session, "about the game", game_id=game.id)
    on_position = notes.save_note(session, "about a position", fen=ENDGAME_FEN)
    on_line = notes.save_note(
        session, "about a line", line={"game_id": game.id, "base_ply": 3, "moves": ["d7d6"]}
    )

    def ids(**filters: object) -> list[int]:
        return [note.id for note in notes.search_notes(session, **filters)]  # type: ignore[arg-type]

    assert ids(scope="free") == [free.id]
    assert ids(scope="game") == [on_game.id]
    assert ids(scope="position") == [on_position.id]
    assert ids(scope="line") == [on_line.id]
    assert ids(line_id=on_line.line_id) == [on_line.id]
    assert set(ids(has_position=True)) == {on_position.id, on_line.id}
    assert set(ids(has_position=False)) == {free.id, on_game.id}
    with pytest.raises(ValueError, match="unknown scope"):
        notes.search_notes(session, scope="sideways")


def test_free_text_search_survives_a_database_without_the_index(session: Session) -> None:
    """FTS5 is an optimisation, not a dependency: the fallback has to find the same note."""
    from backend.db import fts

    notes.save_note(session, "The Berlin Defense keeps biting me", ["opening"])
    with session.begin_nested():
        fts.drop_notes_fts(session.connection())
    notes._FTS_READY.clear()

    found = notes.search_notes(session, query="berlin")
    assert [note.text for note in found] == ["The Berlin Defense keeps biting me"]


def test_a_note_from_the_live_board_snapshots_what_is_on_it(library: Library) -> None:
    """The one write where the caller names nothing: the board already says where it is."""
    session = library.session
    game = library["qg000001"]
    try:
        live_service.show_game(session, game.id, 4)
        live_service.make_move("f1c4")
        note = notes.save_note(session, "why not the Italian here", from_live=True)
    finally:
        live_service.clear()

    assert note.game_id == game.id
    assert note.source is NoteSource.LIVE
    assert note.position_id is not None
    # The board left the game, so the departure is kept as a line and the note sits on it.
    assert note.line is not None
    assert note.line.base_ply == 4
    assert note.line.moves == ["f1c4"]
    assert note.ply == 5


def test_a_note_from_an_empty_live_board_is_refused(session: Session) -> None:
    live_service.clear()
    with pytest.raises(live_service.NoLivePositionError):
        notes.save_note(session, "about nothing", from_live=True)


# --------------------------------------------------------------------------- resurfacing


# --------------------------------------------------------------------------- export


def test_markdown_export_groups_notes_under_their_game(library: Library) -> None:
    session = library.session
    game = library["qg000001"]
    notes.save_note(session, "the tempo goes here", ["plan"], game_id=game.id, ply=4)
    notes.save_note(
        session, "d6 holds", line={"game_id": game.id, "base_ply": 3, "moves": ["d7d6", "d2d4"]}
    )
    notes.save_note(session, "this endgame", fen=ENDGAME_FEN)
    notes.save_note(session, "a plan for the month", ["plan"])

    document = notes.export_notes(session, notes.search_notes(session), fmt="md")
    assert "# Blunderbase notes" in document
    assert "## blunderbase – ruyfan, 1-0 (2026-01-05)" in document
    assert f"[/games/{game.id}](/games/{game.id})" in document
    # The move a note is about is named the way a person writes it.
    assert "**2... Nc6** — the tempo goes here" in document
    # A note on a variation is labelled by the variation's move, not by the game's.
    assert "**3. d4** — d6 holds" in document
    assert "line: 2... d6 3. d4" in document
    assert "#plan" in document
    assert "## Positions" in document
    assert "## Free notes" in document
    assert "a plan for the month" in document


def test_pgn_export_reads_back_as_pgn(library: Library) -> None:
    """The point of the PGN is that another program opens it, so parse it back."""
    import io

    import chess.pgn

    session = library.session
    game = library["qg000001"]
    notes.save_note(session, "the tempo goes here", game_id=game.id, ply=4)
    notes.save_note(
        session, "d6 holds", line={"game_id": game.id, "base_ply": 3, "moves": ["d7d6", "d2d4"]}
    )
    notes.save_note(session, "this endgame", fen=ENDGAME_FEN)
    notes.save_note(session, "a plan for the month")

    document = notes.export_notes(session, notes.search_notes(session), fmt="pgn")
    stream = io.StringIO(document)
    parsed = []
    while (entry := chess.pgn.read_game(stream)) is not None:
        parsed.append(entry)
    assert len(parsed) == 3

    first = parsed[0]
    assert first.headers["White"] == "blunderbase"
    assert first.headers["Site"] == f"/games/{game.id}"
    comments = [node.comment for node in first.mainline() if node.comment]
    assert "the tempo goes here" in comments
    # The kept line came out as a real variation, with its note inside it.
    at_branch = list(first.mainline())[2]
    assert len(at_branch.variations) == 2
    variation = at_branch.variations[1]
    assert variation.san() == "d6"
    assert variation.variations[0].comment == "d6 holds"

    from_position = parsed[1]
    assert "Variant" not in from_position.headers
    assert from_position.headers["SetUp"] == "1"
    assert from_position.headers["FEN"].startswith("6k1/5ppp")
    assert from_position.comment == "this endgame"
    assert parsed[2].comment == "a plan for the month"


def test_library_pgn_exports_every_game_with_original_headers_and_annotations(
    library: Library,
) -> None:
    """The portable export is complete even when most games have no notes."""
    import io

    import chess.pgn

    session = library.session
    game = library["qg000001"]
    notes.save_note(session, "the tempo goes here", ["plan"], game_id=game.id, ply=4)
    notes.save_line(session, game.id, 3, ["d7d6", "d2d4"])

    document = notes.export_library_pgn(session)
    stream = io.StringIO(document)
    parsed = []
    while (entry := chess.pgn.read_game(stream)) is not None:
        parsed.append(entry)

    assert len(parsed) == len(library.by_source_id)
    exported = next(entry for entry in parsed if entry.headers.get("Site", "").endswith("qg000001"))
    assert exported.headers["WhiteElo"] == "1750"
    assert any("the tempo goes here [plan]" in node.comment for node in exported.mainline())
    branch = list(exported.mainline())[2]
    assert [variation.san() for variation in branch.variations] == ["Nc6", "d6"]


def test_an_unknown_export_format_is_refused(session: Session) -> None:
    with pytest.raises(ValueError, match="unknown export format"):
        notes.export_notes(session, [], fmt="docx")

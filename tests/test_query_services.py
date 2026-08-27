from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.db.enums import (
    Classification,
    Color,
    EngineKind,
    Platform,
    Result,
    RunStatus,
    Source,
    Speed,
    Tier,
)
from backend.db.models import Account, AnalysisRun, Engine, Game, MoveEval, Note, Position
from backend.services import explorer, notes, stats
from backend.services import games as games_service
from backend.services.games import GameFilters
from backend.services.import_service import run_import

OWNER = "blunderbase"
START_EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"
# Two kings, two rooks and pawns: well under the endgame material threshold.
ENDGAME_FEN = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 4 30"


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


def test_find_positions_lists_the_games_that_reached_one(library: Library) -> None:
    rows = explorer.find_positions(library.session, START_EPD)
    assert len(rows) == 6
    assert rows[0]["game"]["id"] == library["qg000006"].id
    assert rows[0]["ply"] == 0
    assert rows[0]["move_san"] == "e4"

    white_only = explorer.find_positions(library.session, START_EPD, color=Color.BLACK)
    assert [row["game"]["source_id"] for row in white_only] == ["qg000005"]


def test_a_position_no_game_reached_is_an_empty_tree(library: Library) -> None:
    fen = "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1"
    tree = explorer.opening_explorer(library.session, fen=fen)
    assert tree["moves"] == []
    assert tree["totals"]["games"] == 0
    assert tree["leaves_book_because"] == "no games"
    assert explorer.find_positions(library.session, fen) == []


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

from __future__ import annotations

import json
from collections.abc import Iterator, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from mcp import Client
from mcp.server import MCPServer
from mcp.types import CallToolResult, TextContent, Tool
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from backend.config import MAIA_MAX_RATING
from backend.db.enums import (
    Classification,
    EngineKind,
    Platform,
    RunStatus,
    Source,
    Tier,
)
from backend.db.models import Account, AnalysisRun, Engine, Game, GamePosition, MoveEval
from backend.mcp import server as mcp_server
from backend.mcp.server import build_server
from backend.services import analysis as analysis_service
from backend.services import engines as engines_service
from backend.services import live as live_service
from backend.services import runners as runners_service
from backend.services.import_service import run_import

OWNER = "blunderbase"
START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
FRENCH = "rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"

# What "token-conscious" has to mean in bytes: five analysed games, with their eval
# curves and worst moments, inside a couple of thousand characters.
LAST_GAMES_BUDGET = 4000


@pytest.fixture()
def library(session: Session, fixtures_dir: Path) -> dict[str, Game]:
    """The fixture PGN imported through the real pipeline, owned by one account."""
    session.add(Account(platform=Platform.LICHESS, username=OWNER, is_owner=True))
    session.commit()
    job = run_import(session, Source.PGN, path=str(fixtures_dir / "query_games.pgn"))
    assert job.games_imported == 6, job.errors
    stored = session.scalars(select(Game).order_by(Game.id)).all()
    return {game.source_id: game for game in stored}


@pytest.fixture()
def engine_row(session: Session) -> Engine:
    engine = Engine(
        name="stockfish-test",
        kind=EngineKind.UCI,
        path="/nonexistent/stockfish",
    )
    session.add(engine)
    session.commit()
    engines_service.assign_default_roles(session, engine)
    return engine


def analyse(
    session: Session,
    game: Game,
    evals: Sequence[dict[str, Any]],
    *,
    engine: Engine | None = None,
    tier: Tier = Tier.QUICK,
    status: RunStatus = RunStatus.DONE,
) -> AnalysisRun:
    """One finished full-game run, the way a worker eventually writes it."""
    positions = {
        row.ply: row.position_id
        for row in session.scalars(select(GamePosition).where(GamePosition.game_id == game.id))
    }
    run = AnalysisRun(
        game_id=game.id,
        engine_id=engine.id if engine is not None else None,
        tier=tier,
        status=status,
        finished_at=datetime.now(UTC),
    )
    session.add(run)
    session.flush()
    for entry in evals:
        ply = entry["ply"]
        session.add(
            MoveEval(
                run_id=run.id,
                ply=ply,
                position_id=positions.get(ply),
                move_san=game.moves_san[ply],
                move_uci=game.moves_uci[ply],
                classification=entry.get("classification"),
                win_before=entry.get("win_before"),
                win_after=entry.get("win_after"),
                win_loss=entry.get("win_loss"),
                eval_after_cp=entry.get("cp"),
                best_move_uci=entry.get("best_move_uci"),
                best_lines=entry.get("best_lines"),
                maia_policy=entry.get("maia_policy"),
            )
        )
    session.commit()
    return run


@pytest.fixture()
def analysed(library: dict[str, Game], session: Session, engine_row: Engine) -> dict[str, Game]:
    """Quick passes over two of the owner's games, one of them with Maia and lines."""
    berlin = library["qg000001"]
    analyse(
        session,
        berlin,
        [
            {"ply": 0, "classification": Classification.BEST, "win_after": 52.0, "cp": 20},
            {"ply": 1, "classification": Classification.GOOD, "win_after": 51.0, "cp": 15},
            {
                "ply": 2,
                "classification": Classification.INACCURACY,
                "win_after": 39.0,
                "win_loss": 12.0,
                "cp": -60,
                "best_move_uci": "d2d4",
                "best_lines": [{"rank": 1, "cp": 30, "pv": ["d2d4", "d7d5", "g1f3"]}],
                "maia_policy": {"1700": [{"uci": "b1c3", "p": 0.41}]},
            },
            {"ply": 3, "classification": Classification.GOOD, "win_after": 60.0, "cp": 55},
            {
                "ply": 4,
                "classification": Classification.BLUNDER,
                "win_after": 8.0,
                "win_loss": 45.0,
                "cp": -420,
                "best_move_uci": "f1c4",
            },
            {"ply": 5, "classification": Classification.BEST, "win_after": 92.0, "cp": 430},
            {
                "ply": 6,
                "classification": Classification.MISTAKE,
                "win_after": 70.0,
                "win_loss": 22.0,
                "cp": 180,
                "best_move_uci": "e1g1",
            },
        ],
        engine=engine_row,
    )
    analyse(
        session,
        library["qg000006"],
        [
            {"ply": ply, "classification": Classification.GOOD, "win_after": 50.0 + ply}
            for ply in range(0, 20)
        ],
        engine=engine_row,
    )
    return library


@pytest.fixture()
def coach(sessions: sessionmaker[Session]) -> MCPServer:
    """The coach surface over the test database.

    Every call below connects a client of its own: the SDK's client owns a task group,
    and a fixture that yielded one would tear it down in a different task than the one it
    was entered in. Connecting is in-process and costs nothing.
    """
    return build_server(sessions=sessions)


def text_of(result: CallToolResult) -> str:
    assert result.content, "a tool answered with no content"
    block = result.content[0]
    assert isinstance(block, TextContent)
    assert len(result.content) == 1, "a payload should be one block, not several"
    return block.text


async def invoke(coach: MCPServer, name: str, arguments: dict[str, Any]) -> CallToolResult:
    async with Client(coach) as client:
        return await client.call_tool(name, arguments)


async def tools_of(coach: MCPServer) -> list[Tool]:
    async with Client(coach) as client:
        return (await client.list_tools()).tools


async def call(coach: MCPServer, name: str, **arguments: Any) -> Any:
    result = await invoke(coach, name, arguments)
    assert not result.is_error, text_of(result)
    return json.loads(text_of(result))


async def failure(coach: MCPServer, name: str, **arguments: Any) -> dict[str, Any]:
    result = await invoke(coach, name, arguments)
    assert result.is_error, text_of(result)
    payload = json.loads(text_of(result))
    assert set(payload) >= {"error", "message"}
    assert "Traceback" not in payload["message"]
    return payload


# --- the surface itself ----------------------------------------------------


async def test_every_tool_describes_itself(coach: MCPServer) -> None:
    listing = await tools_of(coach)
    for tool in listing:
        assert tool.description and len(tool.description) > 40, tool.name
        assert tool.input_schema["type"] == "object"


async def test_only_the_id_arguments_are_required(coach: MCPServer) -> None:
    """A coach tool with no required argument is one the model can always reach for."""
    listing = await tools_of(coach)
    required = {tool.name: set(tool.input_schema.get("required", ())) for tool in listing}
    assert required["get_last_games"] == set()
    assert required["search_games"] == set()
    assert required["get_game"] == {"game_id"}
    assert required["get_analysis_status"] == {"run_id"}
    assert required["find_positions"] == {"fen"}
    assert required["save_note"] == {"text"}


async def test_a_payload_is_one_compact_json_block(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    result = await invoke(coach, "get_last_games", {"amount": 2})
    text = text_of(result)
    assert text.startswith("{") and "\n" not in text
    assert ", " not in text and '": ' not in text
    json.loads(text)


# --- convenience -----------------------------------------------------------


async def test_get_last_games_returns_newest_first_with_cards(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    payload = await call(coach, "get_last_games", amount=3)
    assert payload["count"] == 3
    games = payload["games"]
    assert [game["id"] for game in games] == [
        analysed["qg000006"].id,
        analysed["qg000005"].id,
        analysed["qg000004"].id,
    ]
    newest = games[0]
    assert newest["opponent"] == "slowburner"
    assert newest["opponent_rating"] == 1800
    assert newest["color"] == "white"
    assert newest["outcome"] == "win"
    assert newest["opening"].startswith("Italian Game")
    assert newest["analyzed"] is True
    assert newest["played_at"].endswith("Z")


async def test_get_last_games_carries_the_curve_and_the_worst_moments(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    payload = await call(coach, "get_last_games", amount=6)
    berlin = next(game for game in payload["games"] if game["id"] == analysed["qg000001"].id)
    assert berlin["eval_curve"] == [
        [0, 52.0], [1, 51.0], [2, 39.0], [3, 60.0], [4, 8.0], [5, 92.0], [6, 70.0]
    ]
    moments = berlin["worst_moments"]
    assert [moment["ply"] for moment in moments] == [4, 6, 2]
    assert moments[0]["classification"] == "blunder"
    assert moments[0]["best_move_uci"] == "f1c4"
    assert moments[0]["san"] == analysed["qg000001"].moves_san[4]


async def test_worst_moments_are_only_the_owners_own_moves(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    """The Berlin game is the owner's as White, so an odd ply is the opponent's."""
    payload = await call(coach, "get_last_games", amount=6, worst_moments=8)
    berlin = next(game for game in payload["games"] if game["id"] == analysed["qg000001"].id)
    assert all(moment["ply"] % 2 == 0 for moment in berlin["worst_moments"])


async def test_get_last_games_stays_inside_its_byte_budget(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    result = await invoke(coach, "get_last_games", {"amount": 5})
    assert len(text_of(result).encode()) < LAST_GAMES_BUDGET


async def test_a_long_eval_curve_is_thinned(coach: MCPServer, analysed: dict[str, Game]) -> None:
    payload = await call(coach, "get_last_games", amount=6)
    giuoco = next(game for game in payload["games"] if game["id"] == analysed["qg000006"].id)
    assert len(giuoco["eval_curve"]) == mcp_server.CURVE_POINTS
    assert giuoco["eval_curve"][0][0] == 0
    assert giuoco["eval_curve"][-1][0] == 19


async def test_get_last_games_filters_by_platform_and_time_control(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    assert (await call(coach, "get_last_games", platform="lichess"))["count"] == 0
    assert (await call(coach, "get_last_games", platform="pgn"))["count"] == 5
    blitz = await call(coach, "get_last_games", time_control="blitz")
    assert {game["speed"] for game in blitz["games"]} == {"blitz"}
    literal = await call(coach, "get_last_games", time_control="600+5")
    assert [game["id"] for game in literal["games"]] == [analysed["qg000006"].id]


async def test_get_last_games_caps_a_greedy_amount(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    payload = await call(coach, "get_last_games", amount=5000)
    assert payload["count"] == 6


async def test_an_unknown_platform_is_a_structured_error(coach: MCPServer) -> None:
    payload = await failure(coach, "get_last_games", platform="chess24")
    assert payload["error"] == "bad_argument"
    assert "lichess" in payload["allowed"]


async def test_get_worst_recent_moments_ranks_by_what_it_cost(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    payload = await call(coach, "get_worst_recent_moments")
    moments = payload["moments"]
    # Blunders only: this is the "what should I train?" question, not a move list.
    assert [moment["win_loss"] for moment in moments] == [45.0]
    worst = moments[0]
    assert worst["classification"] == "blunder"
    assert worst["phase"] == "opening"
    assert worst["piece"]
    assert worst["fen"]
    assert worst["best_move_san"]
    assert worst["game"]["id"] == analysed["qg000001"].id


async def test_get_worst_recent_moments_narrows_by_days(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    """The fixture games are months old, so a week's window is honestly empty."""
    assert (await call(coach, "get_worst_recent_moments", days=7))["count"] == 0
    assert (await call(coach, "get_worst_recent_moments", days=3650))["count"] == 1


async def test_compare_periods_answers_with_both_windows_and_the_delta(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    payload = await call(
        coach,
        "compare_periods",
        dimension="performance_by_speed",
        then_start="2026-01-01",
        then_end="2026-02-01",
        now_start="2026-02-01",
        now_end="2026-04-01",
    )
    assert set(payload) >= {"dimension", "then", "now", "delta"}
    assert payload["then"]["total"]["games"] == 2
    assert payload["now"]["total"]["games"] == 4


async def test_compare_periods_accepts_relative_windows(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    payload = await call(
        coach,
        "compare_periods",
        dimension="rating_trend",
        then_start="2y",
        then_end="1y",
        now_start="1y",
    )
    assert payload["now"]["total"]["games"] == 6


async def test_a_backwards_window_is_a_structured_error(coach: MCPServer) -> None:
    payload = await failure(
        coach,
        "compare_periods",
        dimension="rating_trend",
        then_start="2026-03-01",
        then_end="2026-01-01",
        now_start="2026-04-01",
    )
    assert payload["error"] == "bad_argument"
    assert "then_start" in payload["message"]


async def test_an_unparseable_date_is_a_structured_error(coach: MCPServer) -> None:
    payload = await failure(coach, "search_games", since="last tuesday")
    assert payload["error"] == "bad_argument"
    assert "since" in payload["message"]


# --- query -----------------------------------------------------------------


async def test_search_games_filters_and_counts(coach: MCPServer, analysed: dict[str, Game]) -> None:
    payload = await call(coach, "search_games", eco="C6")
    assert payload["total"] == 2
    assert {game["eco"] for game in payload["games"]} == {"C65", "C60"}
    assert payload["offset"] == 0


async def test_search_games_pages(coach: MCPServer, analysed: dict[str, Game]) -> None:
    """The offset the coach is handed back is the one it has to send to turn the page."""
    first = await call(coach, "search_games", limit=2)
    second = await call(coach, "search_games", limit=2, offset=2)
    assert first["total"] == second["total"] == 6
    assert (first["offset"], second["offset"]) == (0, 2)
    assert not {game["id"] for game in first["games"]} & {game["id"] for game in second["games"]}


async def test_an_unknown_outcome_is_a_structured_error(coach: MCPServer) -> None:
    payload = await failure(coach, "search_games", outcome="victory")
    assert payload["error"] == "bad_argument"


async def test_get_game_reads_a_game_move_by_move(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    game = analysed["qg000001"]
    payload = await call(coach, "get_game", game_id=game.id)
    assert payload["game"]["id"] == game.id
    assert len(payload["moves"]) == game.ply_count
    assert [move["ply"] for move in payload["moves"][:3]] == [0, 1, 2]
    assert payload["moves"][0]["san"] == game.moves_san[0]
    assert payload["runs"][0]["tier"] == "quick"
    assert payload["runs"][0]["status"] == "done"


async def test_get_game_only_classifies_the_moves_that_went_wrong(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    payload = await call(coach, "get_game", game_id=analysed["qg000001"].id)
    by_ply = {move["ply"]: move for move in payload["moves"]}
    assert "classification" not in by_ply[0]
    assert by_ply[4]["classification"] == "blunder"
    assert by_ply[4]["win_loss"] == 45.0
    assert by_ply[4]["best_move_uci"] == "f1c4"
    assert by_ply[2]["maia"] == {"1700": [{"uci": "b1c3", "p": 0.41}]}


async def test_get_game_leaves_the_engine_lines_out_until_they_are_asked_for(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    without = await call(coach, "get_game", game_id=analysed["qg000001"].id)
    assert all("best_lines" not in move for move in without["moves"])
    with_lines = await call(
        coach, "get_game", game_id=analysed["qg000001"].id, include_lines=True
    )
    lines = [move for move in with_lines["moves"] if "best_lines" in move]
    assert lines and lines[0]["best_lines"][0]["pv"] == ["d2d4", "d7d5", "g1f3"]


async def test_get_game_narrows_to_a_ply_range(coach: MCPServer, analysed: dict[str, Game]) -> None:
    payload = await call(coach, "get_game", game_id=analysed["qg000001"].id, ply_start=2, ply_end=5)
    assert [move["ply"] for move in payload["moves"]] == [2, 3, 4]
    assert payload["ply_range"] == [2, 5]


async def test_half_a_ply_range_is_a_structured_error(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    payload = await failure(coach, "get_game", game_id=analysed["qg000001"].id, ply_start=4)
    assert payload["error"] == "bad_argument"


async def test_an_unknown_game_is_a_structured_error(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    payload = await failure(coach, "get_game", game_id=9999)
    assert payload["error"] == "unknown_game"
    assert payload["game_id"] == 9999


async def test_find_positions_answers_have_i_been_here_before(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    payload = await call(coach, "find_positions", fen=START_FEN)
    assert payload["count"] == 6
    first = payload["games"][0]
    assert first["ply"] == 0
    assert first["game"]["id"] == analysed["qg000006"].id
    assert first["move_san"]


async def test_find_positions_rejects_a_typo_as_a_bad_fen(coach: MCPServer) -> None:
    payload = await failure(coach, "find_positions", fen="8/8/not a position")
    assert payload["error"] == "bad_fen"


async def test_find_positions_says_so_about_motifs(coach: MCPServer) -> None:
    payload = await failure(coach, "find_positions", fen=START_FEN, motif="fork")
    assert payload["error"] == "not_implemented"
    assert payload["motif"] == "fork"


async def test_get_player_profile_reports_accounts_ratings_and_volume(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    payload = await call(coach, "get_player_profile")
    assert [account["username"] for account in payload["accounts"]] == [OWNER]
    assert payload["volume"]["games"] == 6
    assert payload["volume"]["wins"] == 4
    series = payload["ratings"][0]
    assert series["current"] and series["points"]
    assert series["points"][0]["at"].endswith("Z")


# --- accounts --------------------------------------------------------------


async def test_register_account_claims_the_games_that_were_stored_without_one(
    coach: MCPServer, session: Session, fixtures_dir: Path
) -> None:
    """The coach's own repair for an archive imported before an account named its owner."""
    run_import(session, Source.PGN, path=str(fixtures_dir / "query_games.pgn"))
    assert all(game.owner_color is None for game in session.scalars(select(Game)))

    payload = await call(coach, "register_account", platform="lichess", username=OWNER)

    assert payload["account"]["username"] == OWNER
    assert payload["account"]["is_owner"] is True
    assert payload["account"]["games"] == 6
    assert (payload["linked"], payload["colored"], payload["unclaimed"]) == (6, 6, 0)


async def test_register_account_refuses_a_platform_nobody_plays_on(coach: MCPServer) -> None:
    """The tool takes a platform, not a source, so it is `args.member` that refuses this."""
    payload = await failure(coach, "register_account", platform="telepathy", username=OWNER)
    assert payload["error"] == "bad_argument"
    assert "chesscom" in payload["allowed"]


# --- stats and explorer ----------------------------------------------------


async def test_opening_explorer_walks_the_owners_own_tree(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    payload = await call(coach, "opening_explorer")
    assert payload["totals"]["games"] == 6
    assert payload["side_to_move"] == "white"
    played = {move["san"]: move for move in payload["moves"]}
    assert played["e4"]["games"] == 5
    assert payload["main_line"][0]["san"] == "e4"


async def test_opening_explorer_enters_by_eco(coach: MCPServer, analysed: dict[str, Game]) -> None:
    payload = await call(coach, "opening_explorer", eco="C5")
    assert payload["totals"]["games"] == 2
    assert payload["path"]


async def test_opening_explorer_names_the_position_from_the_book(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    # The tool hands the service payload straight to the model, so the vendored name needed
    # nothing added here. The coach asks by FEN and never by path, which is why the lookup
    # is the position's own and `ply` is absent rather than an ancestor's.
    fen = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -"
    payload = await call(coach, "opening_explorer", fen=fen)
    assert payload["opening"] == {"eco": "C20", "name": "King's Pawn Game"}


async def test_opening_explorer_caps_its_continuations(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    payload = await call(coach, "opening_explorer", limit=1)
    assert len(payload["moves"]) == 1


async def test_get_stats_answers_every_dimension_it_advertises(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    listing = await tools_of(coach)
    description = next(tool for tool in listing if tool.name == "get_stats").description
    for dimension in ("blunders_by_phase", "performance_by_speed", "rating_trend"):
        assert dimension in description
        payload = await call(coach, "get_stats", dimension=dimension)
        assert payload["dimension"] == dimension
        assert "buckets" in payload


async def test_an_unknown_dimension_is_a_structured_error(coach: MCPServer) -> None:
    payload = await failure(coach, "get_stats", dimension="blunders_by_vibe")
    assert payload["error"] == "unknown_dimension"
    assert "blunders_by_phase" in payload["message"]


# --- analysis --------------------------------------------------------------


async def test_request_analysis_queues_a_run_and_hands_back_its_id(
    coach: MCPServer, analysed: dict[str, Game], session: Session
) -> None:
    game = analysed["qg000001"]
    payload = await call(coach, "request_analysis", game_id=game.id, tier="deep")
    assert payload["status"] == "queued"
    assert payload["tier"] == "deep"
    assert payload["game_id"] == game.id
    assert payload["queue"]["queued"] == 1
    run = analysis_service.get_run(session, payload["run_id"])
    assert run is not None and run.game_id == game.id


async def test_request_analysis_takes_the_levels_to_ask_maia_about(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    """A coach exploring another rating gets it for that run, without moving the setting."""
    payload = await call(
        coach, "request_analysis", game_id=analysed["qg000001"].id, elos=[1300, 900]
    )

    # Clamped to what the model can answer, exactly as the setting is.
    assert payload["maia_elos"] == [1100, 1300]


def _maia_row(session: Session) -> Engine:
    engine = Engine(name="maia-test", kind=EngineKind.MAIA, path="/nonexistent/lc0")
    session.add(engine)
    session.commit()
    engines_service.assign_default_roles(session, engine)
    return engine


async def test_maia_fill_queues_the_levels_the_library_is_missing(
    coach: MCPServer, analysed: dict[str, Game], session: Session
) -> None:
    _maia_row(session)

    payload = await call(coach, "maia_fill")

    # Two analysed games, neither carrying the configured level.
    assert payload["queued"] == 2
    assert payload["already_complete"] == 0
    # The status the button shows afterwards rides along: there is nothing left to queue.
    assert payload["missing_games"] == 0
    assert payload["configured"] == [MAIA_MAX_RATING]


async def test_request_analysis_refuses_an_unknown_game(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    payload = await failure(coach, "request_analysis", game_id=4242)
    assert payload["error"] == "unknown_game"


async def test_a_full_queue_is_a_structured_error(
    coach: MCPServer, analysed: dict[str, Game], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(mcp_server, "MAX_QUEUED_RUNS", 1)
    first = await call(coach, "request_analysis", game_id=analysed["qg000001"].id)
    assert first["run_id"]
    payload = await failure(coach, "request_analysis", game_id=analysed["qg000006"].id)
    assert payload["error"] == "queue_full"
    assert payload["queued"] == 1


async def test_clear_queue_drops_every_tier_and_says_how_many(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    await call(coach, "request_analysis", game_id=analysed["qg000001"].id)
    await call(coach, "request_analysis", game_id=analysed["qg000006"].id, tier="deep")

    payload = await call(coach, "clear_queue")

    assert payload["dropped"] == 2
    assert payload["queue"] == {"queued": 0, "running": 0, "paused": False}


async def test_get_analysis_status_reports_a_run(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    queued = await call(coach, "request_analysis", game_id=analysed["qg000001"].id)
    payload = await call(coach, "get_analysis_status", run_id=queued["run_id"])
    assert payload["status"] == "queued"
    assert payload["engine"] == "stockfish-test"
    assert payload["evals"] == 0
    assert payload["queue"]["queued"] == 1
    # A queue that is not draining is not a queue the coach should tell the owner to wait on.
    assert payload["queue"]["paused"] is False
    assert payload["created_at"].endswith("Z")


async def test_analyze_position_degrades_when_no_engine_is_enabled(
    coach: MCPServer, library: dict[str, Game]
) -> None:
    payload = await failure(coach, "analyze_position", fen=START_FEN)
    assert payload["error"] == "engine_unavailable"


async def test_analyze_position_answers_inside_its_budget(
    coach: MCPServer, analysed: dict[str, Game], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The engine itself is covered by the adapter suite; what matters here is the cap."""
    seen: dict[str, Any] = {}

    def fake(session: Session, fen: str, budget_nodes: int) -> dict[str, Any]:
        seen["fen"], seen["nodes"] = fen, budget_nodes
        return {"fen": fen, "cp": 21, "win_percent": 52.0, "best_move": {"uci": "e2e4"}}

    monkeypatch.setattr(analysis_service, "analyze_position", fake)
    payload = await call(coach, "analyze_position", fen=START_FEN, budget=10**9)
    assert seen["nodes"] == mcp_server.MAX_BUDGET_NODES
    assert payload["best_move"]["uci"] == "e2e4"


async def test_analyze_position_rejects_a_bad_fen(coach: MCPServer) -> None:
    payload = await failure(coach, "analyze_position", fen="rubbish")
    assert payload["error"] == "bad_fen"


# --- memory ----------------------------------------------------------------


async def test_save_note_refuses_an_unknown_game(coach: MCPServer) -> None:
    payload = await failure(coach, "save_note", text="about nothing", game_id=1234)
    assert payload["error"] == "unknown_game"


async def test_search_notes_opens_a_session_with_the_tags_in_use(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    await call(coach, "save_note", text="focus: endgames", tags=["plan"])
    payload = await call(coach, "search_notes")
    assert payload["count"] == 1
    assert payload["tags"] == [{"tag": "plan", "notes": 1}]


async def test_search_notes_narrows_by_date(coach: MCPServer, analysed: dict[str, Game]) -> None:
    await call(coach, "save_note", text="today's note")
    assert (await call(coach, "search_notes", since="1d"))["count"] == 1
    assert (await call(coach, "search_notes", until="2020-01-01"))["count"] == 0


async def test_save_note_pins_the_line_it_is_about(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    game = analysed["qg000001"]
    payload = await call(
        coach,
        "save_note",
        text="d6 holds the centre",
        game_id=game.id,
        base_ply=3,
        line=["d7d6", "d2d4"],
    )
    assert payload["line"]["sans"] == ["d6", "d4"]
    assert payload["line"]["base_ply"] == 3
    # The tip of the line is where the note landed.
    assert payload["ply"] == 5
    # Written through the coach, and the note says so.
    assert payload["source"] == "mcp"

    kept = await call(coach, "get_lines", game_id=game.id)
    assert kept["count"] == 1
    assert [note["text"] for note in kept["lines"][0]["notes"]] == ["d6 holds the centre"]


async def test_save_line_folds_a_line_that_is_already_kept(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    game = analysed["qg000001"]
    first = await call(coach, "save_line", game_id=game.id, base_ply=3, moves=["d7d6", "d2d4"])
    shorter = await call(coach, "save_line", game_id=game.id, base_ply=3, moves=["d7d6"])
    assert shorter["id"] == first["id"]
    longer = await call(
        coach, "save_line", game_id=game.id, base_ply=3, moves=["d7d6", "d2d4", "e5d4"]
    )
    assert longer["id"] == first["id"]
    assert longer["moves"] == ["d7d6", "d2d4", "e5d4"]
    assert (await call(coach, "get_lines", game_id=game.id))["count"] == 1


async def test_export_notes_hands_back_the_document(
    coach: MCPServer, analysed: dict[str, Game]
) -> None:
    game = analysed["qg000001"]
    await call(coach, "save_note", text="watch the c-file", game_id=game.id, ply=4)

    markdown = await invoke(coach, "export_notes", {"format": "md"})
    assert not markdown.is_error
    body = text_of(markdown)
    assert "# Blunderbase notes" in body
    assert "watch the c-file" in body
    assert f"/games/{game.id}" in body

    pgn = text_of(await invoke(coach, "export_notes", {"format": "pgn"}))
    assert "{ watch the c-file }" in pgn

    bad = await failure(coach, "export_notes", format="docx")
    assert bad["error"] == "bad_argument"


# --- runners ---------------------------------------------------------------


async def test_runners_status_describes_a_deployment_with_no_runners(
    coach: MCPServer, engine_row: Engine
) -> None:
    payload = await call(coach, "runners_status")
    assert payload["runners"] == []
    assert payload["local"]["name"] == "local"
    assert [engine["name"] for engine in payload["local"]["engines"]] == ["stockfish-test"]
    assert payload["queue"] == {"queued": 0, "running": 0}


async def test_runners_status_says_which_runner_the_backlog_is_waiting_on(
    coach: MCPServer, session: Session, library: dict[str, Game]
) -> None:
    """The coach reads rows, not links: `connected` is a column for exactly this caller."""
    runner, _token = runners_service.create_runner(session, "gpu-box", slots=4)
    runner.connected = True
    remote = Engine(
        name="sf-remote",
        kind=EngineKind.UCI,
        path="/usr/games/stockfish",
        runner_id=runner.id,
    )
    session.add(remote)
    session.flush()
    session.add(AnalysisRun(engine_id=remote.id, tier=Tier.DEEP, game_id=library["qg000001"].id))
    session.commit()

    payload = await call(coach, "runners_status")

    assert payload["runners"][0]["name"] == "gpu-box"
    assert payload["runners"][0]["connected"] is True
    assert payload["runners"][0]["slots"] == 4
    assert payload["runners"][0]["queued_eligible"] == 1
    assert [engine["name"] for engine in payload["runners"][0]["engines"]] == ["sf-remote"]
    assert payload["local"]["queued"] == 0
    assert payload["queue"]["queued"] == 1


async def test_runners_status_takes_no_arguments_and_mints_nothing(coach: MCPServer) -> None:
    listing = await tools_of(coach)
    tools = {tool.name: tool for tool in listing}
    assert set(tools["runners_status"].input_schema.get("required", ())) == set()
    assert not {name for name in tools if "runner" in name} - {"runners_status"}


# --- live session ----------------------------------------------------------


@pytest.fixture(autouse=True)
def empty_live_board() -> Iterator[None]:
    """The live board is process-wide, so no test inherits the one before it."""
    live_service.clear()
    yield
    live_service.clear()


async def test_show_position_puts_a_fen_on_the_live_board(coach: MCPServer) -> None:
    payload = await call(coach, "show_position", fen=FRENCH)
    assert payload["active"] is True
    assert payload["fen"] == FRENCH
    assert payload["turn"] == "white"
    assert live_service.get_state()["fen"] == FRENCH


async def test_show_game_puts_a_stored_game_on_the_live_board(
    coach: MCPServer, library: dict[str, Game]
) -> None:
    game = library["qg000001"]
    payload = await call(coach, "show_game", game_id=game.id, ply=4)
    assert payload["game_id"] == game.id
    assert payload["ply"] == 4
    assert payload["last_move"] == game.moves_uci[3]


async def test_make_move_advances_the_live_board(coach: MCPServer) -> None:
    await call(coach, "show_position", fen=START_FEN)
    payload = await call(coach, "make_move", uci="e2e4")
    assert payload["last_move"] == "e2e4"
    assert payload["moves"] == ["e2e4"]
    assert payload["turn"] == "black"


async def test_annotate_draws_on_the_live_board(coach: MCPServer) -> None:
    await call(coach, "show_position", fen=START_FEN)
    payload = await call(
        coach, "annotate", arrows=["e2e4", "g1f3:blue"], squares=["d5:red"], text="centre first"
    )
    assert payload["arrows"] == [
        {"from": "e2", "to": "e4", "color": "green"},
        {"from": "g1", "to": "f3", "color": "blue"},
    ]
    assert payload["squares"] == [{"square": "d5", "color": "red"}]
    assert payload["text"] == "centre first"


async def test_get_live_state_reads_the_board_back_with_the_viewer_count(
    coach: MCPServer,
) -> None:
    await call(coach, "show_position", fen=FRENCH)
    live_service.viewer_joined()
    try:
        payload = await call(coach, "get_live_state")
    finally:
        live_service.viewer_left()
    assert payload["fen"] == FRENCH
    assert payload["viewer_count"] == 1


async def test_the_live_board_needs_no_arguments_to_be_read(coach: MCPServer) -> None:
    listing = await tools_of(coach)
    required = {tool.name: set(tool.input_schema.get("required", ())) for tool in listing}
    assert required["get_live_state"] == set()
    assert required["show_game"] == {"game_id"}
    assert required["show_position"] == {"fen"}
    assert required["make_move"] == {"uci"}
    assert required["annotate"] == set()


async def test_a_live_payload_is_one_compact_json_block(coach: MCPServer) -> None:
    result = await invoke(coach, "show_position", {"fen": FRENCH})
    text = text_of(result)
    assert text.startswith("{") and "\n" not in text
    assert ", " not in text and '": ' not in text
    json.loads(text)


async def test_an_illegal_live_move_is_a_structured_error(coach: MCPServer) -> None:
    await call(coach, "show_position", fen=START_FEN)
    payload = await failure(coach, "make_move", uci="e2e5")
    assert payload["error"] == "illegal_move"
    assert live_service.get_state()["fen"] == START_FEN


async def test_moving_before_showing_anything_says_which_tool_to_call(
    coach: MCPServer,
) -> None:
    payload = await failure(coach, "make_move", uci="e2e4")
    assert payload["error"] == "no_live_position"
    assert "show_position" in payload["message"]


async def test_a_live_position_that_is_not_one_is_a_structured_error(coach: MCPServer) -> None:
    payload = await failure(coach, "show_position", fen="not a position")
    assert payload["error"] == "bad_fen"
    assert live_service.get_state()["active"] is False


async def test_showing_a_game_that_is_not_there_is_a_structured_error(coach: MCPServer) -> None:
    payload = await failure(coach, "show_game", game_id=9999)
    assert payload["error"] == "unknown_game"


async def test_a_ply_past_the_end_of_the_game_is_a_structured_error(
    coach: MCPServer, library: dict[str, Game]
) -> None:
    game = library["qg000001"]
    payload = await failure(coach, "show_game", game_id=game.id, ply=game.ply_count + 1)
    assert payload["error"] == "bad_argument"


async def test_a_mark_that_is_not_a_square_is_a_structured_error(coach: MCPServer) -> None:
    await call(coach, "show_position", fen=START_FEN)
    payload = await failure(coach, "annotate", squares=["j9"])
    assert payload["error"] == "bad_argument"


async def test_driving_the_live_board_never_touches_a_stored_game(
    coach: MCPServer, library: dict[str, Game], session: Session
) -> None:
    game = library["qg000001"]
    moves = list(game.moves_uci)
    await call(coach, "show_game", game_id=game.id, ply=0)
    await call(coach, "make_move", uci="a2a3" if moves[0] != "a2a3" else "h2h3")
    session.expire_all()
    stored = session.get(Game, game.id)
    assert stored is not None
    assert stored.moves_uci == moves


async def test_show_positions_pushes_a_batch(coach: MCPServer) -> None:
    payload = await call(coach, "show_positions", positions=[{"fen": START_FEN}, {"fen": FRENCH, "text": "Second"}])
    assert payload["position_count"] == 2
    assert live_service.select_position(1)["text"] == "Second"

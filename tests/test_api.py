"""The HTTP surface, over a seeded database.

Every test drives the real app through `TestClient`: the lifespan migrates, the routers
are the ones `create_app` mounts, and the payloads are whatever the services actually
produced. The only things faked are engine binaries, which are scripted UCI processes.
"""

from __future__ import annotations

import json
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.api.app import create_app
from backend.config import Settings
from backend.db.enums import (
    Classification,
    Color,
    EngineKind,
    Platform,
    RunStatus,
    Tier,
)
from backend.db.migrate import upgrade_to_head
from backend.db.models import Account, AnalysisRun, Engine, Game, MoveEval, Note
from backend.db.session import get_sessionmaker
from backend.db.types import utcnow
from backend.services import import_service
from backend.services import live as live_service
from tests.conftest import running_app, socket_headers
from tests.fake_uci import STOCKFISH_OPTIONS, fake_engine_command

OWNER = "blunderbase"
FRENCH = "rnbqkbnr/pppp1ppp/4p3/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2"
ONE_GAME = """[Event "Casual Blitz game"]
[Site "https://lichess.org/upload01"]
[Date "2026.04.01"]
[White "blunderbase"]
[Black "newcomer"]
[Result "1-0"]
[WhiteElo "1750"]
[BlackElo "1600"]
[TimeControl "300+0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 1-0
"""


@pytest.fixture()
def engine_command(tmp_path: Path) -> str:
    """A scripted UCI process, stored as an `Engine.path` the way a command line is."""
    return fake_engine_command(
        tmp_path,
        name="FakeFish 17",
        options=STOCKFISH_OPTIONS,
        go_default={
            "info": [
                "depth 16 multipv 1 score cp 28 nodes 90210 pv e2e4 d7d5",
                "depth 16 multipv 2 score cp 12 nodes 90210 pv d2d4 d7d5",
            ],
            "bestmove": "e2e4",
        },
    )


@pytest.fixture(autouse=True)
def empty_live_board() -> Iterator[None]:
    """The live board is process-wide state, so no test inherits the one before it."""
    live_service.clear()
    yield
    live_service.clear()


@pytest.fixture()
def seeded(settings: Settings, fixtures_dir: Path, engine_command: str) -> dict[str, int]:
    """Six games, an owner account, an engine and one finished quick run."""
    return _seed(settings, fixtures_dir / "query_games.pgn", engine_command)


@pytest.fixture()
def api(settings: Settings, seeded: dict[str, int]) -> Iterator[TestClient]:
    """The app with the workers off: nothing here is waiting on an engine to answer.

    Signed in, because every route below `/auth` is behind the owner's password now.
    """
    settings.analysis_workers = False
    with running_app(create_app(settings)) as client:
        yield client


def _seed(settings: Settings, pgn: Path, engine_command: str) -> dict[str, int]:
    upgrade_to_head(settings)
    with get_sessionmaker(settings)() as session:
        session.add(Account(platform=Platform.LICHESS, username=OWNER, is_owner=True))
        session.commit()
        import_service.run_import(session, "pgn", path=str(pgn))

        engine = Engine(
            name="FakeFish",
            kind=EngineKind.UCI,
            path=engine_command,
            options={},
            enabled=True,
            default_tier=Tier.QUICK,
        )
        session.add(engine)
        session.commit()

        game_id, run_id, plies = _seed_run(session, engine.id)
        note = Note(text="Berlin endgames need work", tags=["opening", "berlin"], game_id=game_id)
        session.add(note)
        session.commit()
        return {
            "engine_id": engine.id,
            "game_id": game_id,
            "run_id": run_id,
            "note_id": note.id,
            "plies": plies,
        }


def _seed_run(session: Session, engine_id: int) -> tuple[int, int, int]:
    """One done quick run over the owner's oldest game, with a blunder they played."""
    game = session.scalars(
        select(Game).where(Game.owner_color.is_not(None)).order_by(Game.id)
    ).first()
    assert game is not None
    run = AnalysisRun(
        game_id=game.id,
        engine_id=engine_id,
        tier=Tier.QUICK,
        status=RunStatus.DONE,
        nodes=1000,
        multipv=1,
        started_at=utcnow(),
        finished_at=utcnow(),
    )
    session.add(run)
    session.flush()

    positions = {row.ply: row.position_id for row in game.positions}
    owner_is_white = game.owner_color == Color.WHITE
    plies = min(game.ply_count, 12)
    blundered = 6 if owner_is_white else 7
    for ply in range(plies):
        loss = 32.0 if ply == blundered else 1.0
        session.add(
            MoveEval(
                run_id=run.id,
                ply=ply,
                position_id=positions.get(ply),
                move_uci=game.moves_uci[ply],
                move_san=game.moves_san[ply],
                eval_before_cp=20,
                eval_after_cp=-260 if ply == blundered else 15,
                win_before=52.0,
                win_after=52.0 - loss,
                win_loss=loss,
                classification=(
                    Classification.BLUNDER if ply == blundered else Classification.GOOD
                ),
                best_move_uci="e2e4",
                best_lines=[{"multipv": 1, "cp": 20, "mate": None, "pv": ["e2e4"]}],
            )
        )
    session.commit()
    return game.id, run.id, plies


def error_of(response: Any) -> str:
    return response.json()["error"]


# --- the error shape ------------------------------------------------------


def test_an_unknown_route_answers_with_the_typed_error_shape(api: TestClient) -> None:
    response = api.get("/nope")

    assert response.status_code == 404
    assert response.json() == {"error": "not_found", "detail": "Not Found"}


def test_a_body_that_does_not_validate_names_the_field(api: TestClient) -> None:
    response = api.post("/notes", json={"text": ""})

    assert response.status_code == 422
    body = response.json()
    assert body["error"] == "invalid_request"
    assert body["fields"][0]["field"].endswith("text")


def test_an_unknown_field_in_a_body_is_refused_rather_than_ignored(api: TestClient) -> None:
    response = api.post("/notes", json={"text": "hello", "colour": "red"})

    assert response.status_code == 422
    assert error_of(response) == "invalid_request"


def test_a_failure_nobody_anticipated_is_still_not_a_stack_trace(settings: Settings) -> None:
    settings.analysis_workers = False
    app = create_app(settings)

    @app.get("/boom")
    def boom() -> None:
        raise ZeroDivisionError("the queue was empty")

    with running_app(app, raise_server_exceptions=False) as client:
        response = client.get("/boom")

    assert response.status_code == 500
    assert response.json() == {
        "error": "internal_error",
        "detail": "unhandled ZeroDivisionError",
    }


# --- /games ---------------------------------------------------------------


def test_the_games_list_pages_and_counts(api: TestClient) -> None:
    response = api.get("/games", params={"limit": 2})

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 6
    assert len(body["games"]) == 2
    assert body["limit"] == 2 and body["offset"] == 0
    assert body["games"][0]["id"] != body["games"][1]["id"]


def test_the_games_list_takes_the_same_filters_the_stats_do(api: TestClient) -> None:
    wins = api.get("/games", params={"outcome": "win"}).json()
    blunders = api.get("/games", params={"has_blunders": True}).json()

    assert wins["total"] < 6
    assert all(game["outcome"] == "win" for game in wins["games"])
    assert blunders["total"] == 1


def test_a_game_card_carries_the_eval_curve_and_the_worst_moments(
    api: TestClient, seeded: dict[str, int]
) -> None:
    body = api.get("/games", params={"cards": True, "limit": 50}).json()
    card = next(game for game in body["games"] if game["id"] == seeded["game_id"])

    assert card["analyzed"] is True
    assert card["deep"] is False
    assert len(card["eval_curve"]) == seeded["plies"]
    assert card["worst_moments"][0]["classification"] == "blunder"


def test_a_game_detail_merges_the_runs_over_it(api: TestClient, seeded: dict[str, int]) -> None:
    response = api.get(f"/games/{seeded['game_id']}")

    assert response.status_code == 200
    body = response.json()
    assert body["game"]["id"] == seeded["game_id"]
    assert body["moves"][0]["san"]
    assert body["runs"][0]["id"] == seeded["run_id"]
    assert body["notes"][0]["text"] == "Berlin endgames need work"
    assert any(move.get("classification") == "blunder" for move in body["moves"])


def test_a_game_detail_can_be_narrowed_to_a_ply_window(
    api: TestClient, seeded: dict[str, int]
) -> None:
    body = api.get(
        f"/games/{seeded['game_id']}", params={"ply_start": 2, "ply_end": 5}
    ).json()

    assert [move["ply"] for move in body["moves"]] == [2, 3, 4, 5]
    assert body["ply_range"] == [2, 5]


def test_half_a_ply_window_is_a_typed_refusal(api: TestClient, seeded: dict[str, int]) -> None:
    response = api.get(f"/games/{seeded['game_id']}", params={"ply_start": 2})

    assert response.status_code == 422
    assert error_of(response) == "invalid_request"


def test_a_game_that_is_not_there_is_a_typed_404(api: TestClient) -> None:
    response = api.get("/games/9999")

    assert response.status_code == 404
    assert response.json() == {"error": "unknown_game", "detail": "no game with id 9999"}


# --- /accounts ------------------------------------------------------------


@pytest.fixture()
def unattributed(settings: Settings, fixtures_dir: Path) -> Iterator[TestClient]:
    """A library imported before any account named its owner — the production bug.

    Every game names `blunderbase` as a player and not one of them knows it: no account
    row existed while they were being stored, so `owner_color` was never decided.
    """
    settings.analysis_workers = False
    upgrade_to_head(settings)
    with get_sessionmaker(settings)() as session:
        import_service.run_import(session, "pgn", path=str(fixtures_dir / "query_games.pgn"))
    with running_app(create_app(settings)) as client:
        yield client


def test_the_accounts_list_carries_the_games_each_one_is_a_player_in(
    api: TestClient,
) -> None:
    response = api.get("/accounts")

    assert response.status_code == 200
    account = response.json()[0]
    assert account["platform"] == "lichess"
    assert account["username"] == OWNER
    assert account["is_owner"] is True
    assert account["games"] == 6


def test_registering_an_account_claims_the_games_that_were_already_stored(
    unattributed: TestClient,
) -> None:
    """The repair, over HTTP: six games that showed no opponent and no rating."""
    before = unattributed.get("/games", params={"limit": 50}).json()["games"]
    assert all(game["color"] is None and game["opponent"] is None for game in before)

    response = unattributed.post("/accounts", json={"platform": "lichess", "username": OWNER})

    assert response.status_code == 200
    body = response.json()
    assert body["account"]["username"] == OWNER
    assert body["account"]["games"] == 6
    assert body["reconciled"] == {"linked": 6, "colored": 6, "unclaimed": 0}
    after = unattributed.get("/games", params={"limit": 50}).json()["games"]
    assert all(game["opponent"] and game["rating"] for game in after)


def test_registering_the_same_account_again_repairs_nothing_and_adds_no_row(
    unattributed: TestClient,
) -> None:
    unattributed.post("/accounts", json={"platform": "lichess", "username": OWNER})

    again = unattributed.post("/accounts", json={"platform": "lichess", "username": "BLUNDERBASE"})

    assert again.json()["reconciled"] == {"linked": 0, "colored": 0, "unclaimed": 0}
    assert len(unattributed.get("/accounts").json()) == 1


def test_reconcile_repairs_a_library_whose_account_was_never_applied(
    settings: Settings, unattributed: TestClient
) -> None:
    with get_sessionmaker(settings)() as session:
        session.add(Account(platform=Platform.LICHESS, username=OWNER, is_owner=True))
        session.commit()

    response = unattributed.post("/accounts/reconcile")

    assert response.status_code == 200
    assert response.json() == {"linked": 6, "colored": 6, "unclaimed": 0}
    assert unattributed.post("/accounts/reconcile").json() == {
        "linked": 0,
        "colored": 0,
        "unclaimed": 0,
    }


def test_a_platform_nobody_plays_on_is_a_422(api: TestClient) -> None:
    response = api.post("/accounts", json={"platform": "telepathy", "username": OWNER})

    assert response.status_code == 422
    assert error_of(response) == "invalid_request"
    assert response.json()["fields"][0]["field"].endswith("platform")


def test_the_accounts_routes_are_behind_the_owners_password(
    settings: Settings, seeded: dict[str, int]
) -> None:
    settings.analysis_workers = False
    with running_app(create_app(settings), password=None) as stranger:
        assert stranger.get("/accounts").status_code == 401
        assert (
            stranger.post("/accounts", json={"platform": "lichess", "username": OWNER}).status_code
            == 401
        )
        assert stranger.post("/accounts/reconcile").status_code == 401


# --- /import --------------------------------------------------------------


def test_a_pgn_can_be_imported_inline_and_answers_with_the_finished_job(
    api: TestClient,
) -> None:
    response = api.post("/import/pgn", json={"text": ONE_GAME, "wait": True})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "done"
    assert body["job"]["games_imported"] == 1
    assert body["job"]["games_failed"] == 0
    assert api.get("/games", params={"text": "newcomer"}).json()["total"] == 1


def test_a_pgn_file_can_be_uploaded_as_the_request_body(api: TestClient) -> None:
    response = api.post(
        "/import/pgn/upload?wait=true",
        content=ONE_GAME.encode("utf-8"),
        headers={"content-type": "application/x-chess-pgn"},
    )

    assert response.status_code == 200
    assert response.json()["job"]["games_imported"] == 1


def test_an_empty_upload_is_refused_before_a_job_row_is_written(api: TestClient) -> None:
    before = len(api.get("/import/jobs").json())
    response = api.post("/import/pgn/upload", content=b"   ")

    assert response.status_code == 422
    assert error_of(response) == "empty_upload"
    assert len(api.get("/import/jobs").json()) == before


def test_an_unknown_source_is_a_typed_404(api: TestClient) -> None:
    response = api.post("/import/bughouse", json={})

    assert response.status_code == 404
    assert error_of(response) == "unknown_source"


def test_the_sync_history_lists_the_jobs_newest_first(api: TestClient) -> None:
    api.post("/import/pgn", json={"text": ONE_GAME, "wait": True})
    jobs = api.get("/import/jobs", params={"source": "pgn"}).json()

    assert [job["source"] for job in jobs] == ["pgn", "pgn"]
    assert jobs[0]["id"] > jobs[1]["id"]
    assert api.get(f"/import/jobs/{jobs[0]['id']}").json()["games_seen"] == 1


def test_an_import_job_that_is_not_there_is_a_typed_404(api: TestClient) -> None:
    response = api.get("/import/jobs/9999")

    assert response.status_code == 404
    assert error_of(response) == "unknown_job"


def test_a_failed_adapter_is_reported_on_the_job_rather_than_as_a_500(
    api: TestClient,
) -> None:
    """A sync that could not run is history, not a crash: the job row says what happened."""
    response = api.post("/import/pgn", json={"path": "/no/such/file.pgn", "wait": True})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "failed"
    assert "no such PGN file" in body["job"]["message"]


# --- /analysis ------------------------------------------------------------


def test_a_run_can_be_enqueued_for_a_game(api: TestClient, seeded: dict[str, int]) -> None:
    response = api.post(
        "/analysis", json={"game_id": seeded["game_id"], "tier": "deep", "multipv": 3}
    )

    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "queued"
    assert body["tier"] == "deep"
    assert body["multipv"] == 3
    assert body["engine_id"] == seeded["engine_id"]
    queue = api.get("/analysis/queue").json()
    assert (queue["queued"], queue["running"], queue["workers"], queue["busy"]) == (1, 0, False, 0)
    # With no runners registered there is one destination, and it is this machine.
    assert [row["name"] for row in queue["destinations"]] == ["local"]
    assert queue["destinations"][0]["queued"] == 1


def test_a_run_over_a_position_takes_no_ply_range(api: TestClient) -> None:
    response = api.post("/analysis", json={"fen": FRENCH, "ply_start": 0, "ply_end": 4})

    assert response.status_code == 422
    assert error_of(response) == "invalid_request"


def test_enqueueing_for_a_game_that_is_not_there_is_a_typed_refusal(api: TestClient) -> None:
    response = api.post("/analysis", json={"game_id": 9999})

    assert response.status_code == 422
    assert response.json()["detail"] == "no game with id 9999"


def test_a_tier_with_no_usable_engine_is_a_typed_conflict(
    api: TestClient, seeded: dict[str, int]
) -> None:
    api.patch(f"/engines/{seeded['engine_id']}", json={"enabled": False})

    response = api.post("/analysis", json={"game_id": seeded["game_id"]})

    assert response.status_code == 409
    assert error_of(response) == "tier_unavailable"


def test_the_runs_of_one_game_are_listed_newest_first(
    api: TestClient, seeded: dict[str, int]
) -> None:
    api.post("/analysis", json={"game_id": seeded["game_id"], "tier": "deep"})
    runs = api.get("/analysis/runs", params={"game_id": seeded["game_id"]}).json()

    assert [run["tier"] for run in runs] == ["deep", "quick"]
    assert api.get(
        "/analysis/runs", params={"game_id": seeded["game_id"], "tier": "quick"}
    ).json() == [runs[1]]


def test_one_run_reports_its_status_and_its_evals(
    api: TestClient, seeded: dict[str, int]
) -> None:
    run = api.get(f"/analysis/runs/{seeded['run_id']}").json()
    evals = api.get(f"/analysis/runs/{seeded['run_id']}/evals").json()

    assert run["status"] == "done"
    assert run["game_id"] == seeded["game_id"]
    assert [row["ply"] for row in evals] == list(range(seeded["plies"]))
    assert evals[6]["best_lines"] == [{"multipv": 1, "cp": 20, "mate": None, "pv": ["e2e4"]}]


def test_a_runs_evals_can_be_narrowed_to_a_half_open_window(
    api: TestClient, seeded: dict[str, int]
) -> None:
    evals = api.get(
        f"/analysis/runs/{seeded['run_id']}/evals", params={"ply_start": 2, "ply_end": 5}
    ).json()

    assert [row["ply"] for row in evals] == [2, 3, 4]


def test_a_run_that_is_not_there_is_a_typed_404(api: TestClient) -> None:
    response = api.get("/analysis/runs/9999")

    assert response.status_code == 404
    assert error_of(response) == "unknown_run"
    assert api.get("/analysis/runs/9999/evals").status_code == 404


def test_the_workers_pick_up_what_the_api_enqueues(
    settings: Settings, seeded: dict[str, int], tmp_path: Path
) -> None:
    """End to end: the lifespan's workers drain a run the API queued, over a real process."""
    neutral = fake_engine_command(
        tmp_path,
        name="Neutral Fish",
        options=STOCKFISH_OPTIONS,
        # One reply that is legal in every position, since this run replays a whole game.
        go_default={"info": ["depth 8 score cp 20 nodes 100"], "bestmove": "(none)"},
    )
    settings.analysis_workers = True
    with running_app(create_app(settings)) as client:
        engine = client.post("/engines", json={"name": "Neutral Fish", "path": neutral}).json()
        queued = client.post(
            "/analysis",
            json={
                "game_id": seeded["game_id"],
                "tier": "deep",
                "nodes": 1000,
                "engine_id": engine["id"],
            },
        ).json()
        run = _await_run(client, queued["id"])
        evals = client.get(f"/analysis/runs/{run['id']}/evals").json()

    assert run["status"] == "done", run["error"]
    assert evals
    assert all(row["eval_after_cp"] is not None for row in evals)


def _await_run(client: TestClient, run_id: int, timeout: float = 30.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run = client.get(f"/analysis/runs/{run_id}").json()
        if run["status"] in {"done", "failed"}:
            return run
        time.sleep(0.05)
    raise AssertionError(f"run {run_id} never finished")


def test_a_position_can_be_evaluated_synchronously(api: TestClient) -> None:
    response = api.post("/analysis/position", json={"fen": FRENCH, "nodes": 1000})

    assert response.status_code == 200
    body = response.json()
    assert body["cp"] == 28
    assert body["best_move"] == {"uci": "e2e4", "san": "e4"}
    assert body["engine_name"] == "FakeFish"


def test_a_position_that_is_not_a_position_is_a_typed_refusal(api: TestClient) -> None:
    response = api.post("/analysis/position", json={"fen": "not a fen"})

    assert response.status_code == 422
    assert error_of(response) == "invalid_request"


# --- /explorer ------------------------------------------------------------


def test_the_explorer_answers_from_the_initial_array(api: TestClient) -> None:
    body = api.get("/explorer").json()

    assert body["side_to_move"] == "white"
    assert body["totals"]["games"] == 6
    assert body["moves"][0]["uci"] == "e2e4"
    assert body["main_line"]


def test_the_explorer_can_be_entered_by_eco(api: TestClient) -> None:
    body = api.get("/explorer", params={"eco": "C6"}).json()

    assert body["eco"] == "C6"
    assert body["totals"]["games"] == 2


def test_the_explorer_refuses_a_fen_that_is_not_one(api: TestClient) -> None:
    response = api.get("/explorer", params={"fen": "not a fen"})

    assert response.status_code == 422
    assert error_of(response) == "invalid_request"


def test_the_games_that_reached_a_position_come_back_with_their_outcomes(
    api: TestClient,
) -> None:
    rows = api.get("/explorer/positions", params={"fen": FRENCH.replace("- 0 2", "-")}).json()

    assert rows == [] or all("game" in row for row in rows)
    start = api.get(
        "/explorer/positions",
        params={"fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"},
    ).json()
    assert len(start) == 6
    assert start[0]["ply"] == 0
    assert start[0]["game"]["id"]


# --- /stats ---------------------------------------------------------------


def test_the_dimensions_say_what_works_and_what_is_only_planned(api: TestClient) -> None:
    body = api.get("/stats/dimensions").json()

    assert "blunders_by_phase" in body["dimensions"]
    assert body["planned"] == ["blunders_by_motif"]


def test_one_dimension_aggregates_over_the_filtered_games(api: TestClient) -> None:
    body = api.get("/stats/blunders_by_phase").json()

    assert body["dimension"] == "blunders_by_phase"
    assert body["total"]["blunder"] == 1
    assert sum(bucket["blunder"] for bucket in body["buckets"]) == 1
    assert api.get("/stats/blunders_by_phase", params={"since": "2030-01-01T00:00:00Z"}).json()[
        "total"
    ]["blunder"] == 0


def test_a_dimension_that_is_only_planned_says_so_rather_than_pretending(
    api: TestClient,
) -> None:
    response = api.get("/stats/blunders_by_motif")

    assert response.status_code == 422
    assert error_of(response) == "unknown_dimension"
    assert "not implemented yet" in response.json()["detail"]


def test_two_periods_can_be_compared(api: TestClient) -> None:
    body = api.get(
        "/stats/compare",
        params={
            "dimension": "performance_by_speed",
            "then_start": "2026-01-01T00:00:00Z",
            "then_end": "2026-02-01T00:00:00Z",
            "now_start": "2026-02-01T00:00:00Z",
            "now_end": "2026-04-01T00:00:00Z",
        },
    ).json()

    assert body["dimension"] == "performance_by_speed"
    assert body["then"]["dimension"] == "performance_by_speed"
    assert "delta" in body


def test_the_profile_carries_the_owners_accounts_and_volume(api: TestClient) -> None:
    body = api.get("/stats/profile").json()

    assert [account["username"] for account in body["accounts"]] == [OWNER]
    assert body["volume"]["games"] == 6


def test_the_worst_recent_moments_rank_by_what_was_given_away(api: TestClient) -> None:
    moments = api.get("/stats/worst-moments", params={"amount": 3}).json()

    assert len(moments) == 1
    assert moments[0]["classification"] == "blunder"
    assert moments[0]["win_loss"] == 32.0
    assert moments[0]["phase"] in {"opening", "middlegame", "endgame"}


# --- /engines -------------------------------------------------------------


def test_an_engine_is_probed_before_it_is_registered(
    api: TestClient, engine_command: str
) -> None:
    response = api.post(
        "/engines",
        json={
            "name": "Second Fish",
            "path": engine_command,
            "options": {"Threads": 2},
            "default_tier": "deep",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["version"] == "FakeFish 17"
    assert body["options"] == {"Threads": 2}
    assert len(api.get("/engines").json()) == 2


def test_a_binary_that_is_not_an_engine_is_refused_at_setup_time(api: TestClient) -> None:
    response = api.post("/engines", json={"name": "Broken", "path": "/no/such/engine"})

    assert response.status_code == 422
    assert error_of(response) == "engine_probe_failed"
    assert len(api.get("/engines").json()) == 1


def test_a_name_that_is_taken_is_a_typed_conflict(
    api: TestClient, engine_command: str
) -> None:
    response = api.post("/engines", json={"name": "FakeFish", "path": engine_command})

    assert response.status_code == 409
    assert error_of(response) == "duplicate_engine"


def test_an_option_the_engine_does_not_declare_is_a_typed_refusal(
    api: TestClient, engine_command: str
) -> None:
    response = api.post(
        "/engines", json={"name": "Third Fish", "path": engine_command, "options": {"Vibes": 3}}
    )

    assert response.status_code == 422
    assert error_of(response) == "invalid_engine_option"


def test_an_engine_can_be_renamed_and_disabled_without_touching_its_binary(
    api: TestClient, seeded: dict[str, int]
) -> None:
    response = api.patch(
        f"/engines/{seeded['engine_id']}", json={"name": "Retired Fish", "enabled": False}
    )

    assert response.status_code == 200
    assert response.json() == {**api.get(f"/engines/{seeded['engine_id']}").json()}
    assert response.json()["name"] == "Retired Fish"
    assert response.json()["enabled"] is False


def test_probing_a_binary_stores_nothing(api: TestClient, engine_command: str) -> None:
    body = api.post("/engines/probe", json={"path": engine_command}).json()

    assert body["name"] == "FakeFish 17"
    assert {option["name"] for option in body["options"]} >= {"Threads", "Hash"}
    assert len(api.get("/engines").json()) == 1


def test_the_tiers_say_which_engine_answers_for_them(api: TestClient) -> None:
    tiers = api.get("/engines/tiers").json()

    assert [tier["tier"] for tier in tiers] == ["quick", "deep"]
    assert all(tier["available"] for tier in tiers)
    assert tiers[0]["engine_name"] == "FakeFish"


def test_a_test_run_shows_what_the_engine_says_about_one_position(
    api: TestClient, seeded: dict[str, int]
) -> None:
    response = api.post(
        f"/engines/{seeded['engine_id']}/test-run", json={"fen": FRENCH, "nodes": 1000}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["cp"] == 28
    assert body["best_move"] == {"uci": "e2e4", "san": "e4"}
    assert body["elapsed_ms"] >= 0


def test_an_engine_can_be_removed(api: TestClient, seeded: dict[str, int]) -> None:
    response = api.delete(f"/engines/{seeded['engine_id']}")

    assert response.status_code == 200
    assert response.json() == {"unqueued": 0}
    assert api.get("/engines").json() == []
    assert api.delete(f"/engines/{seeded['engine_id']}").status_code == 404


def test_removing_an_engine_unqueues_its_pending_runs_but_keeps_the_rest(
    settings: Settings, api: TestClient, seeded: dict[str, int]
) -> None:
    """`seeded` already has one done run with move evals; add a queued one alongside it."""
    with get_sessionmaker(settings)() as session:
        queued = AnalysisRun(
            tier=Tier.QUICK, engine_id=seeded["engine_id"], status=RunStatus.QUEUED
        )
        session.add(queued)
        session.commit()
        queued_id = queued.id

    response = api.delete(f"/engines/{seeded['engine_id']}")

    assert response.status_code == 200
    assert response.json() == {"unqueued": 1}

    with get_sessionmaker(settings)() as session:
        assert session.get(AnalysisRun, queued_id) is None
        done_run = session.get(AnalysisRun, seeded["run_id"])
        assert done_run is not None
        assert done_run.engine_id is None
        evals = session.scalars(select(MoveEval).where(MoveEval.run_id == done_run.id)).all()
        assert len(evals) == seeded["plies"]


def test_an_engine_that_is_not_there_is_a_typed_404(api: TestClient) -> None:
    response = api.get("/engines/9999")

    assert response.status_code == 404
    assert error_of(response) == "unknown_engine"


# --- /notes ---------------------------------------------------------------


def test_a_note_can_be_written_and_read_back(api: TestClient, seeded: dict[str, int]) -> None:
    response = api.post(
        "/notes",
        json={
            "text": "  push the d pawn  ",
            "tags": ["plan", "plan"],
            "game_id": seeded["game_id"],
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["text"] == "push the d pawn"
    assert body["tags"] == ["plan"]
    assert api.get(f"/notes/{body['id']}").json() == body


def test_a_note_can_be_anchored_to_a_position(api: TestClient) -> None:
    body = api.post("/notes", json={"text": "the Berlin again", "fen": FRENCH}).json()

    assert body["position_id"] is not None
    found = api.get("/notes", params={"fen": FRENCH}).json()
    assert [note["id"] for note in found] == [body["id"]]


def test_notes_are_searched_by_text_and_by_tag(api: TestClient, seeded: dict[str, int]) -> None:
    api.post("/notes", json={"text": "time trouble again", "tags": ["clock"]})

    assert [note["id"] for note in api.get("/notes", params={"query": "endgames"}).json()] == [
        seeded["note_id"]
    ]
    assert api.get("/notes", params={"tags": ["clock"]}).json()[0]["text"] == (
        "time trouble again"
    )
    assert api.get("/notes", params={"tags": ["clock", "berlin"]}).json() == []


def test_the_tags_in_use_come_back_with_their_counts(api: TestClient) -> None:
    api.post("/notes", json={"text": "another one", "tags": ["berlin"]})

    assert api.get("/notes/tags").json() == [
        {"tag": "berlin", "notes": 2},
        {"tag": "opening", "notes": 1},
    ]


def test_a_note_can_be_rewritten_and_forgotten(api: TestClient, seeded: dict[str, int]) -> None:
    updated = api.patch(f"/notes/{seeded['note_id']}", json={"text": "solved"}).json()

    assert updated["text"] == "solved"
    assert updated["tags"] == ["opening", "berlin"]
    assert api.delete(f"/notes/{seeded['note_id']}").status_code == 204
    assert api.get(f"/notes/{seeded['note_id']}").status_code == 404


def test_a_note_that_is_not_there_is_a_typed_404(api: TestClient) -> None:
    assert error_of(api.get("/notes/9999")) == "unknown_note"
    assert error_of(api.patch("/notes/9999", json={"text": "x"})) == "unknown_note"
    assert error_of(api.delete("/notes/9999")) == "unknown_note"


# --- /events --------------------------------------------------------------


def test_the_events_socket_sees_an_import_from_start_to_finish(api: TestClient) -> None:
    with api.websocket_connect("/events", headers=socket_headers(api)) as socket:
        started = api.post("/import/pgn", json={"text": ONE_GAME})
        assert started.status_code == 202
        job_id = started.json()["job_id"]

        events = _drain(socket, "import.finished")

    progress = [event for event in events if event["event"].startswith("import.")]
    assert [event["event"] for event in progress] == [
        "import.started",
        "import.game",
        "import.finished",
    ]
    assert {event["job_id"] for event in progress} == {job_id}
    assert progress[1]["status"] == "imported"
    assert progress[2]["imported"] == 1
    # The import's own automatic quick pass reaches the same socket.
    assert any(event["event"] == "analysis.queued" for event in events)


def test_the_events_socket_sees_a_run_being_queued(
    api: TestClient, seeded: dict[str, int]
) -> None:
    with api.websocket_connect("/events", headers=socket_headers(api)) as socket:
        run = api.post("/analysis", json={"game_id": seeded["game_id"], "tier": "deep"}).json()
        event = _drain(socket, "analysis.queued")[-1]

    assert event["run_id"] == run["id"]
    assert event["game_id"] == seeded["game_id"]
    assert event["tier"] == "deep"


def test_the_events_socket_sees_a_note_being_written(api: TestClient) -> None:
    """A note the coach saves over MCP has to reach the open UI without a refresh."""
    with api.websocket_connect("/events", headers=socket_headers(api)) as socket:
        written = api.post("/notes", json={"text": "watch the c-file", "tags": ["plan"]}).json()
        event = _drain(socket, "note.created")[-1]

    assert event["note_id"] == written["id"]
    assert event["text"] == "watch the c-file"
    assert event["tags"] == ["plan"]


def test_the_events_socket_sees_the_live_board_move(api: TestClient) -> None:
    with api.websocket_connect("/events", headers=socket_headers(api)) as socket:
        live_service.show_position(FRENCH)
        event = _drain(socket, "live.updated")[-1]

    assert event["fen"] == FRENCH
    assert event["active"] is True
    # The whole state, so a page that has the socket never needs to fetch /live again.
    assert event["viewer_count"] == 1


# --- /live -----------------------------------------------------------------


def test_the_live_route_answers_an_empty_board(api: TestClient) -> None:
    state = api.get("/live").json()
    assert state["active"] is False
    assert state["fen"] is None
    assert state["viewer_count"] == 0


def test_the_live_route_reflects_what_the_coach_showed(api: TestClient) -> None:
    live_service.show_position(FRENCH)
    live_service.annotate(arrows=["e2e4:blue"], squares=["d5"], text="strike the centre")

    state = api.get("/live").json()
    assert state["active"] is True
    assert state["fen"] == FRENCH
    assert state["turn"] == "white"
    assert state["arrows"] == [{"from": "e2", "to": "e4", "color": "blue"}]
    assert state["squares"] == [{"square": "d5", "color": "yellow"}]
    assert state["text"] == "strike the centre"
    assert state["updated_at"]


def test_the_live_route_counts_the_sockets_that_are_watching(api: TestClient) -> None:
    live_service.show_position(FRENCH)
    assert api.get("/live").json()["viewer_count"] == 0
    with api.websocket_connect("/events", headers=socket_headers(api)):
        assert api.get("/live").json()["viewer_count"] == 1
    assert api.get("/live").json()["viewer_count"] == 0


def _drain(socket: Any, until: str, limit: int = 20) -> list[dict[str, Any]]:
    """Read frames until the one that was waited for, ignoring keep-alives."""
    events: list[dict[str, Any]] = []
    for _ in range(limit):
        frame = json.loads(socket.receive_text())
        if frame.get("event") == "ping":
            continue
        events.append(frame)
        if frame["event"] == until:
            return events
    raise AssertionError(f"never saw {until}: {events}")

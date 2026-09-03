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
from backend.config import MAIA_MAX_RATING, Settings
from backend.db.enums import (
    Classification,
    Color,
    EngineKind,
    JobStatus,
    Platform,
    RunStatus,
    Source,
    Tier,
)
from backend.db.migrate import head_revision, upgrade_to_head
from backend.db.models import (
    Account,
    AnalysisRun,
    Engine,
    Game,
    GamePosition,
    ImportJob,
    MoveEval,
    Note,
)
from backend.db.session import get_sessionmaker
from backend.db.types import utcnow
from backend.services import backups as backups_service
from backend.services import engines as engines_service
from backend.services import import_service
from backend.services import live as live_service
from tests.conftest import OWNER_PASSWORD, running_app, socket_headers
from tests.fake_uci import STOCKFISH_OPTIONS, fake_engine_command

OWNER = "blunderbase"
FRENCH = "rnbqkbnr/pppp1ppp/4p3/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2"
START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
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
# A game with no owner in it, for the uploads that say whose games a file holds: neither
# name resolves to an account, so the answer given is the only thing deciding.
STRANGERS_GAME = """[Event "Leipzig"]
[Date "1894.01.02"]
[White "Tarrasch"]
[Black "Lasker"]
[Result "0-1"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 0-1
"""
# Two more against the one opponent the fixture only has a single game with, so the
# search box has an opponent worth grouping: with the fixture's loss that is 1½/3.
TWO_MORE_BERLINS = """[Event "Rated Blitz game"]
[Site "https://lichess.org/qg000007"]
[Date "2026.04.02"]
[White "blunderbase"]
[Black "berlinwall"]
[Result "1-0"]
[ECO "C65"]
[Opening "Ruy Lopez: Berlin Defense"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. O-O Nxe4 1-0

[Event "Rated Blitz game"]
[Site "https://lichess.org/qg000008"]
[Date "2026.04.03"]
[White "berlinwall"]
[Black "blunderbase"]
[Result "1/2-1/2"]
[ECO "C65"]
[Opening "Ruy Lopez: Berlin Defense"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. d3 Bc5 1/2-1/2
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
        )
        session.add(engine)
        session.commit()
        engines_service.assign_default_roles(session, engine)

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


# --- /games/delete --------------------------------------------------------


def test_deleting_a_selection_takes_those_games_and_says_what_went(api: TestClient) -> None:
    ids = [game["id"] for game in api.get("/games").json()["games"][:2]]

    response = api.post("/games/delete", json={"game_ids": ids})

    assert response.status_code == 200
    assert response.json()["games"] == 2
    assert api.get("/games").json()["total"] == 4
    assert api.get(f"/games/{ids[0]}").status_code == 404


def test_deleting_the_analysed_game_takes_its_run_and_its_note(
    api: TestClient, seeded: dict[str, int]
) -> None:
    response = api.post("/games/delete", json={"game_ids": [seeded["game_id"]]})

    assert response.json() == {
        "games": 1,
        "runs": 1,
        "notes": 1,
        "lines": 0,
        "remembered": 1,
    }
    assert api.get("/notes").json() == []
    assert api.get(f"/analysis/runs/{seeded['run_id']}").status_code == 404


def test_deleting_no_games_is_a_refused_request(api: TestClient) -> None:
    """An empty selection is a client bug; the wipe is a route of its own."""
    response = api.post("/games/delete", json={"game_ids": []})

    assert response.status_code == 422
    assert api.get("/games").json()["total"] == 6


def test_a_delete_needs_no_password_but_leaves_the_rest_of_the_library(
    api: TestClient, seeded: dict[str, int]
) -> None:
    before = api.get("/games").json()["games"]

    api.post("/games/delete", json={"game_ids": [before[-1]["id"]]})

    assert [game["id"] for game in api.get("/games").json()["games"]] == [
        game["id"] for game in before[:-1]
    ]


# --- /library/deleted-games -----------------------------------------------


def test_a_deleted_game_is_listed_so_the_owner_can_see_what_will_not_come_back(
    api: TestClient, seeded: dict[str, int]
) -> None:
    api.post("/games/delete", json={"game_ids": [seeded["game_id"]]})

    body = api.get("/library/deleted-games").json()

    assert body["total"] == 1
    row = body["games"][0]
    assert row["source"] == "pgn"
    assert row["white_name"] and row["black_name"]
    assert row["deleted_at"]


def test_forgetting_one_deletion_takes_it_off_the_list(
    api: TestClient, seeded: dict[str, int]
) -> None:
    api.post("/games/delete", json={"game_ids": [seeded["game_id"]]})
    listed = api.get("/library/deleted-games").json()["games"]

    response = api.post("/library/deleted-games/forget", json={"ids": [listed[0]["id"]]})

    assert response.status_code == 200
    assert response.json() == {"forgotten": 1}
    assert api.get("/library/deleted-games").json()["total"] == 0
    # Forgetting brings nothing back by itself — the next import is what does that.
    assert api.get("/games").json()["total"] == 5


def test_forgetting_without_ids_clears_the_whole_list(api: TestClient) -> None:
    ids = [game["id"] for game in api.get("/games").json()["games"][:2]]
    api.post("/games/delete", json={"game_ids": ids})

    assert api.post("/library/deleted-games/forget", json={}).json() == {"forgotten": 2}
    assert api.get("/library/deleted-games").json()["total"] == 0


def test_a_wipe_lists_no_deletions(api: TestClient) -> None:
    api.post("/games/delete-all", json={"password": OWNER_PASSWORD})

    assert api.get("/library/deleted-games").json()["total"] == 0


# --- /games?order ---------------------------------------------------------


def test_the_games_page_is_ordered_by_the_column_that_was_asked_for(api: TestClient) -> None:
    ascending = api.get("/games", params={"order": "opponent", "direction": "asc"}).json()
    descending = api.get("/games", params={"order": "opponent", "direction": "desc"}).json()

    names = [game["opponent"] for game in ascending["games"]]
    assert names == sorted(names)
    assert [game["id"] for game in descending["games"]] == [
        game["id"] for game in reversed(ascending["games"])
    ]


def test_an_order_the_backend_does_not_have_is_a_typed_refusal(api: TestClient) -> None:
    response = api.get("/games", params={"order": "favourite"})

    assert response.status_code == 422
    assert error_of(response) == "invalid_request"


# --- /games/delete-all ----------------------------------------------------


def test_a_wipe_without_the_password_takes_nothing(api: TestClient) -> None:
    """Being signed in is not consent: the password is asked for again, and refused."""
    response = api.post("/games/delete-all", json={"password": "not-the-one"})

    assert response.status_code == 401
    assert error_of(response) == "invalid_password"
    assert api.get("/games").json()["total"] == 6


def test_a_server_wipe_with_no_password_takes_nothing(api: TestClient) -> None:
    response = api.post("/games/delete-all", json={})

    assert response.status_code == 401
    assert error_of(response) == "invalid_password"
    assert api.get("/games").json()["total"] == 6


def test_the_owners_password_empties_the_library_and_says_what_it_took(
    settings: Settings, api: TestClient
) -> None:
    position_note = api.post("/notes", json={"text": "the French again", "fen": FRENCH}).json()

    response = api.post("/games/delete-all", json={"password": OWNER_PASSWORD})

    assert response.status_code == 200
    assert response.json() == {"games": 6, "runs": 1, "notes": 1, "import_jobs": 1}
    assert api.get("/games").json()["total"] == 0
    # A note about a position is memory about chess, not about a game that is gone.
    assert [note["id"] for note in api.get("/notes").json()] == [position_note["id"]]
    # Configuration is not library.
    assert len(api.get("/accounts").json()) == 1
    assert len(api.get("/engines").json()) == 1

    with get_sessionmaker(settings)() as session:
        assert session.scalars(select(Game)).all() == []
        assert session.scalars(select(GamePosition)).all() == []
        assert session.scalars(select(AnalysisRun)).all() == []
        assert session.scalars(select(MoveEval)).all() == []
        assert session.scalars(select(ImportJob)).all() == []
        assert [note.id for note in session.scalars(select(Note))] == [position_note["id"]]


def test_a_wipe_takes_the_queued_runs_with_it_but_leaves_a_position_run(
    settings: Settings, api: TestClient, seeded: dict[str, int]
) -> None:
    """A worker must not be left holding work over a game nobody has any more."""
    with get_sessionmaker(settings)() as session:
        over_the_game = AnalysisRun(
            game_id=seeded["game_id"],
            engine_id=seeded["engine_id"],
            tier=Tier.QUICK,
            status=RunStatus.QUEUED,
        )
        over_a_fen = AnalysisRun(
            fen=FRENCH, engine_id=seeded["engine_id"], tier=Tier.QUICK, status=RunStatus.QUEUED
        )
        session.add_all([over_the_game, over_a_fen])
        session.commit()
        standalone_id = over_a_fen.id

    response = api.post("/games/delete-all", json={"password": OWNER_PASSWORD})

    assert response.status_code == 200
    assert response.json()["runs"] == 2
    with get_sessionmaker(settings)() as session:
        assert [run.id for run in session.scalars(select(AnalysisRun))] == [standalone_id]


def test_a_wipe_drops_the_sync_history_so_the_next_sync_starts_over(
    settings: Settings, api: TestClient
) -> None:
    """The cursor lives on the import jobs, so keeping them would import nothing."""
    with get_sessionmaker(settings)() as session:
        session.add(
            ImportJob(source=Source.LICHESS, status=JobStatus.DONE, cursor="1712000000000")
        )
        session.commit()
        assert import_service.latest_cursor(session, "lichess") == "1712000000000"

    assert api.post("/games/delete-all", json={"password": OWNER_PASSWORD}).status_code == 200

    with get_sessionmaker(settings)() as session:
        assert import_service.latest_cursor(session, "lichess") is None


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
    # Nothing said about evaluation, so the game landed queued for its quick pass.
    assert api.get("/analysis/queue").json()["queued"] == 1


def test_an_import_can_land_its_games_without_queueing_a_pass(api: TestClient) -> None:
    """Skip evaluation, as the import page offers it: the games arrive, the queue stays
    where it was, and the passes are asked for later over the games worth looking at."""
    response = api.post("/import/pgn", json={"text": ONE_GAME, "wait": True, "analyze": False})

    assert response.status_code == 200
    assert response.json()["job"]["games_imported"] == 1
    assert api.get("/games", params={"text": "newcomer"}).json()["total"] == 1
    assert api.get("/analysis/queue").json()["queued"] == 0


def test_an_upload_can_skip_evaluation_too(api: TestClient) -> None:
    response = api.post(
        "/import/pgn/upload?wait=true&analyze=false",
        content=ONE_GAME.encode("utf-8"),
        headers={"content-type": "application/x-chess-pgn"},
    )

    assert response.status_code == 200
    assert response.json()["job"]["games_imported"] == 1
    assert api.get("/analysis/queue").json()["queued"] == 0


def test_an_upload_can_say_the_games_are_not_the_owners(api: TestClient) -> None:
    """The one question a file cannot answer for itself. `mine=false` stores the games for
    study — analysable and annotatable — outside every statistic the owner's games feed."""
    response = api.post(
        "/import/pgn/upload?wait=true&mine=false",
        content=STRANGERS_GAME.encode("utf-8"),
        headers={"content-type": "application/x-chess-pgn"},
    )

    assert response.status_code == 200
    assert response.json()["job"]["games_imported"] == 1
    assert api.get("/games", params={"text": "tarrasch"}).json()["total"] == 0
    others = api.get("/games", params={"text": "tarrasch", "whose": "others"}).json()
    assert others["total"] == 1
    assert others["games"][0]["is_owner_game"] is False


def test_an_upload_that_says_nothing_is_the_owners_own_games(api: TestClient) -> None:
    response = api.post(
        "/import/pgn/upload?wait=true",
        content=STRANGERS_GAME.encode("utf-8"),
        headers={"content-type": "application/x-chess-pgn"},
    )

    assert response.status_code == 200
    assert api.get("/games", params={"text": "tarrasch"}).json()["total"] == 1


def test_a_not_mine_upload_still_claims_a_game_the_owner_is_in(api: TestClient) -> None:
    """`mine=false` is a presumption, not an override: a name that resolves to an owner
    account is the owner, whatever the file was said to be, exactly as it is for a game
    added from the reference books."""
    response = api.post(
        "/import/pgn/upload?wait=true&mine=false",
        content=ONE_GAME.encode("utf-8"),
        headers={"content-type": "application/x-chess-pgn"},
    )

    assert response.status_code == 200
    mine = api.get("/games", params={"text": "newcomer"}).json()
    assert mine["total"] == 1
    assert mine["games"][0]["is_owner_game"] is True


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
    body = api.get("/import/jobs", params={"source": "pgn"}).json()
    jobs = body["jobs"]

    assert [job["source"] for job in jobs] == ["pgn", "pgn"]
    assert jobs[0]["id"] > jobs[1]["id"]
    assert body["total"] == 2
    assert api.get(f"/import/jobs/{jobs[0]['id']}").json()["games_seen"] == 1


def test_the_sync_history_pages_over_the_whole_of_it(api: TestClient) -> None:
    api.post("/import/pgn", json={"text": ONE_GAME, "wait": True})

    first = api.get("/import/jobs", params={"limit": 1}).json()
    second = api.get("/import/jobs", params={"limit": 1, "offset": 1}).json()

    assert (first["total"], second["total"]) == (2, 2)
    assert len(first["jobs"]) == len(second["jobs"]) == 1
    # Newest first, and the second page is the older job rather than the same one again.
    assert first["jobs"][0]["id"] > second["jobs"][0]["id"]


def test_an_import_job_that_is_not_there_is_a_typed_404(api: TestClient) -> None:
    response = api.get("/import/jobs/9999")

    assert response.status_code == 404
    assert error_of(response) == "unknown_job"


def test_stopping_an_import_that_is_not_there_is_a_typed_404(api: TestClient) -> None:
    response = api.post("/import/jobs/9999/cancel")

    assert response.status_code == 404
    assert error_of(response) == "unknown_job"


def test_stopping_an_import_that_has_finished_is_a_typed_409(api: TestClient) -> None:
    """Nothing is left to signal, and the job row already says how the run ended."""
    started = api.post("/import/pgn", json={"text": ONE_GAME, "wait": True}).json()

    response = api.post(f"/import/jobs/{started['job_id']}/cancel")

    assert response.status_code == 409
    assert error_of(response) == "job_not_running"


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


def test_a_batch_queues_one_run_per_game_in_one_call(api: TestClient) -> None:
    ids = [game["id"] for game in api.get("/games", params={"limit": 3}).json()["games"]]

    response = api.post("/analysis/batch", json={"game_ids": ids, "tier": "deep"})

    assert response.status_code == 202
    body = response.json()
    assert [row["game_id"] for row in body["queued"]] == ids
    assert len({row["run_id"] for row in body["queued"]}) == 3
    assert body["refused"] == []
    # All three landed together: the queue is three deep after the one call.
    assert api.get("/analysis/queue").json()["queued"] == 3
    for row in body["queued"]:
        assert api.get(f"/analysis/runs/{row['run_id']}").json()["tier"] == "deep"


def test_a_batch_queues_around_the_game_it_cannot_take(api: TestClient) -> None:
    """One bad id does not sink the selection it was sitting in."""
    ids = [game["id"] for game in api.get("/games", params={"limit": 2}).json()["games"]]

    body = api.post("/analysis/batch", json={"game_ids": [ids[0], 9999, ids[1]]}).json()

    assert [row["game_id"] for row in body["queued"]] == ids
    assert body["refused"] == [{"game_id": 9999, "reason": "no game with id 9999"}]
    assert api.get("/analysis/queue").json()["queued"] == 2


def test_a_batch_queues_a_repeated_game_once(api: TestClient, seeded: dict[str, int]) -> None:
    game_id = seeded["game_id"]

    body = api.post("/analysis/batch", json={"game_ids": [game_id, game_id]}).json()

    assert [row["game_id"] for row in body["queued"]] == [game_id]
    assert api.get("/analysis/queue").json()["queued"] == 1


def _register_maia(settings: Settings, engine_command: str) -> None:
    """A human-move model on this host, which a fill has to have something to ask."""
    with get_sessionmaker(settings)() as session:
        engine = Engine(
            name="Maia",
            kind=EngineKind.MAIA,
            path=engine_command,
            options={},
            enabled=True,
        )
        session.add(engine)
        session.commit()
        engines_service.assign_default_roles(session, engine)


def test_the_fill_status_counts_the_games_missing_a_level(api: TestClient) -> None:
    """`seeded` finished one run, and it carries no Maia policy at all."""
    assert api.get("/analysis/maia-fill/status").json() == {
        "missing_games": 1,
        "configured": [MAIA_MAX_RATING],
    }


def test_a_fill_queues_a_maia_only_pass_and_then_has_nothing_left(
    api: TestClient, settings: Settings, engine_command: str
) -> None:
    _register_maia(settings, engine_command)

    response = api.post("/analysis/maia-fill")

    assert response.status_code == 202, response.text
    assert response.json() == {"queued": 1, "already_complete": 0}
    assert api.get("/analysis/queue").json()["queued"] == 1
    # The work is on its way, so pressing the button again queues nothing.
    assert api.get("/analysis/maia-fill/status").json()["missing_games"] == 0
    assert api.post("/analysis/maia-fill").json() == {"queued": 0, "already_complete": 1}


def test_the_backfill_preview_counts_the_games_with_no_pass(api: TestClient) -> None:
    """`seeded` finished a quick run over exactly one of its games; the rest are the work."""
    total = api.get("/games", params={"limit": 1}).json()["total"]

    assert api.get("/analysis/backfill").json() == {"tier": "quick", "pending": total - 1}


def test_a_backfill_queues_every_game_that_has_none(api: TestClient) -> None:
    pending = api.get("/analysis/backfill").json()["pending"]

    response = api.post("/analysis/backfill")

    assert response.status_code == 202
    assert response.json() == {"tier": "quick", "queued": pending, "outstanding": pending}
    assert api.get("/analysis/queue").json()["queued"] == pending
    # Every game now has a live quick run, so the button has nothing left to offer.
    assert api.get("/analysis/backfill").json()["pending"] == 0


def test_cancelling_a_backfill_empties_the_queue_it_filled(api: TestClient) -> None:
    queued = api.post("/analysis/backfill").json()["queued"]

    body = api.post("/analysis/backfill/cancel").json()

    assert body == {"tier": "quick", "dropped": queued, "outstanding": 0}
    assert api.get("/analysis/queue").json()["queued"] == 0
    # The games are uncovered again, which is what makes the button offer them once more.
    assert api.get("/analysis/backfill").json()["pending"] == queued


def test_clearing_the_queue_leaves_a_running_run_to_finish(
    settings: Settings, api: TestClient
) -> None:
    """The reset button is not a stop button for what an engine has already claimed."""
    api.post("/analysis/backfill")
    api.post("/analysis/backfill", json={"tier": "deep"})
    with get_sessionmaker(settings)() as session:
        claimed = session.scalars(
            select(AnalysisRun).where(AnalysisRun.status == RunStatus.QUEUED).order_by(
                AnalysisRun.id
            )
        ).first()
        assert claimed is not None
        claimed.status = RunStatus.RUNNING
        session.commit()
        claimed_id = claimed.id

    body = api.post("/analysis/queue/clear").json()

    assert body["outstanding"] == 1
    with get_sessionmaker(settings)() as session:
        survived = set(session.scalars(select(AnalysisRun.id).where(AnalysisRun.status != "done")))
        assert survived == {claimed_id}
    queue = api.get("/analysis/queue").json()
    assert (queue["queued"], queue["running"]) == (0, 1)


def test_clearing_an_empty_queue_drops_nothing(api: TestClient) -> None:
    body = api.post("/analysis/queue/clear").json()

    assert body == {"dropped": 0, "outstanding": 0}


def test_the_queue_can_be_paused_and_resumed(api: TestClient, seeded: dict[str, int]) -> None:
    """Both verbs answer the state in force, and `/queue` reports it in between."""
    api.post("/analysis", json={"game_id": seeded["game_id"]})
    assert api.get("/analysis/queue").json()["paused"] is False

    paused = api.post("/analysis/queue/pause").json()

    assert paused == {"paused": True, "queued": 1, "running": 0}
    queue = api.get("/analysis/queue").json()
    assert (queue["paused"], queue["queued"]) == (True, 1)

    resumed = api.post("/analysis/queue/resume").json()

    assert resumed == {"paused": False, "queued": 1, "running": 0}
    assert api.get("/analysis/queue").json()["paused"] is False


def test_a_run_over_a_position_takes_no_ply_range(api: TestClient) -> None:
    """The body carries a window `AnalysisRequest.ply_range` builds and the service refuses."""
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


def _failed_run(settings: Settings, game_id: int, engine_id: int) -> int:
    """A run that failed for good — the shape of the 372 a first-day misconfiguration left."""
    with get_sessionmaker(settings)() as session:
        run = AnalysisRun(
            game_id=game_id,
            engine_id=engine_id,
            tier=Tier.DEEP,
            status=RunStatus.FAILED,
            nodes=1000,
            multipv=1,
            attempts=2,
            error="no engine is available for this tier",
            started_at=utcnow(),
            finished_at=utcnow(),
        )
        session.add(run)
        session.commit()
        return run.id


def test_the_failed_runs_are_listable_and_can_be_picked_back_up(
    api: TestClient, settings: Settings, seeded: dict[str, int]
) -> None:
    run_id = _failed_run(settings, seeded["game_id"], seeded["engine_id"])

    listed = api.get("/analysis/runs", params={"status": "failed"}).json()

    assert [run["id"] for run in listed] == [run_id]

    response = api.post("/analysis/runs/retry-failed")

    assert response.status_code == 202, response.text
    assert response.json() == {"queued": 1, "skipped": 0}
    assert api.get("/analysis/queue").json()["queued"] == 1
    # A retry is a new run, so the failure is still there to read.
    assert api.get(f"/analysis/runs/{run_id}").json()["status"] == "failed"


def test_a_run_listing_that_narrows_by_nothing_is_a_422(api: TestClient) -> None:
    response = api.get("/analysis/runs")

    assert response.status_code == 422
    assert error_of(response) == "invalid_request"


def test_the_coverage_answer_adds_up_to_the_library(
    api: TestClient, settings: Settings, seeded: dict[str, int]
) -> None:
    """`seeded` finished one quick run over one of its games and nothing else."""
    total = api.get("/games", params={"limit": 1}).json()["total"]
    _failed_run(settings, seeded["game_id"], seeded["engine_id"])

    body = api.get("/analysis/coverage").json()

    assert body["total"] == total
    assert body["no_pass"] + body["quick_only"] + body["deep"] == total
    assert (body["quick_only"], body["deep"], body["no_pass"]) == (1, 0, total - 1)
    assert body["missing"] == {"quick": total - 1, "deep": total}
    assert body["failed"] == 1
    assert body["maia"] == {
        "configured": [MAIA_MAX_RATING],
        "games_with_any": 0,
        "per_level": [{"elo": MAIA_MAX_RATING, "games": 0}],
        "missing_games": 1,
        "orphan_levels": [],
    }
    # One run, at a budget nobody is enqueueing today: there is nothing honest to say yet.
    assert body["estimates"] == {
        "quick_seconds": None,
        "deep_seconds": None,
        "maia_seconds": None,
        "concurrency": settings.analysis_concurrency,
    }


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


def test_the_explorer_names_the_line_it_was_reached_by(api: TestClient) -> None:
    line = "d2d4,g8f6,c2c4,e7e6,g1f3,d7d5,b1c3,f8b4,c1g5,h7h6"
    body = api.get("/explorer", params={"line": line}).json()

    # Ten plies in, named from the eighth: the book stops before the position does.
    assert body["opening"] == {
        "eco": "D38",
        "name": "Queen's Gambit Declined: Ragozin Defense",
        "ply": 8,
    }


def test_a_garbled_line_costs_a_name_and_never_the_tree(api: TestClient) -> None:
    body = api.get("/explorer", params={"line": "e2e4,NOT A MOVE,e7e5"}).json()

    # `parseLineParam` drops what does not look like a move and the API spells it the same,
    # so the tree still answers and the surviving crumbs still name it.
    assert body["totals"]["games"] == 6
    assert body["opening"]["name"] == "King's Pawn Game"


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


def test_the_dashboard_returns_every_dimension_over_one_anchored_window(
    api: TestClient,
) -> None:
    body = api.get("/stats/dashboard", params={"days": 90}).json()

    assert body["anchor"] == "2026-03-20T10:45:00Z"
    assert body["since"] == "2025-12-20T10:45:00Z"
    assert set(body["dimensions"]) == {
        "blunders_by_phase",
        "blunders_by_piece",
        "performance_by_speed",
        "performance_by_hour",
        "time_trouble_loss",
        "rating_trend",
    }
    assert body["dimensions"]["performance_by_speed"]["total"]["games"] == 6
    assert body["dimensions"]["blunders_by_phase"]["total"]["blunder"] == 1


def test_the_speed_filter_repeats_to_name_a_set(api: TestClient) -> None:
    """`speed=blitz&speed=rapid` is how the Stats page leaves a time control out."""
    body = api.get("/stats/dashboard", params=[("speed", "blitz"), ("speed", "rapid")]).json()
    speed = body["dimensions"]["performance_by_speed"]

    assert speed["total"]["games"] == 5
    assert {bucket["key"] for bucket in speed["buckets"]} == {"blitz", "rapid"}
    # One value on its own still reads the way it always did.
    assert api.get("/stats/dashboard", params={"speed": "bullet"}).json()["dimensions"][
        "performance_by_speed"
    ]["total"]["games"] == 1


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


def test_the_roles_read_carries_the_two_tiers_and_human_moves_beside_them(
    api: TestClient,
) -> None:
    """Human moves is a role, not a third `Tier`, so it is a row of the same list."""
    body = api.get("/engines/roles").json()

    assert [role["role"] for role in body["roles"]] == ["quick", "deep", "human"]
    assert body["roles"][0]["engine_name"] == "FakeFish"
    # This deployment registered no Maia: nothing assigned, and not a fault either.
    assert body["roles"][2] == {
        "role": "human",
        "engine_id": None,
        "engine_name": None,
        "available": False,
        "configured": False,
        "reason": "no engine is assigned to human moves",
    }


def test_a_role_is_assigned_by_id_and_unassigned_with_null(
    api: TestClient, seeded: dict[str, int], engine_command: str
) -> None:
    """Only the keys that were sent are applied, so one dropdown never clears another."""
    second = api.post("/engines", json={"name": "Second Fish", "path": engine_command}).json()

    body = api.put("/engines/roles", json={"deep": second["id"]}).json()

    roles = {role["role"]: role for role in body["roles"]}
    assert roles["deep"]["engine_id"] == second["id"]
    assert roles["quick"]["engine_id"] == seeded["engine_id"]

    emptied = api.put("/engines/roles", json={"deep": None}).json()
    emptied_roles = {role["role"]: role for role in emptied["roles"]}
    assert emptied_roles["deep"]["configured"] is False
    assert emptied_roles["quick"]["engine_id"] == seeded["engine_id"]


def test_a_role_refuses_an_engine_that_cannot_serve_it(
    api: TestClient, seeded: dict[str, int]
) -> None:
    unknown = api.put("/engines/roles", json={"quick": 4242})
    assert unknown.status_code == 422
    assert error_of(unknown) == "invalid_engine"

    mismatched = api.put("/engines/roles", json={"human": seeded["engine_id"]})
    assert mismatched.status_code == 422
    assert "needs a human-move model" in mismatched.json()["detail"]


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
    # Written through the browser, and the note says so.
    assert body["source"] == "web"
    assert api.get(f"/notes/{body['id']}").json() == body


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


def test_a_note_on_a_variation_pins_the_variation(
    api: TestClient, seeded: dict[str, int]
) -> None:
    game_id = seeded["game_id"]
    body = api.post(
        "/notes",
        json={
            "text": "d6 holds the centre",
            "line": {"game_id": game_id, "base_ply": 3, "moves": ["d7d6", "d2d4"]},
        },
    ).json()

    assert body["line"]["sans"] == ["d6", "d4"]
    assert body["ply"] == 5
    kept = api.get(f"/games/{game_id}/lines").json()
    assert [line["id"] for line in kept] == [body["line"]["id"]]
    assert [note["text"] for note in kept[0]["notes"]] == ["d6 holds the centre"]

    # Unpinning the line leaves the thinking behind.
    assert api.delete(f"/lines/{body['line']['id']}").status_code == 204
    assert api.get(f"/games/{game_id}/lines").json() == []
    assert api.get(f"/notes/{body['id']}").json()["line_id"] is None


def test_a_kept_line_is_not_kept_twice(api: TestClient, seeded: dict[str, int]) -> None:
    game_id = seeded["game_id"]
    first = api.post(
        "/lines", json={"game_id": game_id, "base_ply": 3, "moves": ["d7d6"]}
    ).json()
    longer = api.post(
        "/lines", json={"game_id": game_id, "base_ply": 3, "moves": ["d7d6", "d2d4"]}
    ).json()

    assert longer["id"] == first["id"]
    assert longer["sans"] == ["d6", "d4"]
    assert len(api.get(f"/games/{game_id}/lines").json()) == 1


def test_a_line_on_a_game_that_is_not_there_is_a_typed_404(api: TestClient) -> None:
    response = api.post("/lines", json={"game_id": 9999, "base_ply": 0, "moves": ["e2e4"]})
    assert response.status_code == 404
    assert error_of(response) == "unknown_game"
    assert error_of(api.delete("/lines/9999")) == "unknown_line"


def test_notes_are_narrowed_by_scope(api: TestClient, seeded: dict[str, int]) -> None:
    game_id = seeded["game_id"]
    api.post("/notes", json={"text": "a plan for the month"})
    api.post(
        "/notes",
        json={"text": "on a line", "line": {"game_id": game_id, "base_ply": 3, "moves": ["d7d6"]}},
    )

    assert [note["text"] for note in api.get("/notes", params={"scope": "free"}).json()] == [
        "a plan for the month"
    ]
    assert [note["text"] for note in api.get("/notes", params={"scope": "line"}).json()] == [
        "on a line"
    ]
    # The seeded note is the game-scoped one.
    scoped = api.get("/notes", params={"scope": "game"}).json()
    assert [note["id"] for note in scoped] == [seeded["note_id"]]
    assert error_of(api.get("/notes", params={"scope": "sideways"})) == "invalid_request"


def test_notes_export_as_markdown_and_as_pgn(api: TestClient, seeded: dict[str, int]) -> None:
    game_id = seeded["game_id"]
    api.post("/notes", json={"text": "watch the c-file", "game_id": game_id, "ply": 4})

    markdown = api.get("/notes/export", params={"format": "md"})
    assert markdown.headers["content-type"].startswith("text/markdown")
    assert "attachment" in markdown.headers["content-disposition"]
    assert "# Blunderbase notes" in markdown.text
    assert "watch the c-file" in markdown.text

    pgn = api.get("/notes/export", params={"format": "pgn", "game_id": game_id})
    assert pgn.headers["content-type"].startswith("application/x-chess-pgn")
    assert "{ watch the c-file }" in pgn.text

    assert error_of(api.get("/notes/export", params={"format": "docx"})) == "invalid_request"


def test_complete_library_exports_as_a_pgn_download(api: TestClient) -> None:
    response = api.get("/games/export")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-chess-pgn")
    assert response.headers["content-disposition"] == (
        'attachment; filename="blunderbase-library.pgn"'
    )
    assert response.text.count('[Event "') == 6
    assert "Berlin endgames need work" in response.text


def test_complete_database_download_is_a_verified_sqlite_backup(
    api: TestClient, tmp_path: Path
) -> None:
    response = api.get("/library/backup")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/vnd.sqlite3")
    assert "blunderbase-backup-" in response.headers["content-disposition"]
    downloaded = tmp_path / "downloaded.db"
    downloaded.write_bytes(response.content)
    assert backups_service.verify_database(downloaded) == head_revision()


def test_database_backup_estimate_reports_the_snapshot_size(
    api: TestClient, settings: Settings
) -> None:
    response = api.get("/library/backup/estimate")

    assert response.status_code == 200
    assert response.json() == {
        "estimated_bytes": backups_service.estimate_database_bytes(settings.database_path)
    }


def test_database_backup_can_be_prepared_then_streamed(
    api: TestClient, tmp_path: Path
) -> None:
    prepared = api.post("/library/backup/prepare")

    assert prepared.status_code == 200
    receipt = prepared.json()
    assert receipt["filename"].startswith("blunderbase-backup-")
    assert receipt["bytes"] > 0

    response = api.get(f"/library/backup/prepared/{receipt['token']}")
    assert response.status_code == 200
    assert response.headers["content-disposition"] == (
        f'attachment; filename="{receipt["filename"]}"'
    )
    downloaded = tmp_path / "prepared.db"
    downloaded.write_bytes(response.content)
    assert backups_service.verify_database(downloaded) == head_revision()


def test_the_events_socket_sees_a_line_and_a_deletion(
    api: TestClient, seeded: dict[str, int]
) -> None:
    with api.websocket_connect("/events", headers=socket_headers(api)) as socket:
        line = api.post(
            "/lines", json={"game_id": seeded["game_id"], "base_ply": 3, "moves": ["d7d6"]}
        ).json()
        created = _drain(socket, "line.created")[-1]
        api.delete(f"/lines/{line['id']}")
        removed = _drain(socket, "line.deleted")[-1]
        api.delete(f"/notes/{seeded['note_id']}")
        forgotten = _drain(socket, "note.deleted")[-1]

    assert created["line_id"] == line["id"]
    assert created["moves"] == ["d7d6"]
    assert removed == {
        "event": "line.deleted",
        "line_id": line["id"],
        "game_id": seeded["game_id"],
    }
    assert forgotten["note_id"] == seeded["note_id"]


# --- /search --------------------------------------------------------------


def test_a_search_query_too_short_to_answer_comes_back_empty(api: TestClient) -> None:
    body = api.get("/search", params={"q": "b"}).json()

    assert body == {"games": [], "opponents": [], "openings": [], "notes": []}


def test_an_opponent_name_brings_back_the_games_and_one_grouped_row(api: TestClient) -> None:
    api.post("/import/pgn", json={"text": TWO_MORE_BERLINS, "wait": True})

    body = api.get("/search", params={"q": "berlinwall"}).json()

    assert [game["opponent"] for game in body["games"]] == ["berlinwall"] * 3
    # A loss, a win and a draw against them: three games, an even record.
    assert body["opponents"] == [{"name": "berlinwall", "games": 3, "score": 50.0}]


def test_an_eco_prefix_surfaces_the_openings_it_names(api: TestClient) -> None:
    body = api.get("/search", params={"q": "C6"}).json()

    assert body["openings"] == [
        {"eco": "C60", "name": "Ruy Lopez", "games": 1},
        {"eco": "C65", "name": "Ruy Lopez: Berlin Defense", "games": 1},
    ]
    assert {game["eco"] for game in body["games"]} == {"C60", "C65"}


def test_a_note_is_found_by_its_own_text(api: TestClient, seeded: dict[str, int]) -> None:
    body = api.get("/search", params={"q": "endgames"}).json()

    assert [note["id"] for note in body["notes"]] == [seeded["note_id"]]


def test_the_search_limit_caps_every_group_on_its_own(api: TestClient) -> None:
    wide = api.get("/search", params={"q": "lopez"}).json()
    assert len(wide["games"]) == 2
    assert len(wide["openings"]) == 2

    capped = api.get("/search", params={"q": "lopez", "limit": 1}).json()
    assert len(capped["games"]) == 1
    assert len(capped["openings"]) == 1


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


def test_the_events_socket_sees_one_frame_for_a_whole_backfill(api: TestClient) -> None:
    """A library-sized enqueue is one summary, not one frame per run."""
    with api.websocket_connect("/events", headers=socket_headers(api)) as socket:
        receipt = api.post("/analysis/backfill").json()
        events = _drain(socket, "analysis.backfill")

    assert [event["event"] for event in events] == ["analysis.backfill"]
    assert events[-1] == {
        "event": "analysis.backfill",
        "tier": "quick",
        "queued": receipt["queued"],
        "outstanding": receipt["outstanding"],
        "maia_only": False,
    }


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

"""The two opening repertoires: the service, the HTTP surface and the coach's tools.

A repertoire is the one thing in the database that is not a record of something that
happened, so the tests are about the tree's own rules — sibling order, transpositions,
what a delete takes with it — and about nothing being written that could not be played.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from mcp import Client
from mcp.server import MCPServer
from mcp.types import CallToolResult, TextContent
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session, sessionmaker

from backend.api.app import create_app
from backend.config import Settings
from backend.db.enums import Color
from backend.db.migrate import upgrade_to_head
from backend.db.models import RepertoireMove
from backend.db.session import get_engine
from backend.mcp.server import build_server
from backend.services import repertoire as repertoire_service
from tests.conftest import running_app

# Two move orders into the same position: 1.d4 Nf6 2.c4 and 1.c4 Nf6 2.d4. The position
# after White's second move is the same board, which is what a transposition is.
QUEENS_GAMBIT = ["d2d4", "g8f6", "c2c4"]
ENGLISH_INTO_IT = ["c2c4", "g8f6", "d2d4"]
# The EPD both of them reach, keyed the way the explorer keys a position.
TRANSPOSED = "rnbqkb1r/pppppppp/5n2/8/2PP4/8/PP2PPPP/RNBQKBNR b KQkq -"


# --- the service -----------------------------------------------------------


def test_a_line_is_stored_move_by_move_with_its_sans(session: Session) -> None:
    added = repertoire_service.add_line(session, Color.WHITE, ["e2e4", "e7e5", "g1f3"])

    assert added["created"] == 3
    assert added["tip"]["san"] == "Nf3"
    # The tip is one node, not a tree: nothing claims it has no continuations.
    assert "children" not in added["tip"]

    tree = repertoire_service.tree(session, Color.WHITE)
    assert tree["color"] == "white"
    assert [move["san"] for move in tree["moves"]] == ["e4"]
    assert [move["san"] for move in tree["moves"][0]["children"]] == ["e5"]
    assert tree["moves"][0]["children"][0]["children"][0]["san"] == "Nf3"


def test_the_epd_after_each_move_is_stored(session: Session) -> None:
    repertoire_service.add_line(session, Color.WHITE, QUEENS_GAMBIT)
    tip = repertoire_service.add_line(session, Color.WHITE, ENGLISH_INTO_IT)["tip"]
    assert tip["epd"] == TRANSPOSED


def test_re_adding_a_line_creates_nothing(session: Session) -> None:
    first = repertoire_service.add_line(session, Color.WHITE, ["e2e4", "e7e5"])
    again = repertoire_service.add_line(session, Color.WHITE, ["e2e4", "e7e5"])

    assert again["created"] == 0
    assert again["tip"]["id"] == first["tip"]["id"]
    assert session.scalar(select(RepertoireMove.id).where(RepertoireMove.move_uci == "e7e5"))


def test_extending_a_stored_line_only_writes_the_new_moves(session: Session) -> None:
    repertoire_service.add_line(session, Color.WHITE, ["e2e4", "e7e5"])
    longer = repertoire_service.add_line(session, Color.WHITE, ["e2e4", "e7e5", "g1f3", "b8c6"])
    assert longer["created"] == 2


def test_the_two_colours_are_two_trees(session: Session) -> None:
    repertoire_service.add_line(session, Color.WHITE, ["e2e4"])
    repertoire_service.add_line(session, Color.BLACK, ["e2e4", "c7c5"])

    assert [move["san"] for move in repertoire_service.tree(session, Color.WHITE)["moves"]] == [
        "e4"
    ]
    black = repertoire_service.tree(session, Color.BLACK)
    assert [move["san"] for move in black["moves"][0]["children"]] == ["c5"]


def test_a_line_that_could_not_be_played_writes_nothing(session: Session) -> None:
    with pytest.raises(repertoire_service.RepertoireError):
        repertoire_service.add_line(session, Color.WHITE, ["e2e4", "e2e4"])
    with pytest.raises(repertoire_service.RepertoireError):
        repertoire_service.add_line(session, Color.WHITE, ["not-a-move"])

    assert repertoire_service.tree(session, Color.WHITE)["moves"] == []


def test_the_null_move_is_not_a_move(session: Session) -> None:
    # python-chess hands `0000` back from `parse_uci` without ever asking whether it is
    # legal, so it is the one "move" that reaches the tree unless it is turned away here.
    with pytest.raises(repertoire_service.RepertoireError):
        repertoire_service.add_line(session, Color.WHITE, ["e2e4", "0000"])

    assert repertoire_service.tree(session, Color.WHITE)["moves"] == []


def test_an_empty_line_is_refused(session: Session) -> None:
    with pytest.raises(repertoire_service.RepertoireError):
        repertoire_service.add_line(session, Color.WHITE, [])
    with pytest.raises(repertoire_service.RepertoireError):
        repertoire_service.add_line(session, Color.WHITE, ["  "])


def test_the_first_sibling_is_the_main_line_and_the_rest_queue_behind_it(
    session: Session,
) -> None:
    repertoire_service.add_line(session, Color.WHITE, ["e2e4", "e7e5"])
    repertoire_service.add_line(session, Color.WHITE, ["e2e4", "c7c5"])
    repertoire_service.add_line(session, Color.WHITE, ["e2e4", "e7e6"])

    answers = repertoire_service.tree(session, Color.WHITE)["moves"][0]["children"]
    assert [(move["san"], move["rank"]) for move in answers] == [("e5", 0), ("c5", 1), ("e6", 2)]


def test_promoting_a_move_makes_it_the_main_line(session: Session) -> None:
    repertoire_service.add_line(session, Color.WHITE, ["e2e4", "e7e5"])
    repertoire_service.add_line(session, Color.WHITE, ["e2e4", "c7c5"])
    repertoire_service.add_line(session, Color.WHITE, ["e2e4", "e7e6"])
    answers = repertoire_service.tree(session, Color.WHITE)["moves"][0]["children"]
    sicilian = next(move for move in answers if move["san"] == "c5")

    promoted = repertoire_service.update_move(session, sicilian["id"], promote=True)
    assert promoted["rank"] == 0

    # The ones it stepped in front of keep their order among themselves.
    after = repertoire_service.tree(session, Color.WHITE)["moves"][0]["children"]
    assert [(move["san"], move["rank"]) for move in after] == [("c5", 0), ("e5", 1), ("e6", 2)]


def test_a_comment_is_written_and_cleared(session: Session) -> None:
    tip = repertoire_service.add_line(session, Color.BLACK, ["e2e4", "c7c5"])["tip"]
    assert tip["comment"] == ""

    written = repertoire_service.update_move(session, tip["id"], comment="  play for ...d5  ")
    assert written["comment"] == "play for ...d5"

    cleared = repertoire_service.update_move(session, tip["id"], comment=None)
    assert cleared["comment"] == ""

    # Leaving the argument out is not the same request as clearing it.
    repertoire_service.update_move(session, tip["id"], comment="the plan")
    assert repertoire_service.update_move(session, tip["id"], promote=True)["comment"] == "the plan"


def test_a_move_that_is_not_there_is_a_lookup_error(session: Session) -> None:
    with pytest.raises(LookupError):
        repertoire_service.update_move(session, 9999, comment="x")
    with pytest.raises(LookupError):
        repertoire_service.delete_move(session, 9999)


def test_deleting_a_move_takes_its_whole_subtree(session: Session) -> None:
    repertoire_service.add_line(session, Color.WHITE, ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"])
    repertoire_service.add_line(session, Color.WHITE, ["e2e4", "c7c5"])
    tree = repertoire_service.tree(session, Color.WHITE)
    open_game = next(
        move for move in tree["moves"][0]["children"] if move["san"] == "e5"
    )

    repertoire_service.delete_move(session, open_game["id"])

    left = repertoire_service.tree(session, Color.WHITE)
    assert [move["san"] for move in left["moves"][0]["children"]] == ["c5"]
    assert session.scalars(select(RepertoireMove.move_uci)).all() == ["e2e4", "c7c5"]


def test_deleting_a_sibling_closes_the_ranks_behind_it(session: Session) -> None:
    for reply in ("e7e5", "c7c5", "e7e6", "c7c6"):
        repertoire_service.add_line(session, Color.WHITE, ["e2e4", reply])
    answers = repertoire_service.tree(session, Color.WHITE)["moves"][0]["children"]
    by_san = {move["san"]: move["id"] for move in answers}

    repertoire_service.delete_move(session, by_san["e5"])
    repertoire_service.delete_move(session, by_san["c5"])

    # The set still has a main move in it: rank 0 is what says which one that is.
    left = repertoire_service.tree(session, Color.WHITE)["moves"][0]["children"]
    assert [(move["san"], move["rank"]) for move in left] == [("e6", 0), ("c6", 1)]

    # And a move added afterwards is still an alternative *below* them, not between them.
    repertoire_service.add_line(session, Color.WHITE, ["e2e4", "d7d5"])
    after = repertoire_service.tree(session, Color.WHITE)["moves"][0]["children"]
    assert [(move["san"], move["rank"]) for move in after] == [("e6", 0), ("c6", 1), ("d5", 2)]


def test_deleting_a_first_move_closes_the_ranks_of_the_roots(session: Session) -> None:
    repertoire_service.add_line(session, Color.WHITE, ["e2e4"])
    repertoire_service.add_line(session, Color.WHITE, ["d2d4"])
    roots = repertoire_service.tree(session, Color.WHITE)["moves"]

    repertoire_service.delete_move(session, roots[0]["id"])

    left = repertoire_service.tree(session, Color.WHITE)["moves"]
    assert [(move["san"], move["rank"]) for move in left] == [("d4", 0)]


def test_subtrees_at_finds_a_transposition(session: Session) -> None:
    repertoire_service.add_line(session, Color.WHITE, [*QUEENS_GAMBIT, "e7e6"])
    repertoire_service.add_line(session, Color.WHITE, [*ENGLISH_INTO_IT, "g7g6"])

    found = repertoire_service.subtrees_at(session, Color.WHITE, TRANSPOSED)

    assert len(found) == 2
    assert [[step["san"] for step in hit["path"]] for hit in found] == [
        ["d4", "Nf6", "c4"],
        ["c4", "Nf6", "d4"],
    ]
    # Each hit carries what the repertoire says from there, which is the point of asking.
    assert [hit["node"]["children"][0]["san"] for hit in found] == ["e6", "g6"]


def test_subtrees_at_answers_nothing_for_a_position_outside_the_tree(session: Session) -> None:
    repertoire_service.add_line(session, Color.WHITE, ["e2e4"])
    assert repertoire_service.subtrees_at(session, Color.WHITE, TRANSPOSED) == []


def test_subtrees_at_refuses_a_position_that_is_not_one(session: Session) -> None:
    with pytest.raises(ValueError):
        repertoire_service.subtrees_at(session, Color.WHITE, "not a fen")


# --- the migration ---------------------------------------------------------


def test_the_migration_builds_the_table_and_its_indexes(settings: Settings) -> None:
    upgrade_to_head(settings)
    inspector = inspect(get_engine(settings))

    assert "repertoire_moves" in inspector.get_table_names()
    indexed = {
        tuple(index["column_names"]) for index in inspector.get_indexes("repertoire_moves")
    }
    assert ("color", "parent_id") in indexed
    assert ("color", "epd") in indexed


# --- the HTTP surface ------------------------------------------------------


@pytest.fixture()
def api(settings: Settings) -> Iterator[TestClient]:
    """The app on an empty library: a repertoire needs no games to exist."""
    settings.analysis_workers = False
    with running_app(create_app(settings)) as client:
        yield client


def error_of(response: Any) -> str:
    return response.json()["error"]


def test_an_empty_repertoire_is_an_empty_tree(api: TestClient) -> None:
    assert api.get("/repertoire/white").json() == {"color": "white", "moves": []}
    assert api.get("/repertoire/black").json() == {"color": "black", "moves": []}


def test_a_colour_nobody_plays_is_a_422(api: TestClient) -> None:
    assert api.get("/repertoire/green").status_code == 422


def test_adding_a_line_answers_201_with_the_tip(api: TestClient) -> None:
    response = api.post("/repertoire/white/line", json={"ucis": ["e2e4", "e7e5", "g1f3"]})

    assert response.status_code == 201
    body = response.json()
    assert body["created"] == 3
    assert body["tip"]["san"] == "Nf3"
    assert body["tip"]["comment"] == ""

    tree = api.get("/repertoire/white").json()
    assert tree["moves"][0]["uci"] == "e2e4"
    assert tree["moves"][0]["children"][0]["children"][0]["id"] == body["tip"]["id"]


def test_a_line_that_cannot_be_played_is_a_typed_422(api: TestClient) -> None:
    response = api.post("/repertoire/white/line", json={"ucis": ["e2e4", "e2e4"]})
    assert response.status_code == 422
    assert error_of(response) == "repertoire_invalid_line"
    assert api.get("/repertoire/white").json()["moves"] == []


def test_a_line_with_no_moves_is_refused(api: TestClient) -> None:
    response = api.post("/repertoire/white/line", json={"ucis": []})
    assert response.status_code == 422
    assert error_of(response) == "invalid_request"


def test_a_comment_is_patched_onto_a_move_and_cleared_with_null(api: TestClient) -> None:
    tip = api.post("/repertoire/black/line", json={"ucis": ["d2d4", "g8f6"]}).json()["tip"]

    written = api.patch(f"/repertoire/moves/{tip['id']}", json={"comment": "Indian defences"})
    assert written.json()["comment"] == "Indian defences"

    cleared = api.patch(f"/repertoire/moves/{tip['id']}", json={"comment": None})
    assert cleared.json()["comment"] == ""

    # A patch that says nothing about the comment leaves it where it was.
    api.patch(f"/repertoire/moves/{tip['id']}", json={"comment": "back again"})
    kept = api.patch(f"/repertoire/moves/{tip['id']}", json={"promote": True})
    assert kept.json()["comment"] == "back again"


def test_promoting_through_the_api_reorders_the_siblings(api: TestClient) -> None:
    api.post("/repertoire/white/line", json={"ucis": ["e2e4", "e7e5"]})
    api.post("/repertoire/white/line", json={"ucis": ["e2e4", "c7c5"]})
    answers = api.get("/repertoire/white").json()["moves"][0]["children"]
    sicilian = next(move for move in answers if move["san"] == "c5")

    assert api.patch(f"/repertoire/moves/{sicilian['id']}", json={"promote": True}).json()[
        "rank"
    ] == 0
    after = api.get("/repertoire/white").json()["moves"][0]["children"]
    assert [move["san"] for move in after] == ["c5", "e5"]


def test_deleting_a_move_answers_204_and_takes_the_subtree(api: TestClient) -> None:
    api.post("/repertoire/white/line", json={"ucis": ["e2e4", "e7e5", "g1f3"]})
    api.post("/repertoire/white/line", json={"ucis": ["e2e4", "c7c5"]})
    answers = api.get("/repertoire/white").json()["moves"][0]["children"]
    open_game = next(move for move in answers if move["san"] == "e5")

    assert api.delete(f"/repertoire/moves/{open_game['id']}").status_code == 204
    left = api.get("/repertoire/white").json()["moves"][0]["children"]
    assert [move["san"] for move in left] == ["c5"]


def test_a_move_that_is_not_there_is_a_typed_404(api: TestClient) -> None:
    assert error_of(api.patch("/repertoire/moves/9999", json={"comment": "x"})) == "not_found"
    assert error_of(api.delete("/repertoire/moves/9999")) == "not_found"


# --- the coach's tools -----------------------------------------------------


@pytest.fixture()
def coach(sessions: sessionmaker[Session]) -> MCPServer:
    return build_server(sessions=sessions)


def text_of(result: CallToolResult) -> str:
    assert result.content, "a tool answered with no content"
    block = result.content[0]
    assert isinstance(block, TextContent)
    return block.text


async def call(coach: MCPServer, name: str, **arguments: Any) -> Any:
    async with Client(coach) as client:
        result = await client.call_tool(name, arguments)
    assert not result.is_error, text_of(result)
    return json.loads(text_of(result))


async def failure(coach: MCPServer, name: str, **arguments: Any) -> dict[str, Any]:
    async with Client(coach) as client:
        result = await client.call_tool(name, arguments)
    assert result.is_error, text_of(result)
    payload = json.loads(text_of(result))
    assert "Traceback" not in payload["message"]
    return payload


async def test_the_repertoire_tools_are_registered_and_describe_themselves(
    coach: MCPServer,
) -> None:
    async with Client(coach) as client:
        listing = (await client.list_tools()).tools
    tools = {tool.name: tool for tool in listing}
    for name in ("get_repertoire", "add_repertoire_line", "set_repertoire_comment"):
        assert name in tools
        assert tools[name].description and len(tools[name].description) > 40
    assert set(tools["get_repertoire"].input_schema.get("required", ())) == {"color"}


async def test_the_coach_adds_a_line_and_reads_the_tree_back(coach: MCPServer) -> None:
    added = await call(coach, "add_repertoire_line", color="white", ucis=["e2e4", "c7c5"])
    assert added["created"] == 2

    tree = await call(coach, "get_repertoire", color="white")
    assert tree["color"] == "white"
    assert tree["moves"][0]["children"][0]["san"] == "c5"


async def test_the_coach_asks_what_the_repertoire_says_in_a_position(coach: MCPServer) -> None:
    await call(coach, "add_repertoire_line", color="white", ucis=[*QUEENS_GAMBIT, "e7e6"])
    await call(coach, "add_repertoire_line", color="white", ucis=[*ENGLISH_INTO_IT, "g7g6"])

    payload = await call(coach, "get_repertoire", color="white", fen=TRANSPOSED)
    assert payload["count"] == 2
    assert [hit["node"]["children"][0]["san"] for hit in payload["matches"]] == ["e6", "g6"]


async def test_the_coach_writes_a_comment_on_a_move(coach: MCPServer) -> None:
    added = await call(coach, "add_repertoire_line", color="black", ucis=["e2e4", "e7e5"])
    move_id = added["tip"]["id"]

    written = await call(
        coach, "set_repertoire_comment", move_id=move_id, comment="the open game, on purpose"
    )
    assert written["comment"] == "the open game, on purpose"

    tree = await call(coach, "get_repertoire", color="black")
    assert tree["moves"][0]["children"][0]["comment"] == "the open game, on purpose"


async def test_a_line_the_coach_cannot_play_is_a_structured_error(coach: MCPServer) -> None:
    payload = await failure(coach, "add_repertoire_line", color="white", ucis=["e2e4", "e2e4"])
    assert payload["error"] == "bad_argument"
    assert (await call(coach, "get_repertoire", color="white"))["moves"] == []


async def test_a_colour_the_coach_invented_is_a_structured_error(coach: MCPServer) -> None:
    payload = await failure(coach, "get_repertoire", color="purple")
    assert payload["error"] == "bad_argument"

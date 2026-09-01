"""The reference explorer: the adapter, the cache, the HTTP surface and the coach's tools.

Two things are being proved here. The first is that a database nobody here owns is read
correctly — the parameters Lichess wants, the errors it answers with, and the fold from its
payload into the shape every surface reads. The second is the rule the feature exists under:
nothing from either reference database is ever written down. No test below asserts a row,
because there is no row to assert; what they do assert is that the same lookup twice costs
one request, which is the only memory this side of the app has.

Nothing talks to Lichess: every request is answered by respx from fixtures of the shape the
API documents.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from mcp import Client
from mcp.server import MCPServer
from mcp.types import CallToolResult, TextContent
from sqlalchemy.orm import Session, sessionmaker

from backend.adapters import reference as adapter
from backend.api.app import create_app
from backend.config import Settings
from backend.db.models import AppSetting
from backend.mcp.server import build_server
from backend.services import app_settings as app_settings_service
from backend.services import reference as reference_service
from tests.conftest import running_app

MASTERS_URL = "https://explorer.lichess.ovh/masters"
LICHESS_URL = "https://explorer.lichess.ovh/lichess"
MASTERS_PGN_URL = "https://explorer.lichess.ovh/masters/pgn/abcd1234"
LICHESS_PGN_URL = "https://lichess.org/game/export/qg000007"

TOKEN = "lip_ownersowntoken"
FRENCH = "rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"
# The same position with its counters dropped: what the explorer keys a position by, and
# what the reference explorer answers with.
FRENCH_EPD = "rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -"
START_EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"

# One masters answer, in the shape the endpoint documents.
MASTERS_PAYLOAD: dict[str, Any] = {
    "white": 1200,
    "draws": 900,
    "black": 700,
    "opening": {"eco": "C00", "name": "French Defense"},
    "moves": [
        {
            "uci": "d2d4",
            "san": "d4",
            "white": 800,
            "draws": 600,
            "black": 400,
            "averageRating": 2531,
        },
        {"uci": "g1f3", "san": "Nf3", "white": 40, "draws": 30, "black": 20},
    ],
    "topGames": [
        {
            "id": "abcd1234",
            "winner": "white",
            "white": {"name": "Carlsen, M.", "rating": 2863},
            "black": {"name": "Caruana, F.", "rating": 2820},
            "year": 2019,
            "month": "2019-05",
        },
        {
            "id": "efgh5678",
            "winner": None,
            "white": {"name": "Ding, L.", "rating": 2805},
            "black": {"name": "Nepomniachtchi, I.", "rating": 2789},
            "year": 2023,
        },
    ],
}

# And one from the rated pools, which spells the average rating differently and adds a
# speed to every game it offers.
LICHESS_PAYLOAD: dict[str, Any] = {
    "white": 500,
    "draws": 40,
    "black": 460,
    "opening": None,
    "moves": [
        {
            "uci": "d2d4",
            "san": "d4",
            "white": 300,
            "draws": 20,
            "black": 280,
            "averageOpponentRating": 1802,
        }
    ],
    "topGames": [
        {
            "id": "qg000007",
            "winner": "black",
            "white": {"name": "someone", "rating": 1801},
            "black": {"name": "blunderbase", "rating": 1799},
            "year": 2026,
            "month": "2026-04",
            "speed": "blitz",
            "mode": "rated",
        }
    ],
}

MASTERS_GAME_PGN = """[Event "Candidates Tournament"]
[Site "London ENG"]
[Date "2013.03.15"]
[White "Carlsen, M."]
[Black "Caruana, F."]
[Result "1-0"]
[WhiteElo "2872"]
[BlackElo "2757"]

1. e4 e6 2. d4 d5 1-0
"""

LICHESS_GAME_PGN = """[Event "Rated Blitz game"]
[Site "https://lichess.org/qg000007"]
[Date "2026.04.01"]
[White "someone"]
[Black "blunderbase"]
[Result "0-1"]
[WhiteElo "1801"]
[BlackElo "1799"]

1. e4 e6 0-1
"""


@pytest.fixture(autouse=True)
def _fresh_reference_cache() -> Iterator[None]:
    """The service's cache is process-wide, so no test may be answered out of another's."""
    reference_service._clear_cache()
    yield
    reference_service._clear_cache()


@pytest.fixture()
def tokened(session: Session) -> Session:
    """A deployment whose owner has pasted their Lichess token."""
    app_settings_service.set_lichess_token(session, TOKEN)
    return session


# --- the adapter -----------------------------------------------------------


@respx.mock
def test_a_masters_lookup_sends_the_token_and_the_parameters_lichess_wants() -> None:
    route = respx.get(MASTERS_URL).mock(return_value=httpx.Response(200, json=MASTERS_PAYLOAD))

    payload = adapter.masters(FRENCH, moves=12, top_games=4, token=TOKEN)

    assert payload["white"] == 1200
    request = route.calls.last.request
    assert request.headers["authorization"] == f"Bearer {TOKEN}"
    assert request.headers["user-agent"] == adapter.USER_AGENT
    assert dict(request.url.params) == {"fen": FRENCH, "moves": "12", "topGames": "4"}


@respx.mock
def test_a_lichess_lookup_carries_its_speeds_ratings_and_variant() -> None:
    route = respx.get(LICHESS_URL).mock(return_value=httpx.Response(200, json=LICHESS_PAYLOAD))

    adapter.lichess(
        FRENCH,
        speeds=("blitz", "rapid"),
        ratings=(1600, 1800),
        moves=15,
        top_games=8,
        token=TOKEN,
    )

    params = dict(route.calls.last.request.url.params)
    assert params["variant"] == "standard"
    assert params["speeds"] == "blitz,rapid"
    assert params["ratings"] == "1600,1800"
    # The page shows the top games and nothing else, so the second list is not paid for.
    assert params["recentGames"] == "0"


@respx.mock
def test_a_lent_client_is_used_and_left_open() -> None:
    """A caller that brings its own client keeps it: only a client this module made is closed."""
    respx.get(MASTERS_URL).mock(return_value=httpx.Response(200, json=MASTERS_PAYLOAD))

    with httpx.Client() as client:
        adapter.masters(FRENCH, moves=5, top_games=2, token=TOKEN, client=client)
        adapter.masters(FRENCH, moves=6, top_games=2, token=TOKEN, client=client)
        assert not client.is_closed


@respx.mock
def test_a_refused_token_is_its_own_error() -> None:
    respx.get(MASTERS_URL).mock(return_value=httpx.Response(401, json={"error": "no"}))

    with pytest.raises(adapter.ReferenceAuthError):
        adapter.masters(FRENCH, moves=12, top_games=4, token="stale")


@respx.mock
def test_a_rate_limit_carries_the_wait_lichess_asked_for() -> None:
    respx.get(MASTERS_URL).mock(
        return_value=httpx.Response(429, headers={"retry-after": "12"}, text="slow down")
    )

    with pytest.raises(adapter.ReferenceRateLimitedError) as raised:
        adapter.masters(FRENCH, moves=12, top_games=4, token=TOKEN)
    assert raised.value.retry_after == 12


@respx.mock
def test_a_rate_limit_without_a_header_still_says_what_happened() -> None:
    respx.get(MASTERS_URL).mock(return_value=httpx.Response(429, text="slow down"))

    with pytest.raises(adapter.ReferenceRateLimitedError) as raised:
        adapter.masters(FRENCH, moves=12, top_games=4, token=TOKEN)
    assert raised.value.retry_after is None


@respx.mock
def test_a_body_that_is_not_json_is_the_database_being_unavailable() -> None:
    respx.get(MASTERS_URL).mock(return_value=httpx.Response(200, text="<html>nope</html>"))

    with pytest.raises(adapter.ReferenceUnavailableError):
        adapter.masters(FRENCH, moves=12, top_games=4, token=TOKEN)


@respx.mock
def test_a_json_body_that_is_not_an_object_is_refused_too() -> None:
    respx.get(MASTERS_URL).mock(return_value=httpx.Response(200, json=[1, 2, 3]))

    with pytest.raises(adapter.ReferenceUnavailableError):
        adapter.masters(FRENCH, moves=12, top_games=4, token=TOKEN)


@respx.mock
def test_a_timeout_is_the_database_being_unavailable() -> None:
    respx.get(MASTERS_URL).mock(side_effect=httpx.ConnectTimeout("took too long"))

    with pytest.raises(adapter.ReferenceUnavailableError):
        adapter.masters(FRENCH, moves=12, top_games=4, token=TOKEN)


@respx.mock
def test_an_upstream_failure_is_the_database_being_unavailable() -> None:
    respx.get(MASTERS_URL).mock(return_value=httpx.Response(503, text="maintenance"))

    with pytest.raises(adapter.ReferenceUnavailableError):
        adapter.masters(FRENCH, moves=12, top_games=4, token=TOKEN)


@respx.mock
def test_a_masters_game_is_fetched_with_the_token_and_a_missing_one_is_a_lookup_error() -> None:
    route = respx.get(MASTERS_PGN_URL).mock(
        return_value=httpx.Response(200, text=MASTERS_GAME_PGN)
    )
    assert adapter.masters_pgn("abcd1234", token=TOKEN).startswith("[Event")
    assert route.calls.last.request.headers["authorization"] == f"Bearer {TOKEN}"

    respx.get("https://explorer.lichess.ovh/masters/pgn/nosuchid").mock(
        return_value=httpx.Response(404, text="")
    )
    with pytest.raises(adapter.UnknownReferenceGameError):
        adapter.masters_pgn("nosuchid", token=TOKEN)


@respx.mock
def test_a_lichess_game_export_is_public_and_asks_for_no_clocks_or_evals() -> None:
    route = respx.get(LICHESS_PGN_URL).mock(
        return_value=httpx.Response(200, text=LICHESS_GAME_PGN)
    )

    adapter.lichess_game_pgn("qg000007")

    request = route.calls.last.request
    assert "authorization" not in request.headers
    assert dict(request.url.params) == {"clocks": "false", "evals": "false"}


@respx.mock
def test_an_empty_export_is_a_game_that_is_not_there() -> None:
    respx.get(LICHESS_PGN_URL).mock(return_value=httpx.Response(200, text="\n"))

    with pytest.raises(adapter.UnknownReferenceGameError):
        adapter.lichess_game_pgn("qg000007")


def test_a_pgn_is_read_as_headers_and_half_moves() -> None:
    game = adapter.parse_game(MASTERS_GAME_PGN)

    assert game["white"] == {"name": "Carlsen, M.", "rating": 2872}
    assert game["black"]["name"] == "Caruana, F."
    assert game["result"] == "1-0"
    assert game["event"] == "Candidates Tournament"
    assert game["date"] == "2013.03.15"
    assert [move["san"] for move in game["moves"]] == ["e4", "e6", "d4", "d5"]
    # Ply counts from zero, as it does everywhere else in Blunderbase.
    assert [move["ply"] for move in game["moves"]] == [0, 1, 2, 3]
    assert game["moves"][0]["uci"] == "e2e4"


def test_a_body_that_is_not_a_pgn_is_the_database_being_unavailable() -> None:
    """python-chess reads almost anything, so "no moves came out" is what junk looks like."""
    with pytest.raises(adapter.ReferenceUnavailableError):
        adapter.parse_game("not a pgn at all")


def test_a_pgn_that_does_not_say_who_played_still_parses() -> None:
    game = adapter.parse_game('[White "?"]\n[Black "?"]\n[Result "*"]\n\n1. e4 e5 *\n')
    assert game["white"] == {"name": "?", "rating": None}
    assert game["event"] is None
    assert [move["san"] for move in game["moves"]] == ["e4", "e5"]


# --- the service -----------------------------------------------------------


def test_without_a_token_there_is_no_reference_database(session: Session) -> None:
    with pytest.raises(reference_service.TokenMissingError):
        reference_service.explore(session, source="masters")


@respx.mock
def test_a_masters_answer_is_folded_into_counts_and_totals(tokened: Session) -> None:
    respx.get(MASTERS_URL).mock(return_value=httpx.Response(200, json=MASTERS_PAYLOAD))

    payload = reference_service.explore(tokened, source="masters", fen=FRENCH)

    assert payload["source"] == "masters"
    assert payload["fen"] == FRENCH_EPD
    assert payload["opening"] == {"eco": "C00", "name": "French Defense"}
    assert payload["totals"] == {"games": 2800, "white": 1200, "draws": 900, "black": 700}
    first = payload["moves"][0]
    assert first["games"] == 1800
    assert first["average_rating"] == 2531
    # A move Lichess sent no rating for says so rather than inventing one.
    assert payload["moves"][1]["average_rating"] is None
    assert [game["id"] for game in payload["top_games"]] == ["abcd1234", "efgh5678"]
    # Null winner is a draw, which is how Lichess says it and how the board reads it.
    assert payload["top_games"][1]["winner"] is None


@respx.mock
def test_the_rated_pools_answer_with_the_opponents_average_rating(tokened: Session) -> None:
    respx.get(LICHESS_URL).mock(return_value=httpx.Response(200, json=LICHESS_PAYLOAD))

    payload = reference_service.explore(
        tokened, source="lichess", speeds=["blitz"], ratings=[1800]
    )

    assert payload["fen"] == START_EPD
    assert payload["opening"] is None
    assert payload["moves"][0]["average_rating"] == 1802
    assert payload["top_games"][0]["speed"] == "blitz"


@respx.mock
def test_a_position_is_asked_for_as_a_full_fen_however_it_was_given(tokened: Session) -> None:
    route = respx.get(MASTERS_URL).mock(return_value=httpx.Response(200, json=MASTERS_PAYLOAD))

    # An EPD in, the same position out, and a FEN the explorer will accept on the wire.
    payload = reference_service.explore(tokened, source="masters", fen=FRENCH_EPD)

    assert payload["fen"] == FRENCH_EPD
    assert route.calls.last.request.url.params["fen"] == f"{FRENCH_EPD} 0 1"


@respx.mock
def test_the_same_lookup_twice_costs_one_request(tokened: Session) -> None:
    route = respx.get(MASTERS_URL).mock(return_value=httpx.Response(200, json=MASTERS_PAYLOAD))

    first = reference_service.explore(tokened, source="masters", fen=FRENCH)
    second = reference_service.explore(tokened, source="masters", fen=FRENCH)

    assert route.call_count == 1
    assert first == second
    # A different position is a different question, and is asked.
    reference_service.explore(tokened, source="masters")
    assert route.call_count == 2


@respx.mock
def test_the_two_sources_never_answer_each_other(tokened: Session) -> None:
    masters = respx.get(MASTERS_URL).mock(return_value=httpx.Response(200, json=MASTERS_PAYLOAD))
    pools = respx.get(LICHESS_URL).mock(return_value=httpx.Response(200, json=LICHESS_PAYLOAD))

    reference_service.explore(tokened, source="masters")
    reference_service.explore(tokened, source="lichess")

    assert masters.call_count == 1
    assert pools.call_count == 1


@respx.mock
def test_a_filter_nobody_knows_is_dropped_rather_than_refused(tokened: Session) -> None:
    route = respx.get(LICHESS_URL).mock(return_value=httpx.Response(200, json=LICHESS_PAYLOAD))

    reference_service.explore(
        tokened,
        source="lichess",
        speeds=["blitz", "hyperbullet"],
        ratings=[1800, 1234, "nonsense"],
    )

    params = dict(route.calls.last.request.url.params)
    assert params["speeds"] == "blitz"
    assert params["ratings"] == "1800"


@respx.mock
def test_the_masters_database_is_not_asked_about_speeds_or_ratings(tokened: Session) -> None:
    route = respx.get(MASTERS_URL).mock(return_value=httpx.Response(200, json=MASTERS_PAYLOAD))

    reference_service.explore(tokened, source="masters", speeds=["blitz"], ratings=[1800])

    params = dict(route.calls.last.request.url.params)
    assert "speeds" not in params
    assert "ratings" not in params


@respx.mock
def test_counts_are_clamped_rather_than_refused(tokened: Session) -> None:
    route = respx.get(MASTERS_URL).mock(return_value=httpx.Response(200, json=MASTERS_PAYLOAD))

    reference_service.explore(tokened, source="masters", limit=500, top_games=90)

    params = dict(route.calls.last.request.url.params)
    assert params["moves"] == str(reference_service.MAX_MOVES)
    assert params["topGames"] == str(reference_service.MAX_TOP_GAMES)


def test_a_source_nobody_has_is_a_value_error(tokened: Session) -> None:
    with pytest.raises(ValueError):
        reference_service.explore(tokened, source="chessdotcom")


def test_an_id_that_is_not_one_is_a_value_error(tokened: Session) -> None:
    with pytest.raises(ValueError):
        reference_service.model_game(tokened, source="lichess", game_id="../../etc/passwd")


@respx.mock
def test_a_lichess_model_game_reads_back_with_its_url(tokened: Session) -> None:
    route = respx.get(LICHESS_PGN_URL).mock(
        return_value=httpx.Response(200, text=LICHESS_GAME_PGN)
    )

    game = reference_service.model_game(tokened, source="lichess", game_id="qg000007")

    assert game["source"] == "lichess"
    assert game["id"] == "qg000007"
    assert game["result"] == "0-1"
    assert [move["san"] for move in game["moves"]] == ["e4", "e6"]
    assert game["lichess_url"] == "https://lichess.org/qg000007"

    # Games never change, so a second read of one is free.
    reference_service.model_game(tokened, source="lichess", game_id="qg000007")
    assert route.call_count == 1


@respx.mock
def test_a_masters_model_game_has_no_lichess_url(tokened: Session) -> None:
    respx.get(MASTERS_PGN_URL).mock(return_value=httpx.Response(200, text=MASTERS_GAME_PGN))

    game = reference_service.model_game(tokened, source="masters", game_id="abcd1234")

    assert game["white"]["name"] == "Carlsen, M."
    assert game["site"] == "London ENG"
    assert game["lichess_url"] is None


@respx.mock
def test_a_masters_game_needs_the_token_and_a_lichess_one_does_not(session: Session) -> None:
    respx.get(LICHESS_PGN_URL).mock(return_value=httpx.Response(200, text=LICHESS_GAME_PGN))

    with pytest.raises(reference_service.TokenMissingError):
        reference_service.model_game(session, source="masters", game_id="abcd1234")
    assert reference_service.model_game(session, source="lichess", game_id="qg000007")["moves"]


def test_the_token_is_stored_stripped_and_cleared_by_an_empty_string(session: Session) -> None:
    assert app_settings_service.get_lichess_token(session) is None
    assert not reference_service.has_token(session)

    app_settings_service.set_lichess_token(session, "  lip_pasted  ")
    assert app_settings_service.get_lichess_token(session) == "lip_pasted"
    assert reference_service.has_token(session)

    app_settings_service.set_lichess_token(session, "   ")
    assert app_settings_service.get_lichess_token(session) is None
    # Cleared is the absence of a row, as it is for every other setting.
    assert session.get(AppSetting, app_settings_service.LICHESS_TOKEN) is None


def test_the_token_survives_a_save_of_the_analysis_form(session: Session) -> None:
    """The settings form rewrites the whole set of keys it knows. This is not one of them."""
    app_settings_service.set_lichess_token(session, TOKEN)
    app_settings_service.replace(session, dict.fromkeys(app_settings_service.KEYS))
    assert app_settings_service.get_lichess_token(session) == TOKEN


# --- the HTTP surface ------------------------------------------------------


@pytest.fixture()
def api(settings: Settings) -> Iterator[TestClient]:
    """The app on an empty library: the reference explorer needs no games of the owner's."""
    settings.analysis_workers = False
    with running_app(create_app(settings)) as client:
        yield client


def error_of(response: Any) -> str:
    return response.json()["error"]


def test_the_token_is_answered_for_but_never_answered_with(api: TestClient) -> None:
    assert api.get("/reference/token").json() == {"configured": False}

    stored = api.put("/reference/token", json={"token": TOKEN})
    assert stored.status_code == 200
    assert stored.json() == {"configured": True}
    assert TOKEN not in api.get("/reference/token").text

    assert api.put("/reference/token", json={"token": None}).json() == {"configured": False}


def test_without_a_token_the_explorer_says_so(api: TestClient) -> None:
    response = api.get("/reference/explorer", params={"source": "masters"})
    assert response.status_code == 409
    assert error_of(response) == "lichess_token_missing"


def test_a_source_that_is_not_one_is_a_422(api: TestClient) -> None:
    assert api.get("/reference/explorer", params={"source": "chessdotcom"}).status_code == 422


@respx.mock
def test_the_explorer_answers_the_folded_payload(api: TestClient) -> None:
    respx.get(MASTERS_URL).mock(return_value=httpx.Response(200, json=MASTERS_PAYLOAD))
    api.put("/reference/token", json={"token": TOKEN})

    response = api.get(
        "/reference/explorer", params={"source": "masters", "fen": FRENCH, "moves": 5}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "masters"
    assert body["fen"] == FRENCH_EPD
    assert body["totals"]["games"] == 2800
    assert body["moves"][0]["san"] == "d4"
    assert body["top_games"][0]["white"]["name"] == "Carlsen, M."


@respx.mock
def test_the_rated_pools_take_their_filters_as_csv(api: TestClient) -> None:
    route = respx.get(LICHESS_URL).mock(return_value=httpx.Response(200, json=LICHESS_PAYLOAD))
    api.put("/reference/token", json={"token": TOKEN})

    response = api.get(
        "/reference/explorer",
        params={"source": "lichess", "speeds": "blitz,rapid", "ratings": "1800,2000"},
    )

    assert response.status_code == 200
    params = dict(route.calls.last.request.url.params)
    assert params["speeds"] == "blitz,rapid"
    assert params["ratings"] == "1800,2000"


@respx.mock
def test_a_refused_token_is_a_409_the_page_can_act_on(api: TestClient) -> None:
    respx.get(MASTERS_URL).mock(return_value=httpx.Response(403, text="nope"))
    api.put("/reference/token", json={"token": "stale"})

    response = api.get("/reference/explorer", params={"source": "masters"})
    assert response.status_code == 409
    assert error_of(response) == "lichess_token_rejected"


@respx.mock
def test_a_rate_limit_is_a_429_carrying_the_wait(api: TestClient) -> None:
    respx.get(MASTERS_URL).mock(
        return_value=httpx.Response(429, headers={"retry-after": "30"}, text="slow down")
    )
    api.put("/reference/token", json={"token": TOKEN})

    response = api.get("/reference/explorer", params={"source": "masters"})
    assert response.status_code == 429
    assert error_of(response) == "reference_rate_limited"
    assert response.headers["retry-after"] == "30"


@respx.mock
def test_an_upstream_failure_is_a_502(api: TestClient) -> None:
    respx.get(MASTERS_URL).mock(return_value=httpx.Response(500, text="oops"))
    api.put("/reference/token", json={"token": TOKEN})

    response = api.get("/reference/explorer", params={"source": "masters"})
    assert response.status_code == 502
    assert error_of(response) == "reference_unavailable"


@respx.mock
def test_a_model_game_is_answered_read_only(api: TestClient) -> None:
    respx.get(LICHESS_PGN_URL).mock(return_value=httpx.Response(200, text=LICHESS_GAME_PGN))

    response = api.get("/reference/games/lichess/qg000007")

    assert response.status_code == 200
    body = response.json()
    assert body["moves"][0] == {"ply": 0, "uci": "e2e4", "san": "e4"}
    assert body["lichess_url"] == "https://lichess.org/qg000007"
    # Read-only means read-only: the library still holds nothing.
    assert api.get("/games").json()["total"] == 0


@respx.mock
def test_a_game_neither_database_has_is_a_404(api: TestClient) -> None:
    respx.get("https://lichess.org/game/export/nosuchid").mock(
        return_value=httpx.Response(404, text="")
    )

    response = api.get("/reference/games/lichess/nosuchid")
    assert response.status_code == 404
    assert error_of(response) == "not_found"


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


async def test_the_reference_tools_are_registered_and_describe_themselves(
    coach: MCPServer,
) -> None:
    async with Client(coach) as client:
        listing = (await client.list_tools()).tools
    tools = {tool.name: tool for tool in listing}

    for name in ("reference_explorer", "get_reference_game"):
        assert name in tools
        assert tools[name].description and len(tools[name].description) > 40
    # The coach has to be told these are not the owner's own games.
    assert "opening_explorer" in tools["reference_explorer"].description
    assert set(tools["get_reference_game"].input_schema.get("required", ())) == {
        "source",
        "game_id",
    }


@respx.mock
async def test_the_coach_reads_the_masters_database(
    coach: MCPServer, sessions: sessionmaker[Session]
) -> None:
    respx.get(MASTERS_URL).mock(return_value=httpx.Response(200, json=MASTERS_PAYLOAD))
    with sessions() as session:
        app_settings_service.set_lichess_token(session, TOKEN)

    payload = await call(coach, "reference_explorer", source="masters", fen=FRENCH)

    assert payload["source"] == "masters"
    assert payload["totals"]["games"] == 2800
    assert payload["moves"][0]["san"] == "d4"


@respx.mock
async def test_the_coach_opens_a_model_game(
    coach: MCPServer, sessions: sessionmaker[Session]
) -> None:
    respx.get(LICHESS_PGN_URL).mock(return_value=httpx.Response(200, text=LICHESS_GAME_PGN))

    payload = await call(coach, "get_reference_game", source="lichess", game_id="qg000007")

    assert payload["id"] == "qg000007"
    assert [move["san"] for move in payload["moves"]] == ["e4", "e6"]


async def test_a_coach_with_no_token_is_told_to_ask_for_one(coach: MCPServer) -> None:
    payload = await failure(coach, "reference_explorer", source="masters")
    assert payload["error"] == "reference_token_missing"
    assert "token" in payload["message"]


async def test_a_source_the_coach_invented_is_a_structured_error(coach: MCPServer) -> None:
    payload = await failure(coach, "reference_explorer", source="chessbase")
    assert payload["error"] == "bad_argument"
    assert payload["allowed"] == ["masters", "lichess"]

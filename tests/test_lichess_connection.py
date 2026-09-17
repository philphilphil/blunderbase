"""Connect Lichess: the sign-in, the connection it stores, and the live import it opens.

The adapter half checks what is sent to Lichess; the HTTP half walks a sign-in through
`/lichess/connect` and the callback with Lichess mocked; the worker half feeds a scripted
event stream to the live import and watches which syncs it asks for.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
from collections.abc import AsyncIterator, Callable, Iterator
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.adapters import lichess_oauth
from backend.api.app import create_app
from backend.api.events import EventBroker
from backend.config import Settings
from backend.db.enums import Platform
from backend.db.models import Account
from backend.services import app_settings as app_settings_service
from backend.services import lichess_connection as connection_service
from backend.services.lichess_connection import LiveTarget
from backend.workers.lichess_live import LichessLive
from tests.conftest import running_app

TOKEN = "lio_signed_in"
REDIRECT = "http://127.0.0.1:8765/api/lichess/callback"


@pytest.fixture(autouse=True)
def _fresh_connection() -> Iterator[None]:
    connection_service._reset()
    yield
    connection_service._reset()


@pytest.fixture()
def api(settings: Settings) -> Iterator[TestClient]:
    settings.analysis_workers = False
    with running_app(create_app(settings)) as client:
        yield client


def start(api: TestClient, **body: Any) -> dict[str, list[str]]:
    response = api.post("/lichess/connect", json={"redirect_uri": REDIRECT, **body})
    assert response.status_code == 200, response.text
    return parse_qs(urlsplit(response.json()["url"]).query)


def mock_lichess(username: str = "Phib") -> respx.Route:
    token = respx.post(lichess_oauth.TOKEN_URL).mock(
        return_value=httpx.Response(200, json={"access_token": TOKEN, "token_type": "Bearer"})
    )
    respx.get(lichess_oauth.ACCOUNT_URL).mock(
        return_value=httpx.Response(200, json={"id": username.lower(), "username": username})
    )
    return token


# --- the adapter -----------------------------------------------------------


def test_the_approval_url_carries_an_s256_challenge_of_the_verifier() -> None:
    verifier = lichess_oauth.new_verifier()
    url = lichess_oauth.authorize_url(redirect_uri=REDIRECT, state="s", verifier=verifier)
    query = parse_qs(urlsplit(url).query)

    digest = hashlib.sha256(verifier.encode()).digest()
    assert query["code_challenge"] == [base64.urlsafe_b64encode(digest).rstrip(b"=").decode()]
    assert query["code_challenge_method"] == ["S256"]
    assert query["scope"] == ["challenge:read"]
    assert query["redirect_uri"] == [REDIRECT]
    assert len(verifier) >= 43


def test_only_a_game_finish_names_a_game() -> None:
    finish = {"type": "gameFinish", "game": {"gameId": "abcd1234", "fullId": "abcd1234wxyz"}}
    assert lichess_oauth.finished_game_id(finish) == "abcd1234"
    assert lichess_oauth.finished_game_id({"type": "gameStart", "game": {"gameId": "x"}}) is None
    assert lichess_oauth.finished_game_id({"type": "challenge"}) is None


# --- the sign-in over http -------------------------------------------------


@respx.mock
def test_a_sign_in_stores_the_token_and_whose_it_is(api: TestClient) -> None:
    exchange = mock_lichess()
    query = start(api, return_to="/explorer?tab=masters")

    # The browser coming back has no session: the state is what lets it in.
    api.cookies.clear()
    response = api.get(
        "/lichess/callback",
        params={"code": "liu_code", "state": query["state"][0]},
        follow_redirects=False,
    )

    assert response.status_code == 303
    assert response.headers["location"] == "/explorer?tab=masters&lichess=connected"
    sent = parse_qs(exchange.calls.last.request.content.decode())
    assert sent["grant_type"] == ["authorization_code"]
    assert sent["redirect_uri"] == [REDIRECT]
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(sent["code_verifier"][0].encode()).digest()
    ).rstrip(b"=").decode()
    assert query["code_challenge"] == [challenge]


@respx.mock
def test_the_connection_answers_whose_token_but_never_the_token(
    settings: Settings, api: TestClient
) -> None:
    mock_lichess()
    query = start(api)
    api.get("/lichess/callback", params={"code": "c", "state": query["state"][0]})

    body = api.get("/lichess/connection").json()
    assert body == {"connected": True, "username": "Phib", "synced": False, "stream": "off"}
    assert TOKEN not in api.get("/lichess/connection").text
    assert api.get("/reference/token").json() == {"configured": True}


@respx.mock
def test_a_state_is_used_once(api: TestClient) -> None:
    mock_lichess()
    state = start(api)["state"][0]
    api.get("/lichess/callback", params={"code": "c", "state": state})

    again = api.get(
        "/lichess/callback", params={"code": "c", "state": state}, follow_redirects=False
    )
    assert again.headers["location"] == "/?lichess=expired"


def test_an_unknown_state_stores_nothing(api: TestClient) -> None:
    response = api.get(
        "/lichess/callback", params={"code": "c", "state": "forged"}, follow_redirects=False
    )
    assert response.headers["location"] == "/?lichess=expired"
    assert api.get("/lichess/connection").json()["connected"] is False


def test_declining_on_lichess_comes_back_as_denied(api: TestClient) -> None:
    state = start(api, return_to="/import")["state"][0]
    response = api.get(
        "/lichess/callback",
        params={"error": "access_denied", "state": state},
        follow_redirects=False,
    )
    assert response.headers["location"] == "/import?lichess=denied"


@respx.mock
def test_the_desktop_app_gets_a_page_to_close_in_the_browser_s_language(
    api: TestClient,
) -> None:
    mock_lichess()
    state = start(api, desktop=True)["state"][0]
    api.cookies.clear()

    response = api.get(
        "/lichess/callback",
        params={"code": "c", "state": state},
        headers={"accept-language": "de-DE,de;q=0.9"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "als Phib mit Lichess verbunden" in response.text


def test_a_sign_in_cannot_be_turned_into_a_redirect_elsewhere(api: TestClient) -> None:
    for return_to in ("https://evil.example/", "//evil.example/"):
        response = api.post(
            "/lichess/connect", json={"redirect_uri": REDIRECT, "return_to": return_to}
        )
        assert response.status_code == 422
    bad = api.post("/lichess/connect", json={"redirect_uri": "javascript:alert(1)"})
    assert bad.status_code == 422


def test_starting_a_sign_in_needs_a_session(api: TestClient) -> None:
    api.cookies.clear()
    assert api.post("/lichess/connect", json={"redirect_uri": REDIRECT}).status_code == 401


@respx.mock
def test_disconnecting_forgets_the_token_and_revokes_it(api: TestClient) -> None:
    mock_lichess()
    revoke = respx.delete(lichess_oauth.TOKEN_URL).mock(return_value=httpx.Response(204))
    state = start(api)["state"][0]
    api.get("/lichess/callback", params={"code": "c", "state": state})

    assert api.delete("/lichess/connection").status_code == 204

    assert revoke.calls.last.request.headers["authorization"] == f"Bearer {TOKEN}"
    assert api.get("/lichess/connection").json()["connected"] is False
    assert api.get("/reference/token").json() == {"configured": False}


# --- what the stream follows -----------------------------------------------


def test_a_pasted_token_keeps_the_explorer_but_not_a_name(session: Session) -> None:
    app_settings_service.set_lichess_connection(session, TOKEN, "Phib")
    app_settings_service.set_lichess_token(session, "lip_pasted")

    assert app_settings_service.get_lichess_token(session) == "lip_pasted"
    assert app_settings_service.get_lichess_username(session) is None
    assert connection_service.live_target(session) is None


def test_the_stream_follows_a_signed_in_account_the_library_syncs(session: Session) -> None:
    app_settings_service.set_lichess_connection(session, TOKEN, "Phib")
    assert connection_service.live_target(session) is None

    session.add(Account(platform=Platform.LICHESS, username="phib", is_owner=True))
    session.commit()
    assert connection_service.live_target(session) == LiveTarget(token=TOKEN, username="phib")
    assert connection_service.connection(session)["synced"] is True

    app_settings_service.set_disabled_sync_sources(session, ["lichess"])
    assert connection_service.live_target(session) is None


# --- the worker ------------------------------------------------------------


def scripted(events: list[dict[str, Any]], *, error: Exception | None = None) -> Callable[..., Any]:
    """A stream that opens, sends `events`, then stays open until cancelled."""

    async def stream(
        token: str, *, on_open: Callable[[], None] | None = None
    ) -> AsyncIterator[dict[str, Any]]:
        if error is not None:
            raise error
        if on_open is not None:
            on_open()
        for event in events:
            yield event
        await asyncio.Event().wait()

    return stream


async def eventually(check: Callable[[], bool]) -> None:
    for _ in range(200):
        if check():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("condition never held")


def finish(game_id: str) -> dict[str, Any]:
    return {"type": "gameFinish", "game": {"gameId": game_id}}


async def test_finished_games_sync_the_account_once_per_burst(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    synced: list[str] = []
    target = LiveTarget(token=TOKEN, username="phib")
    monkeypatch.setattr(LichessLive, "_target", lambda self: target)
    monkeypatch.setattr(LichessLive, "_sync", lambda self, username: synced.append(username))

    stream = scripted([{"type": "gameStart"}, finish("a"), finish("b")])
    worker = LichessLive(
        settings=settings, broker=EventBroker(), stream=stream, settle_seconds=0.05
    )
    await worker.start()
    try:
        await eventually(lambda: connection_service.stream_state() == "live")
        await eventually(lambda: synced == ["phib"])
        await asyncio.sleep(0.1)
        assert synced == ["phib"]
    finally:
        await worker.stop()
    assert connection_service.stream_state() == "off"


async def test_a_refused_token_is_not_asked_again(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = 0
    target = LiveTarget(token=TOKEN, username="phib")
    monkeypatch.setattr(LichessLive, "_target", lambda self: target)
    refused = scripted([], error=lichess_oauth.LichessTokenRejectedError("no"))

    def counting(*args: Any, **kwargs: Any) -> Any:
        nonlocal calls
        calls += 1
        return refused(*args, **kwargs)

    worker = LichessLive(settings=settings, broker=EventBroker(), stream=counting)
    await worker.start()
    try:
        await eventually(lambda: connection_service.stream_state() == "rejected")
        await asyncio.sleep(0.1)
        assert calls == 1
    finally:
        await worker.stop()


async def test_nothing_is_followed_without_a_target(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(LichessLive, "_target", lambda self: None)

    def never(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("the stream was opened with nothing to follow")

    worker = LichessLive(settings=settings, broker=EventBroker(), stream=never)
    await worker.start()
    await asyncio.sleep(0.05)
    await worker.stop()
    assert connection_service.stream_state() == "off"


def test_the_serve_process_runs_the_live_import(settings: Settings) -> None:
    settings.analysis_workers = False
    app = create_app(settings)
    with running_app(app):
        assert isinstance(app.state.lichess_live, LichessLive)
        assert app.state.lichess_live.running
    assert app.state.lichess_live is None

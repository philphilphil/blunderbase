"""The door: the credential, the sessions it opens, and what is refused without one.

The service half runs against the in-memory database; the HTTP half drives the real app
through `TestClient`, because the interesting part of a cookie is the attributes the
browser will read off it.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import timedelta

import pytest
from alembic import command
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session
from starlette.websockets import WebSocketDisconnect

from backend.api.app import create_app
from backend.api.auth import COOKIE_NAME, WS_CLOSE_UNAUTHORIZED
from backend.config import MAIA_MAX_RATING, Settings
from backend.db.migrate import alembic_config, upgrade_to_head
from backend.db.models import AuthSession, Credential
from backend.db.session import get_engine, get_sessionmaker
from backend.db.types import utcnow
from backend.services import app_settings as app_settings_service
from backend.services import auth as auth_service
from tests.conftest import OWNER_PASSWORD, running_app

PASSWORD = "correct-horse-battery"
OTHER = "a-different-password"
SERVER_CAPABILITIES = {
    "password_auth": True,
    "mcp": True,
    "remote_runners": True,
    "read_only": False,
}

# Every router, by a path that answers on an empty database.
ROUTE_FAMILIES = (
    "/games",
    "/accounts",
    "/import/jobs",
    "/analysis/queue",
    "/explorer",
    "/stats/dimensions",
    "/engines",
    "/notes",
    "/live",
    "/settings",
    "/streams",
    # The plural is the owner's CRUD and is guarded; `/runner` (singular) is the runners'
    # own transport and is not. The two must never be read as one prefix.
    "/runners",
)

INDEX = "<!doctype html><title>Blunderbase</title><div id=root></div>"


@pytest.fixture()
def unconfigured(settings: Settings) -> Iterator[TestClient]:
    """A deployment nobody has been through first-run setup on."""
    settings.analysis_workers = False
    with running_app(create_app(settings), password=None) as client:
        yield client


@pytest.fixture()
def signed_in(settings: Settings) -> Iterator[TestClient]:
    settings.analysis_workers = False
    with running_app(create_app(settings)) as client:
        yield client


# --- the credential --------------------------------------------------------


def test_an_empty_database_is_the_setup_required_state(session: Session) -> None:
    assert auth_service.setup_required(session) is True
    assert auth_service.verify_password(session, PASSWORD) is False


def test_the_password_is_stored_as_a_salted_hash_and_never_as_itself(session: Session) -> None:
    auth_service.set_password(session, PASSWORD)

    credential = session.scalars(select(Credential)).one()
    assert credential.algorithm == "scrypt"
    assert PASSWORD not in credential.password_hash
    assert len(credential.salt) == auth_service.SALT_BYTES * 2
    # The cost parameters travel with the row, so they can be raised later.
    assert (credential.scrypt_n, credential.scrypt_r, credential.scrypt_p) == (
        auth_service.SCRYPT_N,
        auth_service.SCRYPT_R,
        auth_service.SCRYPT_P,
    )
    assert auth_service.verify_password(session, PASSWORD) is True
    assert auth_service.verify_password(session, PASSWORD.upper()) is False


def test_two_credentials_get_different_hashes_from_the_same_password(session: Session) -> None:
    auth_service.set_password(session, PASSWORD)
    first = session.scalars(select(Credential)).one().password_hash
    auth_service.reset_password(session, PASSWORD)

    assert session.scalars(select(Credential)).one().password_hash != first


def test_a_second_setup_is_refused(session: Session) -> None:
    """The first-run race guard: two browsers must not both get to name the password."""
    auth_service.set_password(session, PASSWORD)

    with pytest.raises(auth_service.AlreadyConfiguredError):
        auth_service.set_password(session, OTHER)

    assert auth_service.verify_password(session, PASSWORD) is True


def test_a_password_shorter_than_the_minimum_is_refused(session: Session) -> None:
    with pytest.raises(auth_service.WeakPasswordError):
        auth_service.set_password(session, "a" * (auth_service.MIN_PASSWORD_LENGTH - 1))

    assert auth_service.setup_required(session) is True


def test_changing_the_password_needs_the_old_one(session: Session) -> None:
    auth_service.set_password(session, PASSWORD)

    with pytest.raises(auth_service.InvalidPasswordError):
        auth_service.change_password(session, OTHER, "another-password")
    auth_service.change_password(session, PASSWORD, OTHER)

    assert auth_service.verify_password(session, OTHER) is True
    assert auth_service.verify_password(session, PASSWORD) is False


def test_a_reset_replaces_whatever_was_there(session: Session) -> None:
    """What `blunderbase set-password` does for an owner who has locked themselves out."""
    auth_service.set_password(session, PASSWORD)
    auth_service.reset_password(session, OTHER)

    assert auth_service.verify_password(session, OTHER) is True


# --- the lockout -----------------------------------------------------------


def test_the_door_closes_after_enough_consecutive_failures(session: Session) -> None:
    auth_service.set_password(session, PASSWORD)

    for _ in range(auth_service.LOCKOUT_THRESHOLD):
        assert auth_service.verify_password(session, OTHER) is False

    with pytest.raises(auth_service.LockedOutError) as caught:
        auth_service.verify_password(session, PASSWORD)
    assert caught.value.retry_after > 0


def test_the_backoff_doubles_and_stops_at_the_cap() -> None:
    threshold = auth_service.LOCKOUT_THRESHOLD
    assert auth_service._backoff(threshold) == auth_service.LOCKOUT_BASE
    assert auth_service._backoff(threshold + 1) == auth_service.LOCKOUT_BASE * 2
    # Capped, so a stranger hammering `/mcp` cannot lock the owner out indefinitely.
    assert auth_service._backoff(threshold + 40) == auth_service.LOCKOUT_MAX


def test_a_success_clears_the_counter(session: Session) -> None:
    auth_service.set_password(session, PASSWORD)
    for _ in range(auth_service.LOCKOUT_THRESHOLD - 1):
        auth_service.verify_password(session, OTHER)

    assert auth_service.verify_password(session, PASSWORD) is True

    credential = session.scalars(select(Credential)).one()
    assert credential.failed_attempts == 0
    assert credential.locked_until is None
    assert credential.last_login_at is not None


def test_the_door_opens_again_when_the_backoff_has_run_out(session: Session) -> None:
    auth_service.set_password(session, PASSWORD)
    for _ in range(auth_service.LOCKOUT_THRESHOLD):
        auth_service.verify_password(session, OTHER)

    credential = session.scalars(select(Credential)).one()
    credential.locked_until = utcnow() - timedelta(seconds=1)
    session.commit()

    assert auth_service.verify_password(session, PASSWORD) is True


# --- sessions --------------------------------------------------------------


def test_a_session_token_is_stored_only_as_its_hash(session: Session) -> None:
    auth_service.set_password(session, PASSWORD)
    token = auth_service.create_session(session)

    stored = session.scalars(select(AuthSession)).one()
    assert token not in stored.token_hash
    assert auth_service.validate_session(session, token) is True
    assert auth_service.validate_session(session, token + "x") is False
    assert auth_service.validate_session(session, None) is False


def test_a_session_that_has_run_out_is_not_one(session: Session) -> None:
    auth_service.set_password(session, PASSWORD)
    token = auth_service.create_session(session)
    stored = session.scalars(select(AuthSession)).one()
    stored.expires_at = utcnow() - timedelta(seconds=1)
    session.commit()

    assert auth_service.validate_session(session, token) is False
    assert auth_service.open_session_count(session) == 0


def test_using_a_session_slides_its_expiry(session: Session) -> None:
    auth_service.set_password(session, PASSWORD)
    token = auth_service.create_session(session)
    stored = session.scalars(select(AuthSession)).one()
    # Older than the refresh threshold, so the next use is worth a write.
    stale = utcnow() - auth_service.SESSION_REFRESH_AFTER - timedelta(minutes=1)
    stored.last_seen_at = stale
    stored.expires_at = stale + auth_service.SESSION_TTL
    session.commit()
    was = stored.expires_at

    assert auth_service.validate_session(session, token) is True
    session.refresh(stored)
    assert stored.expires_at > was


def test_expired_sessions_are_pruned_when_a_new_one_is_opened(session: Session) -> None:
    auth_service.set_password(session, PASSWORD)
    auth_service.create_session(session)
    session.scalars(select(AuthSession)).one().expires_at = utcnow() - timedelta(days=1)
    session.commit()

    auth_service.create_session(session)

    assert auth_service.open_session_count(session) == 1


def test_a_password_change_ends_every_session(session: Session) -> None:
    auth_service.set_password(session, PASSWORD)
    first = auth_service.create_session(session)
    second = auth_service.create_session(session)

    auth_service.change_password(session, PASSWORD, OTHER)

    assert auth_service.validate_session(session, first) is False
    assert auth_service.validate_session(session, second) is False


def test_one_session_can_be_revoked_without_the_others(session: Session) -> None:
    auth_service.set_password(session, PASSWORD)
    first = auth_service.create_session(session)
    second = auth_service.create_session(session)

    assert auth_service.revoke_session(session, first) is True
    assert auth_service.revoke_session(session, first) is False
    assert auth_service.validate_session(session, second) is True


# --- the HTTP surface ------------------------------------------------------


def test_setup_is_required_until_a_password_is_chosen(unconfigured: TestClient) -> None:
    assert unconfigured.get("/auth/status").json() == {
        "setup_required": True,
        "authenticated": False,
        "capabilities": SERVER_CAPABILITIES,
        "maia_target_elo": MAIA_MAX_RATING,
        "maia_elos": [MAIA_MAX_RATING],
    }

    response = unconfigured.post("/auth/setup", json={"password": PASSWORD})

    assert response.status_code == 200
    assert response.json() == {
        "setup_required": False,
        "authenticated": True,
        "capabilities": SERVER_CAPABILITIES,
        "maia_target_elo": MAIA_MAX_RATING,
        "maia_elos": [MAIA_MAX_RATING],
    }
    assert unconfigured.get("/auth/status").json() == {
        "setup_required": False,
        "authenticated": True,
        "capabilities": SERVER_CAPABILITIES,
        "maia_target_elo": MAIA_MAX_RATING,
        "maia_elos": [MAIA_MAX_RATING],
    }


def test_the_status_carries_the_deployments_maia_target_elo(settings: Settings) -> None:
    """The page has this payload before it renders anything, so the Maia panel can pick
    the stored level nearest the target without waiting on `/settings` to answer."""
    settings.analysis_workers = False
    upgrade_to_head(settings)
    with get_sessionmaker(settings)() as session:
        app_settings_service.set_maia_target_elo(session, 1700)
    with running_app(create_app(settings)) as client:
        assert client.get("/auth/status").json()["maia_target_elo"] == 1700
        assert client.post("/auth/login", json={"password": OWNER_PASSWORD}).json() == {
            "setup_required": False,
            "authenticated": True,
            "capabilities": SERVER_CAPABILITIES,
            "maia_target_elo": 1700,
            "maia_elos": [1700],
        }


def test_setup_signs_the_browser_in_on_the_spot(unconfigured: TestClient) -> None:
    assert unconfigured.get("/games").status_code == 401
    unconfigured.post("/auth/setup", json={"password": PASSWORD})
    assert unconfigured.get("/games").status_code == 200


def test_a_second_setup_over_http_is_a_conflict(signed_in: TestClient) -> None:
    response = signed_in.post("/auth/setup", json={"password": OTHER})

    assert response.status_code == 409
    assert response.json()["error"] == "already_configured"


def test_a_password_below_the_minimum_is_a_named_refusal(unconfigured: TestClient) -> None:
    response = unconfigured.post("/auth/setup", json={"password": "short"})

    assert response.status_code == 422
    assert response.json()["error"] == "weak_password"
    assert unconfigured.get("/auth/status").json()["setup_required"] is True


def test_an_api_call_before_setup_says_so_rather_than_saying_unauthorized(
    unconfigured: TestClient,
) -> None:
    """The distinguishable body is how the page knows to show setup, not login."""
    response = unconfigured.get("/games")

    assert response.status_code == 401
    assert response.json()["error"] == "setup_required"


def test_signing_in_sets_a_session_cookie_the_browser_cannot_read(
    settings: Settings,
) -> None:
    settings.analysis_workers = False
    with running_app(create_app(settings), password=None) as client:
        client.post("/auth/setup", json={"password": PASSWORD})
        client.cookies.clear()
        response = client.post("/auth/login", json={"password": PASSWORD})

        header = response.headers["set-cookie"]
        assert header.startswith(f"{COOKIE_NAME}=")
        assert "HttpOnly" in header
        assert "SameSite=lax" in header
        assert "Path=/" in header
        # Loopback, so `Secure` would make the browser drop it over plain HTTP.
        assert "Secure" not in header
        assert client.get("/games").status_code == 200


def test_the_cookie_is_secure_anywhere_that_is_not_loopback(signed_in: TestClient) -> None:
    response = signed_in.post(
        "http://blunderbase.example/auth/login", json={"password": OWNER_PASSWORD}
    )

    assert "Secure" in response.headers["set-cookie"]


def test_a_wrong_password_is_refused_without_saying_how_wrong(signed_in: TestClient) -> None:
    response = signed_in.post("/auth/login", json={"password": OTHER})

    assert response.status_code == 401
    assert response.json()["error"] == "invalid_password"


def test_logging_in_before_setup_is_a_conflict(unconfigured: TestClient) -> None:
    response = unconfigured.post("/auth/login", json={"password": PASSWORD})

    assert response.status_code == 409
    assert response.json()["error"] == "setup_required"


def test_enough_wrong_passwords_close_the_door(signed_in: TestClient) -> None:
    for _ in range(auth_service.LOCKOUT_THRESHOLD):
        assert signed_in.post("/auth/login", json={"password": OTHER}).status_code == 401

    response = signed_in.post("/auth/login", json={"password": OWNER_PASSWORD})

    assert response.status_code == 429
    assert response.json()["error"] == "locked_out"


def test_logging_out_clears_the_cookie_and_the_session(signed_in: TestClient) -> None:
    response = signed_in.post("/auth/logout")

    assert response.status_code == 204
    assert COOKIE_NAME not in signed_in.cookies
    assert signed_in.get("/games").status_code == 401
    # A browser that was never signed in is not told it was not.
    assert signed_in.post("/auth/logout").status_code == 204


def test_changing_the_password_over_http_keeps_this_browser_and_drops_the_others(
    settings: Settings,
) -> None:
    settings.analysis_workers = False
    app = create_app(settings)
    with running_app(app) as first, running_app(app, password=None) as second:
        second.post("/auth/login", json={"password": OWNER_PASSWORD})
        assert second.get("/games").status_code == 200

        response = first.post(
            "/auth/password", json={"current": OWNER_PASSWORD, "new": "a-brand-new-password"}
        )

        assert response.status_code == 200
        # The browser that made the change is handed a fresh session; the other is out.
        assert first.get("/games").status_code == 200
        assert second.get("/games").status_code == 401
        signed_in_again = second.post("/auth/login", json={"password": "a-brand-new-password"})
        assert signed_in_again.status_code == 200


def test_changing_the_password_needs_the_current_one_over_http(signed_in: TestClient) -> None:
    response = signed_in.post("/auth/password", json={"current": OTHER, "new": "another-password"})

    assert response.status_code == 401
    assert response.json()["error"] == "invalid_password"
    assert signed_in.get("/games").status_code == 200


def test_a_new_password_below_the_minimum_is_refused(signed_in: TestClient) -> None:
    response = signed_in.post("/auth/password", json={"current": OWNER_PASSWORD, "new": "short"})

    assert response.status_code == 422
    assert response.json()["error"] == "weak_password"


# --- what the guard covers -------------------------------------------------


@pytest.mark.parametrize("path", ROUTE_FAMILIES)
def test_every_route_family_needs_a_session(signed_in: TestClient, path: str) -> None:
    with_cookie = signed_in.get(path)
    signed_in.cookies.clear()
    without = signed_in.get(path)

    assert with_cookie.status_code == 200
    assert without.status_code == 401
    assert without.json()["error"] == "unauthorized"


@pytest.mark.parametrize("path", ROUTE_FAMILIES)
def test_the_prefixed_spelling_is_guarded_too(signed_in: TestClient, path: str) -> None:
    """The browser talks to `/api/*`; the guard sees the path after the prefix comes off."""
    signed_in.cookies.clear()

    assert signed_in.get(f"/api{path}").status_code == 401


def test_a_write_is_guarded_as_well_as_a_read(signed_in: TestClient) -> None:
    signed_in.cookies.clear()

    assert signed_in.post("/notes", json={"text": "written by a stranger"}).status_code == 401


def test_an_unknown_path_is_refused_before_it_is_a_404(signed_in: TestClient) -> None:
    """Which routes exist is not something an unauthenticated caller gets to map."""
    signed_in.cookies.clear()

    assert signed_in.get("/api/nope").status_code == 401


def test_the_healthcheck_answers_without_a_cookie(unconfigured: TestClient) -> None:
    """The container's healthcheck has no cookie jar, and runs before setup."""
    assert unconfigured.get("/health").json() == {"status": "ok"}


def test_the_page_loads_without_a_cookie_so_it_can_show_the_login_screen(
    settings: Settings,
) -> None:
    assert settings.web_dist is not None
    (settings.web_dist / "assets").mkdir(parents=True)
    (settings.web_dist / "index.html").write_text(INDEX)
    (settings.web_dist / "assets" / "app-1234.js").write_text("console.log('blunderbase')")
    settings.analysis_workers = False

    with running_app(create_app(settings), password=None) as client:
        assert client.get("/").text == INDEX
        assert client.get("/assets/app-1234.js").status_code == 200
        # A client-side route reached by a reload is still the page's.
        assert client.get("/games/7").text == INDEX
        # And the data behind it is still not.
        assert client.get("/api/games").status_code == 401


def test_the_events_socket_is_refused_without_a_cookie(signed_in: TestClient) -> None:
    """Accepted and then closed with a code, so the page can tell why it was hung up on."""
    signed_in.cookies.clear()

    with pytest.raises(WebSocketDisconnect) as caught:
        with signed_in.websocket_connect("/events") as socket:
            socket.receive_text()

    assert caught.value.code == WS_CLOSE_UNAUTHORIZED


# --- the shortcut past re-reading a cookie ---------------------------------


def counting_validate(monkeypatch: pytest.MonkeyPatch) -> list[str | None]:
    """Every cookie the guard actually took to the database, as it takes it."""
    calls: list[str | None] = []
    real = auth_service.validate_session

    def counted(session: Session, token: str | None) -> bool:
        calls.append(token)
        return real(session, token)

    monkeypatch.setattr(auth_service, "validate_session", counted)
    return calls


def test_a_confirmed_cookie_is_taken_on_trust_for_the_next_few_seconds(
    signed_in: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two database reads per request is what a refetch storm multiplies. The first request
    of a burst pays them; the rest of it inside the TTL are answered without a Session."""
    looked_up = counting_validate(monkeypatch)

    for _ in range(3):
        assert signed_in.get("/games").status_code == 200

    assert len(looked_up) == 1


def test_a_cookie_the_database_refused_is_never_remembered(
    signed_in: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Only a yes is worth holding: a stranger's cookie costs the read every single time."""
    looked_up = counting_validate(monkeypatch)
    signed_in.cookies.clear()
    signed_in.cookies.set(COOKIE_NAME, "not-a-token-anyone-issued")

    for _ in range(3):
        assert signed_in.get("/games").status_code == 401

    assert len(looked_up) == 3
    assert auth_service.token_recently_validated("not-a-token-anyone-issued") is False


def test_signing_out_ends_the_shortcut_on_the_spot(signed_in: TestClient) -> None:
    """Well inside the TTL, so what shuts the cookie out is the revocation clearing it."""
    token = signed_in.cookies[COOKIE_NAME]
    assert signed_in.get("/games").status_code == 200
    assert auth_service.token_recently_validated(token) is True

    assert signed_in.post("/auth/logout").status_code == 204

    assert auth_service.token_recently_validated(token) is False
    signed_in.cookies.set(COOKIE_NAME, token)
    assert signed_in.get("/games").status_code == 401


def test_changing_the_password_forgets_every_confirmed_cookie(session: Session) -> None:
    auth_service.set_password(session, PASSWORD)
    token = auth_service.create_session(session)
    auth_service.remember_valid_token(token)

    auth_service.change_password(session, PASSWORD, OTHER)

    assert auth_service.token_recently_validated(token) is False


def test_a_note_that_has_run_out_is_not_one(monkeypatch: pytest.MonkeyPatch) -> None:
    """The TTL is the whole of the revocation lag another process can leave behind."""
    monkeypatch.setattr(auth_service, "VALID_TOKEN_TTL_SECONDS", 0.0)
    auth_service.remember_valid_token("a-token-from-a-moment-ago")

    assert auth_service.token_recently_validated("a-token-from-a-moment-ago") is False


# --- the migration ---------------------------------------------------------


def test_the_credential_tables_survive_a_migration_round_trip(settings: Settings) -> None:
    upgrade_to_head(settings)
    config = alembic_config(settings)

    command.downgrade(config, "0002")
    tables = set(inspect(get_engine(settings)).get_table_names())
    assert {"credentials", "auth_sessions"}.isdisjoint(tables)
    assert "games" in tables

    command.upgrade(config, "head")
    with get_sessionmaker(settings)() as session:
        auth_service.set_password(session, PASSWORD)
        assert auth_service.verify_password(session, PASSWORD) is True

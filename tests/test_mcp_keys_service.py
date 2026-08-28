from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy.orm import Session

from backend.db.models import McpKey
from backend.db.types import utcnow
from backend.services import auth as auth_service
from backend.services import mcp_keys as mcp_keys_service
from backend.services.mcp_keys import DuplicateMcpKeyError, McpKeyValidationError

PASSWORD = "the-owners-own-password"


def test_a_minted_token_carries_the_prefix_and_hashes_stably() -> None:
    token = mcp_keys_service.mint_token()

    assert token.startswith(mcp_keys_service.TOKEN_PREFIX)
    assert len(token) > len(mcp_keys_service.TOKEN_PREFIX) + 32
    assert mcp_keys_service.token_hash(token) == mcp_keys_service.token_hash(token)
    assert mcp_keys_service.token_hash(token) != mcp_keys_service.token_hash(token + "x")


def test_a_new_key_is_handed_a_token_the_database_never_keeps(session: Session) -> None:
    key, token = mcp_keys_service.create_key(session, "  claude desktop ")

    assert key.name == "claude desktop"
    assert key.key_hash == mcp_keys_service.token_hash(token)
    assert key.last_used_at is None
    stored = session.get(McpKey, key.id)
    assert token not in [stored.name, stored.key_hash]
    assert token not in mcp_keys_service.key_payload(stored).values()
    assert "key_hash" not in mcp_keys_service.key_payload(stored)


def test_two_keys_never_share_a_token(session: Session) -> None:
    _first, one = mcp_keys_service.create_key(session, "one")
    _second, two = mcp_keys_service.create_key(session, "two")

    assert one != two


def test_a_name_is_taken_once(session: Session) -> None:
    mcp_keys_service.create_key(session, "laptop")

    with pytest.raises(DuplicateMcpKeyError):
        mcp_keys_service.create_key(session, " laptop ")


@pytest.mark.parametrize("name", ["", "   ", "x" * 65])
def test_a_name_that_does_not_hold_up_is_refused(session: Session, name: str) -> None:
    with pytest.raises(McpKeyValidationError):
        mcp_keys_service.create_key(session, name)


def test_keys_are_listed_and_looked_up(session: Session) -> None:
    first, _ = mcp_keys_service.create_key(session, "first")
    second, _ = mcp_keys_service.create_key(session, "second")

    assert [key.id for key in mcp_keys_service.list_keys(session)] == [first.id, second.id]
    assert mcp_keys_service.get_key(session, second.id) is second
    assert mcp_keys_service.get_key(session, 999) is None


def test_the_token_it_was_given_opens_the_door(session: Session) -> None:
    _key, token = mcp_keys_service.create_key(session, "laptop")

    assert mcp_keys_service.authenticate(session, token) is True


@pytest.mark.parametrize("token", [None, "", "bb_mcp_nobody-minted-this", "nearly"])
def test_a_token_nobody_minted_is_refused(session: Session, token: str | None) -> None:
    mcp_keys_service.create_key(session, "laptop")

    assert mcp_keys_service.authenticate(session, token) is False


def test_a_good_token_stamps_last_used_and_only_once_a_minute(session: Session) -> None:
    key, token = mcp_keys_service.create_key(session, "laptop")

    assert mcp_keys_service.authenticate(session, token)
    first = session.get(McpKey, key.id).last_used_at
    assert first is not None

    # Seconds later: the row is not touched again.
    assert mcp_keys_service.authenticate(session, token)
    assert session.get(McpKey, key.id).last_used_at == first

    # A stale stamp is moved.
    stale = utcnow() - timedelta(minutes=5)
    key.last_used_at = stale
    session.commit()
    assert mcp_keys_service.authenticate(session, token)
    assert session.get(McpKey, key.id).last_used_at > stale


def test_a_bad_token_leaves_last_used_alone(session: Session) -> None:
    key, _token = mcp_keys_service.create_key(session, "laptop")

    assert not mcp_keys_service.authenticate(session, "bb_mcp_wrong")
    assert session.get(McpKey, key.id).last_used_at is None


def test_a_revoked_key_stops_working(session: Session) -> None:
    key, token = mcp_keys_service.create_key(session, "laptop")

    assert mcp_keys_service.delete_key(session, key.id) is True
    assert mcp_keys_service.authenticate(session, token) is False
    assert mcp_keys_service.delete_key(session, key.id) is False


# --- through the bearer check the transport uses ------------------------------


def test_verify_bearer_accepts_a_key_and_still_the_password(session: Session) -> None:
    auth_service.set_password(session, PASSWORD)
    _key, token = mcp_keys_service.create_key(session, "laptop")

    assert auth_service.verify_bearer(session, token) is True
    assert auth_service.verify_bearer(session, PASSWORD) is True
    assert auth_service.verify_bearer(session, "bb_mcp_wrong") is False


def test_a_key_does_not_count_against_the_password_limiter(session: Session) -> None:
    auth_service.set_password(session, PASSWORD)
    _key, token = mcp_keys_service.create_key(session, "laptop")

    for _ in range(auth_service.LOCKOUT_THRESHOLD + 2):
        assert auth_service.verify_bearer(session, token)

    # Had every key check been a password check, the door would be shut by now.
    assert auth_service.verify_password(session, PASSWORD) is True


def test_a_key_works_before_a_password_exists_in_the_service(session: Session) -> None:
    """The service does not care; the transport is what refuses a keyless, passwordless
    deployment, and a key cannot be minted there anyway."""
    _key, token = mcp_keys_service.create_key(session, "laptop")

    assert auth_service.verify_bearer(session, token) is True

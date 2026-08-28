"""MCP bearer keys: the owner's revocable alternative to pasting the password into a client.

An `McpKey` row is one client's way through the `/mcp` bearer guard. The password still
works there — a fresh deployment needs nothing else — but a key is what the owner reaches
for once more than one coach configuration wants in, because it can be deleted without
signing every browser out. The design is `services/runners.py`'s token, not
`services/auth.py`'s password:

- **The token is the identity, the name is a label.** `bb_mcp_` and 32 random bytes,
  shown exactly once; the name is for the list on the Settings page and for knowing which
  row to revoke.
- **Stored as a SHA-256, compared in constant time.** There is nothing to brute-force in
  32 random bytes, so no scrypt, and the hash is what the lookup keys on — the token itself
  never appears in a query.
- **`authenticate` answers yes or no, never a stack trace.** The guard has one thing to
  say to a caller it does not recognise, and `verify_bearer` in `services/auth.py` tries
  a key before falling back to the password, so a wrong key still ends at the password
  limiter rather than bypassing it.
- **`last_used_at` is stamped sparingly.** An MCP client makes many requests a second;
  writing on each would be a write per request for a number the owner reads at a
  minute's granularity at best. Older than `LAST_USED_GRANULARITY`, or never set, is
  when it is written.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.db.models import McpKey
from backend.db.types import utcnow

# `bb_mcp_` so a token found in a client config says what it opens. 32 random bytes behind
# it, url-safe because it travels in an `Authorization` header.
TOKEN_PREFIX = "bb_mcp_"
TOKEN_BYTES = 32

MAX_NAME_LENGTH = 64

LAST_USED_GRANULARITY = timedelta(seconds=60)


class McpKeyError(RuntimeError):
    """Anything the key surface reports instead of a stack trace."""


class McpKeyValidationError(McpKeyError, ValueError):
    """The request itself is wrong: no name, or a name already taken."""


class DuplicateMcpKeyError(McpKeyValidationError):
    """A key of that name already exists."""


class UnknownMcpKeyError(McpKeyError, LookupError):
    """No key with that id."""


# --- the registry ----------------------------------------------------------


def list_keys(session: Session) -> list[McpKey]:
    """Every key, oldest first."""
    return list(session.scalars(select(McpKey).order_by(McpKey.id)))


def get_key(session: Session, key_id: int) -> McpKey | None:
    return session.get(McpKey, key_id)


def require_key(session: Session, key_id: int) -> McpKey:
    key = get_key(session, key_id)
    if key is None:
        raise UnknownMcpKeyError(f"no MCP key with id {key_id}")
    return key


def create_key(session: Session, name: str) -> tuple[McpKey, str]:
    """Mint a key. The token is returned here and never again."""
    checked = _valid_name(session, name)
    token = mint_token()
    key = McpKey(name=checked, key_hash=token_hash(token))
    session.add(key)
    session.commit()
    return key, token


def delete_key(session: Session, key_id: int) -> bool:
    """Revoke a key. The next request carrying it is a 401."""
    key = get_key(session, key_id)
    if key is None:
        return False
    session.delete(key)
    session.commit()
    return True


def mint_token() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(TOKEN_BYTES)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# --- authentication --------------------------------------------------------


def authenticate(session: Session, token: str | None) -> bool:
    """Whether this bearer token is a key the owner minted. Never raises."""
    if not token:
        return False
    digest = token_hash(token)
    key = session.scalars(select(McpKey).where(McpKey.key_hash == digest)).first()
    # The digest is what is stored, so the comparison never touches the token itself; the
    # constant-time one is what keeps a near-miss from being measurably nearer.
    if key is None or not hmac.compare_digest(key.key_hash, digest):
        return False
    now = utcnow()
    if key.last_used_at is None or now - key.last_used_at >= LAST_USED_GRANULARITY:
        key.last_used_at = now
        session.commit()
    return True


# --- reading ---------------------------------------------------------------


def key_payload(key: McpKey) -> dict[str, Any]:
    """One key as the API reports it. Never the hash: it is a lookup column, not a fact."""
    return {
        "id": key.id,
        "name": key.name,
        "created_at": key.created_at.isoformat(),
        "last_used_at": None if key.last_used_at is None else key.last_used_at.isoformat(),
    }


def _valid_name(session: Session, name: str) -> str:
    checked = (name or "").strip()
    if not checked:
        raise McpKeyValidationError("an MCP key needs a name")
    if len(checked) > MAX_NAME_LENGTH:
        raise McpKeyValidationError(f"an MCP key name is at most {MAX_NAME_LENGTH} characters")
    if session.scalar(select(McpKey.id).where(McpKey.name == checked)) is not None:
        raise DuplicateMcpKeyError(f"an MCP key named {checked!r} already exists")
    return checked

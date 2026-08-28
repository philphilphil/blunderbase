"""One owner, one password, and the sessions it opens.

There is no user table and no registration flow: the `Credential` row *is* the account,
and its absence is the setup-required state the UI routes to on first run. Everything an
`api/` handler, the MCP transport or the CLI needs to know about authentication is a
function here — the invariant that keeps the browser and the coach agreeing about what a
"blunder" is holds for what a valid password is too.

Three decisions worth keeping in mind:

- **The password is never stored.** `hashlib.scrypt` over a per-credential random salt,
  with the cost parameters written onto the row, so raising them later re-hashes on the
  next password change instead of invalidating the one that exists. Comparison is
  `hmac.compare_digest`, so a wrong password tells nobody how wrong it was.
- **A session token is stored hashed too.** The cookie carries 32 random bytes; the
  database carries their SHA-256. A copy of the database is therefore not a way in.
- **Failures are counted, not thrown away.** Five consecutive wrong passwords shut the
  door for a few seconds, and each further failure doubles that up to `LOCKOUT_MAX`. The
  cap is deliberate: the counter is shared with the MCP bearer check, and a stranger
  hammering `/mcp` must not be able to lock the owner out of their own browser for longer
  than one short window.

The MCP bearer check also accepts the keys the owner mints in `services/mcp_keys.py`; see
`verify_bearer` for the order.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from backend.db.models import AuthSession, Credential
from backend.db.types import utcnow
from backend.services import mcp_keys

MIN_PASSWORD_LENGTH = 8

# scrypt at RFC 7914's interactive-login parameters: ~16 MB and tens of milliseconds per
# attempt, which is the point — it is what makes an offline guess of a stolen hash slow.
ALGORITHM = "scrypt"
SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 64
SCRYPT_MAXMEM = 64 * 1024 * 1024
SALT_BYTES = 16

SESSION_TOKEN_BYTES = 32
SESSION_TTL = timedelta(days=30)
# The expiry slides, but a write per request would be a write per request. A day's
# granularity is invisible against a thirty-day window.
SESSION_REFRESH_AFTER = timedelta(days=1)

LOCKOUT_THRESHOLD = 5
LOCKOUT_BASE = timedelta(seconds=5)
LOCKOUT_MAX = timedelta(minutes=5)


class AuthError(Exception):
    """Anything the door refused."""


class AlreadyConfiguredError(AuthError):
    """A password is already set, so this is not a first run."""


class WeakPasswordError(AuthError, ValueError):
    """The password offered is shorter than `MIN_PASSWORD_LENGTH`."""


class InvalidPasswordError(AuthError):
    """The password offered is not the owner's."""


class LockedOutError(AuthError):
    """Too many consecutive failures; the backoff is still in force."""

    def __init__(self, retry_after: int) -> None:
        self.retry_after = retry_after
        super().__init__(f"too many failed attempts; try again in {retry_after} seconds")


# --- the credential --------------------------------------------------------


def setup_required(session: Session) -> bool:
    """Whether the owner still has to choose a password. True is the first-run state."""
    return _credential(session) is None


def set_password(session: Session, password: str) -> None:
    """Choose the owner's password, on a database that has none.

    Refusing when a credential exists is the first-run race guard: two browsers reaching
    an unconfigured deployment at once must not both get to name the password.
    """
    if _credential(session) is not None:
        raise AlreadyConfiguredError("a password has already been set")
    reset_password(session, password)


def reset_password(session: Session, password: str) -> None:
    """Store a password whether or not there was one, and sign every browser out.

    This is what `blunderbase set-password` and a password change both do; only the
    first-run route needs the "there must be none yet" guard `set_password` adds.
    """
    if len(password) < MIN_PASSWORD_LENGTH:
        raise WeakPasswordError(
            f"the password has to be at least {MIN_PASSWORD_LENGTH} characters"
        )
    salt = secrets.token_bytes(SALT_BYTES)
    credential = _credential(session)
    if credential is None:
        credential = Credential()
        session.add(credential)
    credential.algorithm = ALGORITHM
    credential.salt = salt.hex()
    credential.password_hash = _derive(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P).hex()
    credential.scrypt_n = SCRYPT_N
    credential.scrypt_r = SCRYPT_R
    credential.scrypt_p = SCRYPT_P
    credential.updated_at = utcnow()
    credential.failed_attempts = 0
    credential.locked_until = None
    session.execute(delete(AuthSession))
    session.commit()


def verify_password(session: Session, password: str) -> bool:
    """Whether this is the owner's password, counting the failure if it is not.

    Raises `LockedOutError` while the backoff from earlier failures is still running —
    the answer then is neither yes nor no, and the caller has to say so.
    """
    credential = _credential(session)
    if credential is None:
        return False
    now = utcnow()
    if credential.locked_until is not None and credential.locked_until > now:
        raise LockedOutError(_seconds_until(credential.locked_until, now))
    matched = _matches(credential, password)
    _record_attempt(session, credential, matched=matched, now=now)
    return matched


def change_password(session: Session, current: str, new: str) -> None:
    """Swap the password, ending every session that was opened with the old one."""
    if not verify_password(session, current):
        raise InvalidPasswordError("the current password is not right")
    reset_password(session, new)


def verify_bearer(session: Session, token: str) -> bool:
    """Whether an MCP bearer token opens the door: a minted key first, else the password.

    Keys (`services/mcp_keys.py`) are tried first because they are the cheap check — one
    hash and one indexed read — and because a matching key must not cost a failed attempt
    on the password's limiter. Anything that is not a key falls through to the password,
    which is what a fresh deployment has and what a `bb_mcp_`-less token can only be.

    Never raises. A locked-out credential answers "no" rather than "not now": the transport
    has one thing to say to a caller it does not recognise, and it is 401.
    """
    if not token:
        return False
    if mcp_keys.authenticate(session, token):
        return True
    try:
        return verify_password(session, token)
    except LockedOutError:
        return False


# --- sessions --------------------------------------------------------------


def create_session(session: Session, *, now: datetime | None = None) -> str:
    """Open a session and hand back its token. Only the token's hash is kept."""
    moment = now or utcnow()
    prune_sessions(session, now=moment)
    token = secrets.token_urlsafe(SESSION_TOKEN_BYTES)
    session.add(
        AuthSession(
            token_hash=_token_hash(token),
            created_at=moment,
            last_seen_at=moment,
            expires_at=moment + SESSION_TTL,
        )
    )
    session.commit()
    return token


def validate_session(session: Session, token: str | None) -> bool:
    """Whether this cookie is a live session, sliding its expiry when it is."""
    if not token:
        return False
    row = session.scalar(select(AuthSession).where(AuthSession.token_hash == _token_hash(token)))
    if row is None:
        return False
    now = utcnow()
    if row.expires_at <= now:
        session.delete(row)
        session.commit()
        return False
    if now - row.last_seen_at >= SESSION_REFRESH_AFTER:
        row.last_seen_at = now
        row.expires_at = now + SESSION_TTL
        session.commit()
    return True


def revoke_session(session: Session, token: str | None) -> bool:
    """Sign one browser out. Says whether there was a session to end."""
    if not token:
        return False
    removed = session.execute(
        delete(AuthSession).where(AuthSession.token_hash == _token_hash(token))
    ).rowcount
    session.commit()
    return bool(removed)


def revoke_all_sessions(session: Session) -> int:
    """Sign every browser out, this one included. How many were open."""
    removed = session.execute(delete(AuthSession)).rowcount
    session.commit()
    return int(removed)


def prune_sessions(session: Session, *, now: datetime | None = None) -> int:
    """Drop the sessions that have run out. How many were dropped."""
    removed = session.execute(
        delete(AuthSession).where(AuthSession.expires_at <= (now or utcnow()))
    ).rowcount
    session.commit()
    return int(removed)


def open_session_count(session: Session) -> int:
    """How many browsers are signed in."""
    return int(session.scalar(select(func.count()).select_from(AuthSession)) or 0)


# --- internals -------------------------------------------------------------


def _credential(session: Session) -> Credential | None:
    """The one credential row, or None on a database nobody has configured."""
    return session.scalars(select(Credential).order_by(Credential.id).limit(1)).first()


def _derive(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    return hashlib.scrypt(
        password.encode(), salt=salt, n=n, r=r, p=p, dklen=SCRYPT_DKLEN, maxmem=SCRYPT_MAXMEM
    )


def _matches(credential: Credential, password: str) -> bool:
    """Constant-time comparison against the row's own cost parameters."""
    derived = _derive(
        password,
        bytes.fromhex(credential.salt),
        credential.scrypt_n,
        credential.scrypt_r,
        credential.scrypt_p,
    )
    return hmac.compare_digest(derived, bytes.fromhex(credential.password_hash))


def _record_attempt(
    session: Session, credential: Credential, *, matched: bool, now: datetime
) -> None:
    """A success clears the counter; a failure moves it, and may close the door."""
    if matched:
        credential.failed_attempts = 0
        credential.locked_until = None
        credential.last_login_at = now
    else:
        credential.failed_attempts += 1
        if credential.failed_attempts >= LOCKOUT_THRESHOLD:
            credential.locked_until = now + _backoff(credential.failed_attempts)
    session.commit()


def _backoff(failures: int) -> timedelta:
    """Doubling from `LOCKOUT_BASE` at the threshold, and never past `LOCKOUT_MAX`."""
    steps = min(failures - LOCKOUT_THRESHOLD, 20)
    return min(LOCKOUT_BASE * (2**steps), LOCKOUT_MAX)


def _seconds_until(moment: datetime, now: datetime) -> int:
    return max(1, int((moment - now).total_seconds() + 0.999))


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

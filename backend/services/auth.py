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
- **Failures are counted per client address.** Five consecutive wrong passwords shut
  that client's door for a few seconds, doubling up to `LOCKOUT_MAX`. A stranger cannot
  lock the owner's other addresses out. The bounded, process-local counter reserves an
  attempt before hashing, so concurrent guesses spend the same budget.

The MCP bearer check accepts only keys minted in `services/mcp_keys.py`.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.sqlite import insert
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
LOGIN_MAX_CLIENTS = 4096

# How long a token that has just been checked against the database is taken on trust; see
# `remember_valid_token`.
VALID_TOKEN_TTL_SECONDS = 5.0


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
    # A fixed primary key makes this create-only even across processes. In particular,
    # never fall through to reset_password after another request wins the first insert.
    result = session.execute(
        insert(Credential).values(id=1, **_password_values(password)).on_conflict_do_nothing(
            index_elements=[Credential.id]
        )
    )
    if result.rowcount != 1:
        session.rollback()
        raise AlreadyConfiguredError("a password has already been set")
    session.commit()
    forget_valid_tokens()
    reset_login_limiter()


def reset_password(session: Session, password: str) -> None:
    """Store a password whether or not there was one, and sign every browser out.

    This is what `blunderbase set-password` and a password change both do; only the
    first-run route needs the "there must be none yet" guard `set_password` adds.
    """
    values = _password_values(password)
    credential = _credential(session)
    if credential is None:
        credential = Credential()
        session.add(credential)
    for name, value in values.items():
        setattr(credential, name, value)
    session.execute(delete(AuthSession))
    session.commit()
    forget_valid_tokens()
    reset_login_limiter()


def _password_values(password: str) -> dict[str, object]:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise WeakPasswordError(
            f"the password has to be at least {MIN_PASSWORD_LENGTH} characters"
        )
    salt = secrets.token_bytes(SALT_BYTES)
    return {
        "algorithm": ALGORITHM,
        "salt": salt.hex(),
        "password_hash": _derive(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P).hex(),
        "scrypt_n": SCRYPT_N,
        "scrypt_r": SCRYPT_R,
        "scrypt_p": SCRYPT_P,
        "updated_at": utcnow(),
        "failed_attempts": 0,
        "locked_until": None,
    }


def verify_password(session: Session, password: str, *, source: str = "local") -> bool:
    """Verify a password within the requesting client's budget.

    HTTP callers supply the ASGI client address, after the server's trusted-proxy
    handling. Never take an arbitrary forwarded header as the source. Legacy credential
    lockout columns are no longer consulted: upgrading must also free existing lockouts.
    """
    credential = _credential(session)
    if credential is None:
        return False
    attempt = _reserve_login_attempt(source)
    matched = _matches(credential, password)
    if matched:
        with _LOGIN_LIMITER_LOCK:
            if _LOGIN_ATTEMPTS.get(source) is attempt:
                del _LOGIN_ATTEMPTS[source]
        credential.failed_attempts = 0
        credential.locked_until = None
        credential.last_login_at = utcnow()
        session.commit()
    return matched


def change_password(session: Session, current: str, new: str, *, source: str = "local") -> None:
    """Swap the password, ending every session that was opened with the old one."""
    if not verify_password(session, current, source=source):
        raise InvalidPasswordError("the current password is not right")
    reset_password(session, new)


def verify_bearer(session: Session, token: str) -> bool:
    """Accept only a dedicated MCP key; browser passwords never authenticate MCP."""
    return bool(token) and mcp_keys.authenticate(session, token)


# --- the client-address login limiter --------------------------------------


@dataclass
class _LoginAttempts:
    failures: int = 0
    locked_until: float = 0.0
    last_attempt: float = 0.0


_LOGIN_ATTEMPTS: OrderedDict[str, _LoginAttempts] = OrderedDict()
_LOGIN_LIMITER_LOCK = threading.Lock()


def reset_login_limiter() -> None:
    """Clear process-local attempts on setup, password reset, and between tests."""
    with _LOGIN_LIMITER_LOCK:
        _LOGIN_ATTEMPTS.clear()


def _reserve_login_attempt(source: str) -> _LoginAttempts:
    """Reserve before deriving, including in-flight guesses in the backoff.

    Five minutes without an admitted attempt forgets a client's history. Refusals do not
    extend that time. Oldest entries are evicted at the cap so the address map cannot grow
    without bound; the budget is per process, matching the single-process server.
    """
    now = time.monotonic()
    with _LOGIN_LIMITER_LOCK:
        cutoff = now - LOCKOUT_MAX.total_seconds()
        while _LOGIN_ATTEMPTS:
            oldest = next(iter(_LOGIN_ATTEMPTS))
            if _LOGIN_ATTEMPTS[oldest].last_attempt > cutoff:
                break
            del _LOGIN_ATTEMPTS[oldest]
        attempt = _LOGIN_ATTEMPTS.get(source)
        if attempt is not None and attempt.locked_until > now:
            raise LockedOutError(max(1, int(attempt.locked_until - now + 0.999)))
        if attempt is None:
            if len(_LOGIN_ATTEMPTS) >= LOGIN_MAX_CLIENTS:
                _LOGIN_ATTEMPTS.popitem(last=False)
            attempt = _LoginAttempts()
            _LOGIN_ATTEMPTS[source] = attempt
        _LOGIN_ATTEMPTS.move_to_end(source)
        attempt.last_attempt = now
        attempt.failures += 1
        if attempt.failures >= LOCKOUT_THRESHOLD:
            attempt.locked_until = now + _backoff(attempt.failures).total_seconds()
        return attempt


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
    forget_valid_tokens()
    return bool(removed)


def prune_sessions(session: Session, *, now: datetime | None = None) -> int:
    """Drop the sessions that have run out. How many were dropped."""
    removed = session.execute(
        delete(AuthSession).where(AuthSession.expires_at <= (now or utcnow()))
    ).rowcount
    session.commit()
    if removed:
        forget_valid_tokens()
    return int(removed)


def open_session_count(session: Session) -> int:
    """How many browsers are signed in."""
    return int(session.scalar(select(func.count()).select_from(AuthSession)) or 0)


# --- the shortcut past re-reading a token ----------------------------------

# Tokens the database has confirmed, against the monotonic moment it confirmed them.
_VALID_TOKENS: dict[str, float] = {}
_VALID_TOKENS_LOCK = threading.Lock()


def token_recently_validated(token: str | None) -> bool:
    """Whether this exact token was confirmed live less than `VALID_TOKEN_TTL_SECONDS` ago.

    The guard in front of every non-exempt request asks the database twice — is there a
    credential, is this cookie a session — and in a refetch storm that is two reads per
    request through the same worker threads everything else is queueing for. One owner and
    one password is the whole user model here, so a few seconds of revocation lag is a
    cheaper thing to spend than those reads.

    Only successes are ever remembered. A token that is not in here, or whose note has run
    out, costs exactly the round trip it always did, and neither a refusal nor the
    setup-required state is cached at all — the first-run screen must never be answered
    out of a dictionary.
    """
    if not token:
        return False
    with _VALID_TOKENS_LOCK:
        checked_at = _VALID_TOKENS.get(token)
        if checked_at is None:
            return False
        if time.monotonic() - checked_at >= VALID_TOKEN_TTL_SECONDS:
            del _VALID_TOKENS[token]
            return False
        return True


def remember_valid_token(token: str) -> None:
    """Take this token on trust for the next `VALID_TOKEN_TTL_SECONDS`.

    Every revocation in this module — a logout, a password change, a prune that drops an
    expired session — clears the whole cache, so inside this process the note cannot
    outlive what it stands for. Another process (a stdio MCP client, `blunderbase
    set-password`) keeps its own and cannot be told, which is what the TTL is for and why
    it is seconds rather than minutes: the database is the truth, and this is only ever a
    short-lived note that it has just been asked.
    """
    now = time.monotonic()
    with _VALID_TOKENS_LOCK:
        # Evicted here rather than on a timer: the only thing that adds an entry is a
        # successful check, and one owner means a browser or two, not a population.
        for known, checked_at in list(_VALID_TOKENS.items()):
            if now - checked_at >= VALID_TOKEN_TTL_SECONDS:
                del _VALID_TOKENS[known]
        _VALID_TOKENS[token] = now


def forget_valid_tokens() -> None:
    """Drop every note, so the next check of any token goes to the database again."""
    with _VALID_TOKENS_LOCK:
        _VALID_TOKENS.clear()


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


def _backoff(failures: int) -> timedelta:
    """Doubling from `LOCKOUT_BASE` at the threshold, and never past `LOCKOUT_MAX`."""
    steps = min(failures - LOCKOUT_THRESHOLD, 20)
    return min(LOCKOUT_BASE * (2**steps), LOCKOUT_MAX)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

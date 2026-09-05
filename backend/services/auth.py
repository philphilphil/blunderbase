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
  door for a few seconds, and each further failure doubles that up to `LOCKOUT_MAX`. That
  counter is the browser login's alone. The MCP bearer check has its own, a few functions
  down: the row's counter only ever climbs, so a stranger hammering `/mcp` — a door that
  is unauthenticated by design, because the bearer check *is* its authentication — would
  otherwise be able to keep the owner locked out of their own browser for good, one guess
  per backoff window.

The MCP bearer check also accepts the keys the owner mints in `services/mcp_keys.py`; see
`verify_bearer` for the order.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time
from collections import deque
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

# What the `/mcp` bearer door will spend on the password fall-through: ten wrong passwords
# a minute, and then no scrypt derivation at all until the oldest of them ages out. A rate
# rather than a backoff, for the reason `_password_opens_bearer` gives.
BEARER_ATTEMPT_LIMIT = 10
BEARER_ATTEMPT_WINDOW = timedelta(seconds=60)

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
    reset_bearer_limiter()


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
    # The guesses the bearer door refused were guesses at a password that no longer exists.
    reset_bearer_limiter()


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
    on any limiter. Anything that is not a key falls through to the password, which is what
    a fresh deployment has and what a `bb_mcp_`-less token can only be.

    That fall-through is bounded by this door's own budget rather than by the credential
    row's lockout; `_password_opens_bearer` is where that decision is written down.

    Never raises. The transport has one thing to say to a caller it does not recognise,
    and it is 401 — a refusal for want of budget looks exactly like a wrong password.
    """
    if not token:
        return False
    if mcp_keys.authenticate(session, token):
        return True
    return _password_opens_bearer(session, token)


# --- the bearer door's own limiter -----------------------------------------

# The monotonic moments of the password guesses `/mcp` has refused lately. Module state,
# process-local and lost on restart, which is what a bearer-token limiter wants: it is
# about a door standing open right now, not about an account.
_BEARER_FAILURES: deque[float] = deque()
_BEARER_LIMITER_LOCK = threading.Lock()


def _password_opens_bearer(session: Session, token: str) -> bool:
    """Whether this bearer token is the owner's password, on the bearer door's own budget.

    Deliberately not `verify_password`. That counts onto the `Credential` row, whose
    counter only ever climbs and whose lockout is renewed by every further failure, so an
    unauthenticated caller at `/mcp` could hold the owner's browser login shut indefinitely
    with one guess per window. This is `services/runners.py`'s answer in the shape that
    fits here: a limiter of the door's own, which no login route ever reads.

    **It is keyed on the door, not on the presented token.** The secret being guessed is
    one password, so a per-token counter would be free to defeat by varying the token —
    what has to be bounded is how often anybody at all may have a password derived for
    them. Hence a rolling rate: at most `BEARER_ATTEMPT_LIMIT` wrong passwords per
    `BEARER_ATTEMPT_WINDOW`, refused *before* the scrypt derivation, which bounds the
    guessing and the CPU it would cost together. Rolling and not doubling, so unlike the
    row's lockout it cannot be renewed for ever: guesses that stop are forgotten a window
    later, with nothing left behind.

    Sustained guessing does shut this fall-through for as long as it lasts. That is the
    trade, and the two tokens the door tries first are the way round it — a minted key and
    `BLUNDERBASE_MCP_BEARER_KEY` never touch this budget. The browser login is untouched
    either way, which is the whole point.

    No column is written on the way through, so an MCP client is neither a login nor a
    commit per request.
    """
    now = time.monotonic()
    if not _bearer_attempt_allowed(now):
        return False
    credential = _credential(session)
    if credential is None:
        return False
    if _matches(credential, token):
        return True
    _note_bearer_failure(now)
    return False


def reset_bearer_limiter() -> None:
    """Forget the guesses this door has refused. A password change and the tests call this."""
    with _BEARER_LIMITER_LOCK:
        _BEARER_FAILURES.clear()


def _bearer_attempt_allowed(now: float) -> bool:
    """Whether the door still has room for one more derivation, ageing out what has expired."""
    cutoff = now - BEARER_ATTEMPT_WINDOW.total_seconds()
    with _BEARER_LIMITER_LOCK:
        while _BEARER_FAILURES and _BEARER_FAILURES[0] <= cutoff:
            _BEARER_FAILURES.popleft()
        return len(_BEARER_FAILURES) < BEARER_ATTEMPT_LIMIT


def _note_bearer_failure(now: float) -> None:
    """Spend one of the window's attempts on a password that was not the owner's."""
    with _BEARER_LIMITER_LOCK:
        _BEARER_FAILURES.append(now)


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

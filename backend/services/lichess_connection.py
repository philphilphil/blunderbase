"""The owner's Lichess connection: signing in, what it is for, and signing out.

One token does two jobs. The reference explorer needs a token of any kind, and the live
import needs one that can open the owner's event stream and says whose account it is. The
button that replaced the pasted token gets both at once — a Lichess sign-in that asks for
`challenge:read` and remembers the username it came back with.

**A sign-in in flight lives in this process's memory.** The browser leaves for lichess.org
carrying a `state`, and comes back to the callback with it; the verifier that proves the
code is ours, the redirect it was sent to and where the person should land afterwards are
kept here under that state for a few minutes and used once. A restart in between loses
them, and the person presses the button again — a row in the database for something that
lives for as long as it takes to click "Authorize" would outlast every use it has.

The state is also what guards the callback. The callback answers without a session, because
on the desktop app it is the person's own browser coming back and that browser has never
signed in to Blunderbase. Nobody can reach it usefully without a state an owner's signed-in
request created a moment ago.

**Whether the stream is up is the worker's to say** (`workers/lichess_live.py`), and it says
it through `set_stream_state`. It is process state for the same reason the pending sign-ins
are: it describes a connection this process holds, and a restart has none.
"""

from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from backend.adapters import lichess_oauth as adapter
from backend.adapters.lichess_oauth import LichessOAuthError
from backend.db.enums import Platform
from backend.services import accounts, app_settings, events

__all__ = [
    "EVENT_CONNECTION",
    "Completed",
    "LichessOAuthError",
    "LiveTarget",
    "StreamState",
    "begin",
    "complete",
    "connection",
    "disconnect",
    "live_target",
    "set_stream_state",
    "stream_state",
]

EVENT_CONNECTION = "lichess.connection"

# Long enough to find a forgotten Lichess password; a state older than this is refused.
PENDING_TTL_SECONDS = 15 * 60
# A handful of tabs pressing the button at once is plausible; a thousand is somebody
# hammering an authenticated route, and the oldest are dropped rather than kept.
MAX_PENDING = 16

StreamState = Literal["off", "connecting", "live", "rejected"]

# What `complete` tells the callback went wrong, as a word the page can branch on.
Outcome = Literal["connected", "denied", "expired", "failed"]


@dataclass(frozen=True, slots=True)
class _Pending:
    verifier: str
    redirect_uri: str
    return_to: str
    desktop: bool
    created: float


@dataclass(frozen=True, slots=True)
class Completed:
    """How a sign-in ended, and where the browser that finished it should go."""

    outcome: Outcome
    return_to: str
    desktop: bool
    username: str | None = None


@dataclass(frozen=True, slots=True)
class LiveTarget:
    """The token and the account the event stream should be opened for."""

    token: str
    username: str


_pending: dict[str, _Pending] = {}
_lock = threading.Lock()
_stream_state: StreamState = "off"


def begin(*, redirect_uri: str, return_to: str | None, desktop: bool) -> str:
    """Start a sign-in and answer with the Lichess URL to send the browser to.

    `redirect_uri` is the callback as the browser reaches it — through a reverse proxy, on a
    LAN address, on the desktop app's loopback port — which is why the page names it rather
    than this process guessing its own address from headers a proxy may have rewritten.
    `return_to` is a path in the app and nothing else, so the callback cannot be made into a
    redirect to somebody else's site.
    """
    parts = urlsplit(redirect_uri)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ValueError("redirect_uri must be an absolute http or https URL")
    landing = return_to or "/"
    if not landing.startswith("/") or landing.startswith("//"):
        raise ValueError("return_to must be a path inside the app")
    state = secrets.token_urlsafe(24)
    verifier = adapter.new_verifier()
    with _lock:
        _forget_expired()
        while len(_pending) >= MAX_PENDING:
            _pending.pop(next(iter(_pending)))
        _pending[state] = _Pending(
            verifier=verifier,
            redirect_uri=redirect_uri,
            return_to=landing,
            desktop=desktop,
            created=time.monotonic(),
        )
    return adapter.authorize_url(redirect_uri=redirect_uri, state=state, verifier=verifier)


def complete(
    session: Session, *, state: str | None, code: str | None, error: str | None
) -> Completed:
    """Finish a sign-in Lichess has sent the browser back from.

    Never raises for anything Lichess or the person did: pressing "Cancel", a state that
    expired, a code Lichess would not trade — each is an outcome the page shows, because
    the browser arriving here has nowhere else to be told.
    """
    with _lock:
        _forget_expired()
        pending = _pending.pop(state, None) if state else None
    if pending is None:
        return Completed(outcome="expired", return_to="/", desktop=False)
    if error or not code:
        return Completed(outcome="denied", return_to=pending.return_to, desktop=pending.desktop)
    try:
        token = adapter.exchange_code(
            code=code, verifier=pending.verifier, redirect_uri=pending.redirect_uri
        )
        username = adapter.account_username(token)
    except LichessOAuthError:
        return Completed(outcome="failed", return_to=pending.return_to, desktop=pending.desktop)
    app_settings.set_lichess_connection(session, token, username)
    events.emit({"event": EVENT_CONNECTION})
    return Completed(
        outcome="connected",
        return_to=pending.return_to,
        desktop=pending.desktop,
        username=username,
    )


def connection(session: Session) -> dict[str, object]:
    """What the button and the Lichess account box show.

    `connected` is whether a token is stored at all, which is what the explorer needs.
    `username` is only there when it came from signing in — a pasted token keeps the
    explorer working and says nothing about whose it is, which the page reads as "sign in
    once more for live imports". `synced` is whether that account is one the library syncs,
    because the stream only ever reports that account's games.
    """
    username = app_settings.get_lichess_username(session)
    synced = (
        username is not None
        and accounts.find_account(session, Platform.LICHESS, username) is not None
    )
    return {
        "connected": app_settings.get_lichess_token(session) is not None,
        "username": username,
        "synced": synced,
        "stream": stream_state(),
    }


def disconnect(session: Session) -> None:
    """Forget the token here and ask Lichess to revoke it there."""
    token = app_settings.get_lichess_token(session)
    app_settings.set_lichess_connection(session, None, None)
    events.emit({"event": EVENT_CONNECTION})
    if token is not None:
        adapter.revoke(token)


def live_target(session: Session) -> LiveTarget | None:
    """Whose event stream to follow, or None when there is nothing to follow.

    A token from signing in, for a Lichess account the library has, on a source the owner
    has not taken out of syncing. A pasted token is not enough: it may lack the scope, and
    nothing says whose games it would report.
    """
    token = app_settings.get_lichess_token(session)
    username = app_settings.get_lichess_username(session)
    if token is None or username is None:
        return None
    account = accounts.find_account(session, Platform.LICHESS, username)
    if account is None or not account.is_owner:
        return None
    if str(Platform.LICHESS) in app_settings.get_disabled_sync_sources(session):
        return None
    return LiveTarget(token=token, username=account.username)


def stream_state() -> StreamState:
    return _stream_state


def set_stream_state(state: StreamState) -> None:
    """The worker saying how the stream is doing. A change is announced; a repeat is not."""
    global _stream_state
    if state == _stream_state:
        return
    _stream_state = state
    events.emit({"event": EVENT_CONNECTION, "stream": state})


def _forget_expired() -> None:
    cutoff = time.monotonic() - PENDING_TTL_SECONDS
    for state in [key for key, value in _pending.items() if value.created < cutoff]:
        del _pending[state]


def _reset() -> None:
    """Forget every sign-in in flight and the stream's state. Tests call this."""
    global _stream_state
    with _lock:
        _pending.clear()
    _stream_state = "off"

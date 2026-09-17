"""Lichess sign-in and the owner's event stream, as plain data.

"Connect Lichess" is OAuth's authorization code flow with PKCE, which Lichess offers to
clients nobody registered: any client id, no secret, and the verifier standing in for the
secret. That is what lets a self-hosted install and the desktop app use it at all — there is
no one address to register, and no secret a person could lift out of an image.

Everything here is a request and an answer. Where the pending sign-in is kept, where the
token ends up and what a finished game sets off are the service's and the worker's; this
module builds a URL, trades a code, asks who a token belongs to and reads the stream.
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
from collections.abc import AsyncIterator, Callable
from typing import Any
from urllib.parse import urlencode

import httpx

AUTHORIZE_URL = "https://lichess.org/oauth"
TOKEN_URL = "https://lichess.org/api/token"
ACCOUNT_URL = "https://lichess.org/api/account"
EVENTS_URL = "https://lichess.org/api/stream/event"

# Any unique id will do; Lichess shows the redirect's origin on its approval page, not this.
CLIENT_ID = "blunderbase"
# The explorer needs a token and no scope; the event stream needs this one. It reads as
# "Read incoming challenges" on the approval page, which is the narrowest scope that opens
# the stream — `board:play` and `bot:play` would also open it and ask for far more.
SCOPES = ("challenge:read",)

USER_AGENT = "Blunderbase"
TIMEOUT = httpx.Timeout(15.0)
# The stream sends an empty line every seven seconds, so a read that waits much longer than
# that is a connection that died without saying so.
STREAM_TIMEOUT = httpx.Timeout(connect=15.0, read=30.0, write=15.0, pool=15.0)


class LichessOAuthError(RuntimeError):
    """Lichess did not complete the sign-in, or did not answer the way it documents."""


class LichessTokenRejectedError(LichessOAuthError):
    """The token was refused: revoked, expired after its year, or missing the scope."""


class LichessStreamRateLimitedError(LichessOAuthError):
    """Too many stream connections; Lichess asks for a full minute before the next."""


def new_verifier() -> str:
    """A PKCE code verifier: 64 url-safe characters, well above the 43 Lichess requires."""
    return secrets.token_urlsafe(48)


def challenge_for(verifier: str) -> str:
    """The S256 challenge, the only method Lichess accepts."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def authorize_url(*, redirect_uri: str, state: str, verifier: str) -> str:
    """Where the browser is sent to approve Blunderbase."""
    query = {
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": redirect_uri,
        "scope": " ".join(SCOPES),
        "code_challenge_method": "S256",
        "code_challenge": challenge_for(verifier),
        "state": state,
    }
    return f"{AUTHORIZE_URL}?{urlencode(query)}"


def exchange_code(
    *, code: str, verifier: str, redirect_uri: str, client: httpx.Client | None = None
) -> str:
    """Trade the code Lichess sent back for an access token."""
    form = {
        "grant_type": "authorization_code",
        "code": code,
        "code_verifier": verifier,
        "redirect_uri": redirect_uri,
        "client_id": CLIENT_ID,
    }
    response = _send("POST", TOKEN_URL, client=client, data=form)
    if response.status_code != httpx.codes.OK:
        raise LichessOAuthError(f"lichess refused the sign-in ({response.status_code})")
    token = _json(response).get("access_token")
    if not isinstance(token, str) or not token:
        raise LichessOAuthError("lichess answered the sign-in without a token")
    return token


def account_username(token: str, *, client: httpx.Client | None = None) -> str:
    """The Lichess username a token belongs to."""
    response = _send("GET", ACCOUNT_URL, client=client, token=token)
    if response.status_code == httpx.codes.UNAUTHORIZED:
        raise LichessTokenRejectedError("lichess refused the token")
    if response.status_code != httpx.codes.OK:
        raise LichessOAuthError(f"lichess did not say whose token this is ({response.status_code})")
    username = _json(response).get("username")
    if not isinstance(username, str) or not username:
        raise LichessOAuthError("lichess answered without a username")
    return username


def revoke(token: str, *, client: httpx.Client | None = None) -> None:
    """Tell Lichess the token is done with. Best effort: a token already dead is fine."""
    try:
        _send("DELETE", TOKEN_URL, client=client, token=token)
    except LichessOAuthError:
        return


async def stream_events(
    token: str,
    *,
    on_open: Callable[[], None] | None = None,
    client: httpx.AsyncClient | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Every event Lichess sends the token's owner, for as long as the connection holds.

    `on_open` is called once Lichess has accepted the connection, which may be a long time
    before the first event: a quiet stream is only keep-alive lines, and those are swallowed.
    A line that is not JSON is skipped rather than ending the stream. The iterator ends when
    Lichess closes the connection, which is the caller's cue to reconnect.
    """
    owned = client is None
    http = client or httpx.AsyncClient(timeout=STREAM_TIMEOUT)
    try:
        async with http.stream("GET", EVENTS_URL, headers=_headers(token)) as response:
            if response.status_code == httpx.codes.UNAUTHORIZED:
                raise LichessTokenRejectedError("lichess refused the token")
            if response.status_code == httpx.codes.TOO_MANY_REQUESTS:
                raise LichessStreamRateLimitedError("lichess is rate limiting the event stream")
            if response.status_code != httpx.codes.OK:
                raise LichessOAuthError(
                    f"lichess refused the event stream ({response.status_code})"
                )
            if on_open is not None:
                on_open()
            async for line in response.aiter_lines():
                if not line.strip():
                    continue
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                if isinstance(event, dict):
                    yield event
    finally:
        if owned:
            await http.aclose()


def finished_game_id(event: dict[str, Any]) -> str | None:
    """The game a `gameFinish` event is about, or None for every other event."""
    if event.get("type") != "gameFinish":
        return None
    game = event.get("game")
    if not isinstance(game, dict):
        return None
    game_id = game.get("gameId") or game.get("id")
    return str(game_id) if game_id else None


def _headers(token: str | None) -> dict[str, str]:
    headers = {"user-agent": USER_AGENT}
    if token:
        headers["authorization"] = f"Bearer {token}"
    return headers


def _send(
    method: str,
    url: str,
    *,
    client: httpx.Client | None,
    token: str | None = None,
    data: dict[str, str] | None = None,
) -> httpx.Response:
    http = client or httpx.Client(timeout=TIMEOUT)
    try:
        return http.request(method, url, headers=_headers(token), data=data)
    except httpx.HTTPError as exc:
        raise LichessOAuthError(f"could not reach lichess: {exc}") from exc
    finally:
        if client is None:
            http.close()


def _json(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError as exc:
        raise LichessOAuthError("lichess answered with something that is not JSON") from exc
    return payload if isinstance(payload, dict) else {}

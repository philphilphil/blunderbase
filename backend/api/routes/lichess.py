"""`/lichess` — the owner's Lichess sign-in, over `services.lichess_connection`.

Four routes. `POST /lichess/connect` starts a sign-in and answers with the Lichess page to
send the browser to; `GET /lichess/callback` is where Lichess sends it back; `GET` and
`DELETE /lichess/connection` read and end the connection.

The callback is the one route here without a session (`api/auth.py` exempts it): on the
desktop app the browser coming back is the person's own, which has never signed in to
Blunderbase. The single-use state the service checks is what stands in for the session.
It answers a browser rather than a fetch, so it is the one route here that is not JSON: in
the web app a redirect back to where the button was pressed, with `?lichess=` saying how it
went, and on the desktop app a short page saying to go back to the app — a redirect there
would open Blunderbase in a browser that cannot sign in to it.
"""

from __future__ import annotations

from html import escape
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import APIRouter, Request, Response, status
from fastapi.responses import HTMLResponse, RedirectResponse

from backend.api.deps import SessionDep
from backend.api.schemas import LichessConnection, LichessConnectRequest, LichessConnectStarted
from backend.services import lichess_connection as connection_service

router = APIRouter(prefix="/lichess", tags=["lichess"])

# The desktop page, in the two languages the app speaks. It is the one screen served
# outside the web app, so it cannot use the app's catalogs; which language is read off the
# browser's own `Accept-Language`.
PAGE_TEXT: dict[str, dict[str, str]] = {
    "en": {
        "connected": "Blunderbase is connected to Lichess as {username}.",
        "denied": "Lichess was not connected, because the request was declined.",
        "expired": "This sign-in has expired. Press Connect Lichess in Blunderbase again.",
        "failed": "Lichess could not complete the sign-in. Try again in Blunderbase.",
        "close": "You can close this tab and go back to Blunderbase.",
    },
    "de": {
        "connected": "Blunderbase ist jetzt als {username} mit Lichess verbunden.",
        "denied": "Lichess wurde nicht verbunden, weil die Anfrage abgelehnt wurde.",
        "expired": "Diese Anmeldung ist abgelaufen. Drücke in Blunderbase noch einmal "
        "„Mit Lichess verbinden“.",
        "failed": "Lichess konnte die Anmeldung nicht abschließen. Versuche es in "
        "Blunderbase noch einmal.",
        "close": "Du kannst diesen Tab schließen und zu Blunderbase zurückkehren.",
    },
}


@router.get("/connection", response_model=LichessConnection, summary="The Lichess sign-in")
def get_connection(session: SessionDep) -> Any:
    """Whether a token is stored, whose it is, and whether the live stream is up."""
    return connection_service.connection(session)


@router.delete(
    "/connection", status_code=status.HTTP_204_NO_CONTENT, summary="Disconnect Lichess"
)
def delete_connection(session: SessionDep) -> Response:
    """Forget the token and revoke it on Lichess. The explorer and live import stop."""
    connection_service.disconnect(session)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/connect", response_model=LichessConnectStarted, summary="Start a Lichess sign-in")
def connect(body: LichessConnectRequest) -> LichessConnectStarted:
    """Answer with the Lichess approval page for this browser to go to."""
    url = connection_service.begin(
        redirect_uri=body.redirect_uri, return_to=body.return_to, desktop=body.desktop
    )
    return LichessConnectStarted(url=url)


@router.get("/callback", include_in_schema=False)
def callback(
    request: Request,
    session: SessionDep,
    state: str | None = None,
    code: str | None = None,
    error: str | None = None,
) -> Response:
    completed = connection_service.complete(session, state=state, code=code, error=error)
    if completed.desktop:
        return _page(request, completed)
    return RedirectResponse(
        _with_query(completed.return_to, lichess=completed.outcome),
        status_code=status.HTTP_303_SEE_OTHER,
    )


def _with_query(path: str, **params: str) -> str:
    parts = urlsplit(path)
    query = [(key, value) for key, value in parse_qsl(parts.query) if key not in params]
    query.extend(params.items())
    return urlunsplit(("", "", parts.path, urlencode(query), parts.fragment))


def _page(request: Request, completed: connection_service.Completed) -> HTMLResponse:
    wanted = request.headers.get("accept-language", "").strip().lower()
    language = "de" if wanted.startswith("de") else "en"
    text = PAGE_TEXT[language]
    message = text[completed.outcome].format(username=escape(completed.username or ""))
    body = f"""<!doctype html>
<html lang="{language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blunderbase</title>
<style>
  :root {{ color-scheme: light dark; }}
  body {{ margin: 0; min-height: 100vh; display: grid; place-items: center;
         font: 15px/1.6 system-ui, sans-serif; background: Canvas; color: CanvasText; }}
  main {{ max-width: 28rem; padding: 2rem 1.5rem; }}
  p + p {{ opacity: 0.7; }}
</style>
</head>
<body><main><p>{message}</p><p>{text["close"]}</p></main></body>
</html>"""
    return HTMLResponse(body)

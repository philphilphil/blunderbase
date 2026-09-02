"""Lichess's opening explorer and its game exports, as plain data.

Two databases nobody here owns: the masters database (over two million OTB games between
titled players) and the rated-lichess pools. They are read, never stored — this adapter
hands back dictionaries and the service above it caches them in memory, so nothing from
either database ever reaches the owner's library or their counts.

Three facts shape the code. The explorer endpoints now refuse an anonymous request, so
every call carries the owner's personal API token as a bearer header; the token is the
owner's identity upstream, which is why it is passed in per call rather than read here.
The game exports are two different services — a masters game is PGN from the explorer
host and needs the token, a lichess game is a public export from lichess.org and does not.
And nothing here retries: the caller is a web request or a coach tool, the service above
caches whatever comes back, and a handler that sleeps is a handler holding a worker.
"""

from __future__ import annotations

import io
from collections.abc import Sequence
from typing import Any

import chess
import chess.pgn
import httpx

MASTERS_URL = "https://explorer.lichess.ovh/masters"
LICHESS_URL = "https://explorer.lichess.ovh/lichess"
MASTERS_PGN_URL = "https://explorer.lichess.ovh/masters/pgn/{game_id}"
LICHESS_PGN_URL = "https://lichess.org/game/export/{game_id}"

USER_AGENT = "Blunderbase/0.1 (personal chess database; reference explorer)"
HEADERS = {"accept": "application/json", "user-agent": USER_AGENT}
PGN_HEADERS = {"accept": "application/x-chess-pgn", "user-agent": USER_AGENT}

# Short by the standards of the import adapters, and deliberately: a person is waiting on
# this one with a board in front of them, and the answer is cached the moment it lands.
TIMEOUT = httpx.Timeout(connect=5.0, read=15.0, write=15.0, pool=15.0)


class ReferenceError(RuntimeError):
    """The reference database could not be read."""


class ReferenceAuthError(ReferenceError):
    """Lichess refused the token — missing scopes, revoked, or a typo in the paste."""


class ReferenceRateLimitedError(ReferenceError):
    """Lichess is asking for a pause. `retry_after` is its own number of seconds, if given."""

    def __init__(self, message: str, retry_after: int | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class ReferenceUnavailableError(ReferenceError):
    """A timeout, a 5xx, or a body that was not what the endpoint promised."""


class UnknownReferenceGameError(LookupError):
    """Neither database has a game under that id.

    A `LookupError` rather than a `ReferenceError`: it is the caller naming something that
    is not there, which every layer above already turns into a 404.
    """


def masters(
    fen: str,
    *,
    moves: int,
    top_games: int,
    token: str | None,
    client: httpx.Client | None = None,
) -> dict[str, Any]:
    """The masters database from one position: continuations, totals and its top games."""
    return _json(
        MASTERS_URL,
        {"fen": fen, "moves": moves, "topGames": top_games},
        token=token,
        client=client,
    )


def lichess(
    fen: str,
    *,
    speeds: Sequence[str] = (),
    ratings: Sequence[int] = (),
    moves: int,
    top_games: int,
    token: str | None,
    client: httpx.Client | None = None,
) -> dict[str, Any]:
    """The rated-lichess pools from one position, narrowed to speeds and rating bands.

    Both game lists are asked for. Lichess keeps at most four "top games" (its highest-rated
    games through the position, whatever speeds and ratings were asked for) per position in
    this database, and none at all in the first few moves of a game — so the recent games,
    which it always has and which do honour the filters, are what keeps the list from being
    empty. The service folds the two into one.
    """
    params: dict[str, Any] = {
        "variant": "standard",
        "fen": fen,
        "moves": moves,
        "topGames": top_games,
        "recentGames": top_games,
    }
    if speeds:
        params["speeds"] = ",".join(speeds)
    if ratings:
        params["ratings"] = ",".join(str(rating) for rating in ratings)
    return _json(LICHESS_URL, params, token=token, client=client)


def masters_pgn(
    game_id: str, *, token: str | None, client: httpx.Client | None = None
) -> str:
    """One masters game as PGN. The explorer host serves it, so it wants the token too."""
    return _text(
        MASTERS_PGN_URL.format(game_id=game_id),
        {},
        token=token,
        client=client,
        headers=PGN_HEADERS,
    )


def lichess_game_pgn(game_id: str, *, client: httpx.Client | None = None) -> str:
    """One lichess game as PGN, from the public export — no token, and no clocks or evals.

    Both are switched off because this is a game to play through, not to analyse: the
    reference board reads moves, and Blunderbase's own engines answer everything else.
    The opening tags are asked for, so a game added to the library is named the way
    Lichess names it, like one the owner's own sync brings.
    """
    return _text(
        LICHESS_PGN_URL.format(game_id=game_id),
        {"clocks": "false", "evals": "false", "opening": "true"},
        token=None,
        client=client,
        headers=PGN_HEADERS,
    )


def parse_game(pgn: str) -> dict[str, Any]:
    """A reference game's PGN as the plain payload every surface reads.

    Headers and a move list, and nothing derived: who played, how it ended, and each half
    move as `(ply, uci, san)` with ply counted from zero, the way a game's own moves are
    counted everywhere else in Blunderbase.
    """
    game = chess.pgn.read_game(io.StringIO(pgn))
    if game is None:
        raise ReferenceUnavailableError("the reference database answered with no game")

    board = game.board()
    moves: list[dict[str, Any]] = []
    for ply, move in enumerate(game.mainline_moves()):
        moves.append({"ply": ply, "uci": board.uci(move), "san": board.san(move)})
        board.push(move)
    # python-chess is lenient about what it will read: a body that is not a PGN at all comes
    # back as a game with the default headers and no moves. A reference game always has
    # moves — it is the whole reason to fetch one — so nothing here is the body being junk.
    if not moves:
        raise ReferenceUnavailableError("the reference database answered with no moves")

    headers = game.headers
    return {
        "white": _player(headers.get("White"), headers.get("WhiteElo")),
        "black": _player(headers.get("Black"), headers.get("BlackElo")),
        "result": headers.get("Result") or "*",
        "event": _header(headers.get("Event")),
        "site": _header(headers.get("Site")),
        "date": _header(headers.get("Date")),
        "moves": moves,
    }


# --- internals -------------------------------------------------------------


def _json(
    url: str,
    params: dict[str, Any],
    *,
    token: str | None,
    client: httpx.Client | None,
) -> dict[str, Any]:
    response = _get(url, params, token=token, client=client, headers=HEADERS)
    try:
        payload = response.json()
    except ValueError as exc:
        raise ReferenceUnavailableError(f"the reference database answered junk: {exc}") from None
    if not isinstance(payload, dict):
        raise ReferenceUnavailableError("the reference database answered something else")
    return payload


def _text(
    url: str,
    params: dict[str, Any],
    *,
    token: str | None,
    client: httpx.Client | None,
    headers: dict[str, str],
) -> str:
    text = _get(url, params, token=token, client=client, headers=headers, missing=True).text
    if not text.strip():
        raise UnknownReferenceGameError("the reference database has no game under that id")
    return text


def _get(
    url: str,
    params: dict[str, Any],
    *,
    token: str | None,
    client: httpx.Client | None,
    headers: dict[str, str],
    missing: bool = False,
) -> httpx.Response:
    """One request, once. `missing` says a 404 means "no such game" rather than a failure.

    Every failure below turns into one of this module's own types, so nothing above ever
    has to know that httpx is what fetched this.
    """
    sent = dict(headers)
    if token:
        sent["authorization"] = f"Bearer {token}"
    owned = client is None
    http = client if client is not None else httpx.Client(timeout=TIMEOUT)
    try:
        try:
            response = http.get(url, params=params, headers=sent)
        except httpx.HTTPError as exc:
            raise ReferenceUnavailableError(
                f"the reference database did not answer: {type(exc).__name__}: {exc}"
            ) from None
    finally:
        if owned:
            http.close()

    if response.status_code in (httpx.codes.UNAUTHORIZED, httpx.codes.FORBIDDEN):
        raise ReferenceAuthError(
            "lichess refused the stored token; mint a fresh one and paste it again"
        )
    if response.status_code == httpx.codes.TOO_MANY_REQUESTS:
        raise ReferenceRateLimitedError(
            "lichess is rate limiting the reference explorer; try again shortly",
            _retry_after(response.headers),
        )
    if missing and response.status_code == httpx.codes.NOT_FOUND:
        raise UnknownReferenceGameError("the reference database has no game under that id")
    if response.status_code >= httpx.codes.BAD_REQUEST:
        raise ReferenceUnavailableError(
            f"the reference database answered {response.status_code}"
        )
    return response


def _retry_after(headers: httpx.Headers) -> int | None:
    """Lichess's own number of seconds, when it sent one. A junk header is no header."""
    try:
        seconds = int(float(headers.get("retry-after", "")))
    except (TypeError, ValueError):
        return None
    return seconds if seconds > 0 else None


def _player(name: str | None, rating: str | None) -> dict[str, Any]:
    """A side of a reference game. The name is always something; the rating often is not."""
    return {"name": _header(name) or "?", "rating": _rating(rating)}


def _rating(value: str | None) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _header(value: str | None) -> str | None:
    """A PGN header, with the `?` that means "not recorded" read as nothing recorded."""
    text = (value or "").strip()
    return text if text and text != "?" else None

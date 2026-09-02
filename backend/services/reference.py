"""The reference databases: Lichess's masters archive and its rated pools.

**Reading here never writes the database.** The owner's explorer answers from games they
actually played, and a reference database answering beside it must never leak into that:
a lookup imports no game, creates no position, moves no counter. What comes back is folded
into the same shape the web app and the coach already read and then forgotten, except for
a copy in the process's own memory.

That copy is the cache below. A reference lookup is a network round trip to somebody else's
service, the answers are the same for everyone, and stepping a board through an opening asks
for a dozen positions in a row — so a bounded TTL cache is what keeps the page quick and
keeps Blunderbase a polite client of an API it is a guest on. It is a plain dict behind a
lock rather than anything cleverer: one process, a few hundred entries, and a restart is
allowed to forget all of it.

The one deliberate exception is `import_game`, which is the owner asking for a model game
by name. It goes into the library through the same path a PGN does and is analysed and
annotated like any other game — but it arrives with `Game.is_owner_game` off, which keeps
it out of every statistic and out of the explorer's tree. The wall between the two sides is
kept by that flag rather than by there being no door.

The token is the owner's own Lichess personal API token, read from the settings row every
time it is needed. The explorer endpoints stopped answering anonymous requests, so without
one there is no reference database at all — which is a `TokenMissingError` and a sentence
the page can act on, not an empty tree that would read as "no games here".
"""

from __future__ import annotations

import io
import threading
import time
from collections import OrderedDict
from collections.abc import Sequence
from typing import Any

import chess.pgn
from sqlalchemy.orm import Session

from backend.adapters import openings, pgn_import
from backend.adapters import reference as adapter

# Imported by name as well as through the module so that the API's error table and the
# coach's own can map them without importing an adapter: the layers above this one talk to
# services and to nothing else. `__all__` below is what makes that re-export deliberate.
from backend.adapters.reference import (
    ReferenceAuthError,
    ReferenceError,
    ReferenceRateLimitedError,
    ReferenceUnavailableError,
    UnknownReferenceGameError,
)
from backend.db.enums import Source
from backend.services import app_settings, import_service
from backend.services.explorer import START_EPD, normalize_fen, read_fen
from backend.services.import_service import IngestOutcome, ParsedGame, ProgressHook

# The module's whole surface, the adapter's error types included.
__all__ = [
    "DEFAULT_MOVES",
    "DEFAULT_TOP_GAMES",
    "LICHESS",
    "MASTERS",
    "MAX_MOVES",
    "MAX_TOP_GAMES",
    "RATINGS",
    "ReferenceAuthError",
    "ReferenceError",
    "ReferenceRateLimitedError",
    "ReferenceUnavailableError",
    "SOURCES",
    "SPEEDS",
    "TokenMissingError",
    "UnknownReferenceGameError",
    "explore",
    "import_game",
    "model_game",
]

MASTERS = "masters"
LICHESS = "lichess"
SOURCES = (MASTERS, LICHESS)

# What a board beside a move list can show without scrolling, and the ceiling a caller may
# ask for. Clamped rather than refused, the way every other count in this codebase is.
DEFAULT_MOVES = 15
MAX_MOVES = 30
DEFAULT_TOP_GAMES = 8
MAX_TOP_GAMES = 15

# The speeds Lichess pools its rated games by, keyed by what a caller may type. The value is
# the spelling the API wants, which is the only reason this is a mapping and not a set.
SPEEDS: dict[str, str] = {
    "ultrabullet": "ultraBullet",
    "bullet": "bullet",
    "blitz": "blitz",
    "rapid": "rapid",
    "classical": "classical",
    "correspondence": "correspondence",
}

# Lichess's own rating bands. A number that is not one of these is not a narrower filter,
# it is a filter the API will refuse, so an unknown one is dropped like an unknown speed.
RATINGS = (0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500)

# How long an answer is worth keeping. The masters database grows when a tournament is
# added to it, which is not a thing that happens between two clicks; the rated pools move
# continuously but their numbers are millions of games deep, so six hours changes no
# reading anybody takes off them. A finished game never changes at all.
MASTERS_TTL = 24 * 3600.0
LICHESS_TTL = 6 * 3600.0
GAME_TTL = 7 * 24 * 3600.0

# Entries kept before the oldest is dropped. A stepped-through opening is a few dozen
# positions, so this is several sessions' worth and still a bounded amount of memory.
MAX_ENTRIES = 500

_CACHE: OrderedDict[str, tuple[float, Any]] = OrderedDict()
_LOCK = threading.Lock()


class TokenMissingError(RuntimeError):
    """No Lichess token is stored, and the reference databases will not answer without one."""


def explore(
    session: Session,
    *,
    source: str,
    fen: str | None = None,
    speeds: Sequence[str] = (),
    ratings: Sequence[int | str] = (),
    limit: int = DEFAULT_MOVES,
    top_games: int = DEFAULT_TOP_GAMES,
) -> dict[str, Any]:
    """One position in a reference database: continuations, totals and its top games.

    `speeds` and `ratings` narrow the rated-lichess pools and mean nothing to the masters
    database, so they are dropped there rather than refused. An entry neither Lichess nor
    this module knows is dropped too — a filter the owner mistyped should cost them that
    filter, not the position.
    """
    kind = _source(source)
    asked = (fen or "").strip()
    # The same normalisation the owner's own explorer keys positions by, so the two sides of
    # the page are talking about one position and a cache key cannot spell it two ways.
    epd = normalize_fen(asked)[0] if asked else START_EPD
    wanted_speeds = _speeds(speeds) if kind == LICHESS else ()
    wanted_ratings = _ratings(ratings) if kind == LICHESS else ()
    moves = _clamp(limit, DEFAULT_MOVES, MAX_MOVES)
    top = _clamp(top_games, DEFAULT_TOP_GAMES, MAX_TOP_GAMES)

    key = "|".join(
        (
            kind,
            epd,
            ",".join(wanted_speeds),
            ",".join(str(rating) for rating in wanted_ratings),
            str(moves),
            str(top),
        )
    )
    cached = _cache_get(key)
    if cached is not None:
        return cached

    token = _token(session)
    # The explorer wants a full FEN and keys a lookup on the position alone, so the dropped
    # move counters are put back as the neutral pair rather than carried around.
    position = f"{epd} 0 1"
    if kind == MASTERS:
        raw = adapter.masters(position, moves=moves, top_games=top, token=token)
    else:
        raw = adapter.lichess(
            position,
            speeds=wanted_speeds,
            ratings=wanted_ratings,
            moves=moves,
            top_games=top,
            token=token,
        )

    payload = _fold(raw, source=kind, fen=epd)
    _cache_put(key, payload, MASTERS_TTL if kind == MASTERS else LICHESS_TTL)
    return payload


def model_game(session: Session, *, source: str, game_id: str) -> dict[str, Any]:
    """One reference game, read-only: the headers and every move, from its PGN.

    A masters game comes from the explorer host and needs the owner's token; a lichess game
    comes from the public export and does not, which is why the token is only asked for on
    the branch that spends it.
    """
    kind = _source(source)
    ref = _game_id(game_id)
    key = f"game|{kind}|{ref}"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    if kind == MASTERS:
        pgn = adapter.masters_pgn(ref, token=_token(session))
    else:
        pgn = adapter.lichess_game_pgn(ref)

    parsed = adapter.parse_game(pgn)
    payload = {"source": kind, "id": ref, **parsed, "lichess_url": _lichess_url(kind, ref, parsed)}
    _cache_put(key, payload, GAME_TTL)
    return payload


def import_game(
    session: Session,
    *,
    source: str,
    game_id: str,
    progress: ProgressHook | None = None,
) -> IngestOutcome:
    """Add one reference game to the library, as a game the owner did not play.

    The PGN is fetched the way `model_game` fetches it and then goes in through the PGN
    adapter and `import_service.import_one`, so the game gets everything a pasted PGN
    gets: positions, a job row, the quick pass, and the events that refresh the page. Two
    things are set by hand. The source is the book it came from, with the book's own id,
    so the game is found again by name (asking twice opens the same row) and a lichess
    game keeps the link to its original. And `presume_owner` is off: unless an owner
    account is recognised among the players — their own game turning up in the rated
    pools — the game is stored with `is_owner_game` off and counts for nothing.
    """
    kind = _source(source)
    ref = _game_id(game_id)
    if kind == MASTERS:
        pgn = adapter.masters_pgn(ref, token=_token(session))
    else:
        pgn = adapter.lichess_game_pgn(ref)
    parsed = _parsed_for_library(pgn, kind, ref)
    return import_service.import_one(session, parsed, progress=progress, presume_owner=False)


def _parsed_for_library(pgn: str, kind: str, ref: str) -> ParsedGame:
    """A reference game's PGN as the import pipeline wants it, named after its book."""
    game = chess.pgn.read_game(io.StringIO(pgn))
    if game is None or not game.headers:
        raise ReferenceUnavailableError("the reference database did not answer with a game")
    parsed = pgn_import.parse_game(game, ref=f"{kind}:{ref}")
    parsed.source = Source.MASTERS if kind == MASTERS else Source.LICHESS
    parsed.source_id = ref
    return parsed


def has_token(session: Session) -> bool:
    """Whether a token is stored. The token itself never leaves this module."""
    return app_settings.get_lichess_token(session) is not None


# --- the cache -------------------------------------------------------------


def _cache_get(key: str) -> Any | None:
    """A cached payload, or None because there is none or it has aged out."""
    now = time.monotonic()
    with _LOCK:
        entry = _CACHE.get(key)
        if entry is None:
            return None
        expires, payload = entry
        if expires <= now:
            del _CACHE[key]
            return None
        _CACHE.move_to_end(key)
        return payload


def _cache_put(key: str, payload: Any, ttl: float) -> None:
    """Keep a payload for `ttl` seconds, dropping the least recently read to stay bounded."""
    with _LOCK:
        _CACHE[key] = (time.monotonic() + ttl, payload)
        _CACHE.move_to_end(key)
        while len(_CACHE) > MAX_ENTRIES:
            _CACHE.popitem(last=False)


def _clear_cache() -> None:
    """Forget everything cached. For tests, and for nothing else."""
    with _LOCK:
        _CACHE.clear()


# --- internals -------------------------------------------------------------


def _token(session: Session) -> str:
    token = app_settings.get_lichess_token(session)
    if not token:
        raise TokenMissingError(
            "the reference databases need the owner's Lichess API token; "
            "add one under Settings"
        )
    return token


def _source(value: str) -> str:
    text = str(value or "").strip().casefold()
    if text not in SOURCES:
        raise ValueError(
            f"unknown reference source {value!r}; expected one of {', '.join(SOURCES)}"
        )
    return text


def _game_id(value: str) -> str:
    """A game id, checked because it goes into a URL path rather than into a parameter."""
    text = str(value or "").strip()
    if not text or not text.isalnum() or len(text) > 32:
        raise ValueError(f"{value!r} is not a reference game id")
    return text


def _speeds(values: Sequence[str]) -> tuple[str, ...]:
    """The asked-for speeds as Lichess spells them, deduped, unknown ones dropped."""
    wanted: list[str] = []
    for value in values or ():
        speed = SPEEDS.get(str(value).strip().casefold())
        if speed is not None and speed not in wanted:
            wanted.append(speed)
    return tuple(wanted)


def _ratings(values: Sequence[int | str]) -> tuple[int, ...]:
    """The asked-for rating bands, lowest first, anything that is not a band dropped."""
    wanted: set[int] = set()
    for value in values or ():
        try:
            band = int(str(value).strip())
        except (TypeError, ValueError):
            continue
        if band in RATINGS:
            wanted.add(band)
    return tuple(sorted(wanted))


def _clamp(value: int | None, default: int, maximum: int) -> int:
    if value is None:
        return default
    return max(0, min(int(value), maximum))


def _fold(raw: dict[str, Any], *, source: str, fen: str) -> dict[str, Any]:
    """One upstream answer in the shape every surface here reads.

    Counts rather than percentages, `average_rating` however the two endpoints spell it,
    and a `games` total per move that the caller would otherwise add up itself.
    """
    white = _count(raw.get("white"))
    draws = _count(raw.get("draws"))
    black = _count(raw.get("black"))
    return {
        "source": source,
        "fen": fen,
        "opening": _opening(raw.get("opening")),
        "totals": {
            "games": white + draws + black,
            "white": white,
            "draws": draws,
            "black": black,
        },
        "moves": _name_continuations(
            [_move(entry) for entry in raw.get("moves") or () if isinstance(entry, dict)],
            fen,
        ),
        "top_games": _model_games(raw),
    }


def _model_games(raw: dict[str, Any]) -> list[dict[str, Any]]:
    """The games worth showing from here: the top games first, then the recent ones.

    The masters database answers with top games alone. The rated-lichess database keeps at
    most four top games per position and none at all early in a game, so the adapter asks
    it for its recent games too and they are folded in behind, so the list is never empty
    where there are games. A game in both lists is shown once, where it ranks higher.
    """
    games: list[dict[str, Any]] = []
    seen: set[str] = set()
    for source in ("topGames", "recentGames"):
        for entry in raw.get(source) or ():
            if not isinstance(entry, dict):
                continue
            game = _top_game(entry)
            if game is None or game["id"] in seen:
                continue
            seen.add(game["id"])
            games.append(game)
    return games


def _name_continuations(moves: list[dict[str, Any]], fen: str) -> list[dict[str, Any]]:
    """What the vendored book calls the position each move reaches, added in place.

    The same rule the owner's tree follows (`explorer._annotate_continuations`): a name is
    reported only when the child position is itself in the book, never inherited from the
    parent, so it reads as "this move enters that opening". Upstream names only the queried
    position; the per-move names come from the same vendored book as everywhere else, which
    is what keeps the two tables from calling one line two things. One board, replayed move
    by move; a move that will not parse gets no name rather than an error, and the result
    is part of the cached fold because it is a pure function of the request.
    """
    try:
        board = read_fen(fen)
    except ValueError:
        board = None
    for move in moves:
        found = None
        if board is not None:
            try:
                parsed = board.parse_uci(move["uci"])
            except ValueError:
                parsed = None
            if parsed is not None:
                board.push(parsed)
                found = openings.find(board.epd())
                board.pop()
        move["eco"] = found.eco if found else None
        move["name"] = found.name if found else None
    return moves


def _move(entry: dict[str, Any]) -> dict[str, Any]:
    white = _count(entry.get("white"))
    draws = _count(entry.get("draws"))
    black = _count(entry.get("black"))
    return {
        "uci": str(entry.get("uci") or ""),
        "san": str(entry.get("san") or ""),
        "games": white + draws + black,
        "white": white,
        "draws": draws,
        "black": black,
        # Masters calls it `averageRating`; the rated pools answer with the average rating
        # of the opponents. Either way it is "how strong were the people playing this".
        "average_rating": _number(entry.get("averageRating"))
        or _number(entry.get("averageOpponentRating")),
    }


def _top_game(entry: dict[str, Any]) -> dict[str, Any] | None:
    """One game Lichess offers to show. Nameless ones are dropped — nothing could open them."""
    ref = str(entry.get("id") or "").strip()
    if not ref:
        return None
    winner = entry.get("winner")
    return {
        "id": ref,
        "white": _player(entry.get("white")),
        "black": _player(entry.get("black")),
        # Null is a draw, which is how Lichess says it and how the board reads it.
        "winner": winner if winner in ("white", "black") else None,
        "year": _number(entry.get("year")),
        "month": str(entry.get("month")) if entry.get("month") else None,
        "speed": str(entry.get("speed")) if entry.get("speed") else None,
    }


def _player(entry: Any) -> dict[str, Any]:
    if not isinstance(entry, dict):
        return {"name": "?", "rating": None}
    return {"name": str(entry.get("name") or "?"), "rating": _number(entry.get("rating"))}


def _opening(entry: Any) -> dict[str, Any] | None:
    if not isinstance(entry, dict):
        return None
    name = str(entry.get("name") or "").strip()
    eco = str(entry.get("eco") or "").strip()
    if not name and not eco:
        return None
    return {"eco": eco or None, "name": name or None}


def _lichess_url(source: str, game_id: str, parsed: dict[str, Any]) -> str | None:
    """Where a person can go and see this game.

    A lichess game is its own id; a masters game is only reachable if its PGN says where it
    came from, which most of them do not — hence null rather than a guessed URL.
    """
    if source == LICHESS:
        return f"https://lichess.org/{game_id}"
    site = str(parsed.get("site") or "")
    return site if site.startswith("https://lichess.org/") else None


def _count(value: Any) -> int:
    return int(value) if isinstance(value, int) and not isinstance(value, bool) else 0


def _number(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return int(value)

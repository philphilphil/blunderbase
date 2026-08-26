"""Chess.com import adapter: monthly game archives, oldest month first.

chess.com publishes a player's games as one JSON document per calendar month, listed by
`/games/archives`. A finished month never changes again, but the month that is running
grows with every game, so a sync reads the archive the cursor points at all over again and
only skips the months before it. The cursor is therefore that archive's URL plus how many
games of it have already been read — `<archive url>|<count>` — and the count is only an
optimisation: whatever is read twice is caught by the pipeline's dedup on the source ID.

The API asks every client to identify itself in the User-Agent header, and answers 403 to
one that does not, so every request here carries one.
"""

from __future__ import annotations

import io
import re
import time
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING, Any
from urllib.parse import quote

import chess.pgn
import httpx

from backend.adapters import pgn_import
from backend.db.enums import JobStatus, Result, Source, Speed
from backend.services.import_service import (
    AccountIndex,
    ImportFailure,
    ImportResult,
    ParsedGame,
    ProgressHook,
    ingest_games,
    list_jobs,
)

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from backend.db.models import ImportJob

ARCHIVES_URL = "https://api.chess.com/pub/player/{username}/games/archives"
USER_AGENT = "Blunderbase/0.1 (personal chess database; import adapter)"
TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=60.0, pool=60.0)

# What chess.com answers when it wants the client to come back later rather than when the
# request itself was wrong; anything else is reported as the error it is.
RETRY_STATUSES = frozenset({429, 503})
MAX_ATTEMPTS = 3
RETRY_SECONDS = 5
MAX_RETRY_SECONDS = 60

# `rules` in the archive entry, mapped to what the Game row calls a variant. Anything not
# in here is a game this database does not model, and it fails as one game, not as a sync.
SUPPORTED_RULES = {"chess": "standard", "chess960": "chess960"}

SPEEDS = {
    "bullet": Speed.BULLET,
    "blitz": Speed.BLITZ,
    "rapid": Speed.RAPID,
    "daily": Speed.CORRESPONDENCE,
}

WIN = "win"
# The `result` strings both players carry when nobody won.
DRAW_RESULTS = frozenset(
    {"agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"}
)

USERNAME = re.compile(r"[A-Za-z0-9_-]{1,64}")
GAME_ID = re.compile(r"/game/(?:live|daily)/(\d+)")
ARCHIVE_MONTH = re.compile(r"/(\d{4})/(\d{2})/?$")
MONTH_TEXT = re.compile(r"^(\d{4})[-/](\d{1,2})$")

CURSOR_SEPARATOR = "|"
OPENING_NAME_LENGTH = 128

# How far back the cursor lookup reads. A sync writes one job, so this is "the last two
# hundred chess.com syncs", which is far more than a resume ever needs.
CURSOR_LOOKBACK = 200


@dataclass(slots=True)
class ArchiveCursor:
    """How far into which archive a run got, written back as the job's cursor."""

    archive: str | None = None
    count: int = 0

    def text(self) -> str | None:
        if self.archive is None:
            return None
        return f"{self.archive}{CURSOR_SEPARATOR}{self.count}"


def run(
    session: Session,
    job: ImportJob,
    *,
    username: str | None = None,
    since: Any = None,
    cursor: str | None = None,
    max_games: int | None = None,
    user_agent: str | None = None,
    client: httpx.Client | None = None,
    progress: ProgressHook | None = None,
    **options: Any,
) -> ImportResult:
    """Sync one chess.com account: every archive from the cursor's month to the newest.

    `cursor` and `since` both override the stored cursor — `since` because that is what the
    CLI calls "resume from this cursor instead of the stored one", and it reads either a
    cursor or a first month to start from.
    """
    name = (username or "").strip()
    if not USERNAME.fullmatch(name):
        raise ValueError("a chess.com import needs the username whose archives to read")
    job.message = name
    accounts = AccountIndex.load(session)
    account_id, _is_owner = accounts.match(Source.CHESSCOM, name)
    job.account_id = account_id

    if cursor is not None:
        resume, month = cursor, None
    elif since is not None:
        resume, month = read_since(since)
    else:
        resume, month = stored_cursor(session, name), None
    archive_url, offset = parse_cursor(resume)

    headers = request_headers(user_agent)
    owned = client is None
    http = client if client is not None else httpx.Client(timeout=TIMEOUT, headers=headers)
    reached = ArchiveCursor()
    try:
        archives = select_archives(
            fetch_archives(http, name, headers=headers), cursor_url=archive_url, month=month
        )
        start = offset if archives and archives[0] == archive_url else 0
        result = ingest_games(
            session,
            job,
            stream_games(
                http,
                archives,
                offset=start,
                max_games=max_games,
                reached=reached,
                headers=headers,
            ),
            progress=progress,
            accounts=accounts,
        )
    finally:
        if owned:
            http.close()

    result.cursor = reached.text()
    return result


def fetch_archives(
    client: httpx.Client, username: str, *, headers: dict[str, str] | None = None
) -> list[str]:
    """Every monthly archive URL chess.com has for a player, oldest first."""
    response = _get(client, ARCHIVES_URL.format(username=quote(username)), headers)
    if response.status_code == 404:
        raise LookupError(f"chess.com has no player {username!r}")
    response.raise_for_status()
    payload = response.json()
    archives = payload.get("archives") if isinstance(payload, dict) else None
    if not isinstance(archives, list):
        raise ValueError("chess.com answered the archive list in a shape this does not read")
    return [url for url in archives if isinstance(url, str)]


def fetch_archive(
    client: httpx.Client, url: str, *, headers: dict[str, str] | None = None
) -> list[dict[str, Any]]:
    """One month of games, oldest first. A month the API has forgotten reads as empty."""
    response = _get(client, url, headers)
    if response.status_code == 404:
        return []
    response.raise_for_status()
    payload = response.json()
    games = payload.get("games") if isinstance(payload, dict) else None
    if not isinstance(games, list):
        return []
    return [game for game in games if isinstance(game, dict)]


def select_archives(
    archives: Iterable[str],
    *,
    cursor_url: str | None = None,
    month: tuple[int, int] | None = None,
) -> list[str]:
    """The archives this sync still has to read: the cursor's own month and every later one.

    The cursor's month is read again rather than skipped, because it is the month that is
    still being played. A cursor naming a month the list no longer has (a renamed account,
    a cursor from another player) selects everything, which is the safe way to be wrong.
    """
    selected = list(archives)
    if cursor_url is not None and cursor_url in selected:
        selected = selected[selected.index(cursor_url) :]
    if month is not None:
        selected = [url for url in selected if (archive_month(url) or month) >= month]
    return selected


def stream_games(
    client: httpx.Client,
    archives: Iterable[str],
    *,
    offset: int = 0,
    max_games: int | None = None,
    reached: ArchiveCursor | None = None,
    headers: dict[str, str] | None = None,
) -> Iterator[ParsedGame | ImportFailure]:
    """Fetch the archives in order and yield their games, one failure per unreadable one.

    `reached` is filled in as the stream runs, so the caller knows where to resume from
    even when a limit stopped it half-way through a month.
    """
    state = reached if reached is not None else ArchiveCursor()
    produced = 0
    for index, url in enumerate(archives):
        if max_games is not None and produced >= max_games:
            return
        games = fetch_archive(client, url, headers=headers)
        start = offset if index == 0 else 0
        state.archive, state.count = url, min(start, len(games))
        for number, payload in enumerate(games[start:], start=start + 1):
            if max_games is not None and produced >= max_games:
                return
            produced += 1
            state.count = number
            try:
                item: ParsedGame | ImportFailure = parse_game(payload)
            except Exception as exc:
                item = ImportFailure(ref=reference(payload), error=f"{type(exc).__name__}: {exc}")
            yield item


def parse_game(payload: dict[str, Any]) -> ParsedGame:
    """One archive entry as the pipeline wants it: its PGN, with its JSON laid over the top.

    The moves, the clock comments and the ECO come off the PGN, which is the same reader
    the PGN adapter uses; the names, the ratings, the speed and the ID come off the JSON,
    which is the canonical version of all four.

    Where the game starts comes off the PGN too. The entry's `initial_setup` is a piece
    placement and nothing else — no side to move and no castling rights — so reading it as
    a FEN would strip the castling rights off every game.
    """
    ref = reference(payload)
    rules = str(payload.get("rules") or "chess").strip().casefold()
    variant = SUPPORTED_RULES.get(rules)
    if variant is None:
        raise ValueError(f"unsupported variant {rules!r}")

    text = payload.get("pgn")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("archive entry carries no PGN")
    game = chess.pgn.read_game(io.StringIO(text))
    if game is None:
        raise ValueError("archive entry carries no readable PGN")
    if game.errors:
        raise ValueError("; ".join(str(error) for error in game.errors))
    parsed = pgn_import.parse_game(game, ref=ref, variant=variant)

    white, black = player(payload, "white"), player(payload, "black")
    time_control = payload.get("time_control")
    initial_clock, increment = read_time_control(time_control)
    result = parsed.result
    if result is Result.UNKNOWN:
        result = read_result(payload) or Result.UNKNOWN

    return replace(
        parsed,
        source=Source.CHESSCOM,
        source_id=source_id(payload),
        white_name=str(white.get("username") or parsed.white_name),
        black_name=str(black.get("username") or parsed.black_name),
        white_rating=rating(white.get("rating")) or parsed.white_rating,
        black_rating=rating(black.get("rating")) or parsed.black_rating,
        result=result,
        rated=bool(payload["rated"]) if "rated" in payload else parsed.rated,
        speed=SPEEDS.get(str(payload.get("time_class") or "").casefold()) or parsed.speed,
        time_control=str(time_control) if time_control else parsed.time_control,
        initial_clock=initial_clock if initial_clock is not None else parsed.initial_clock,
        increment=increment if increment is not None else parsed.increment,
        opening_name=parsed.opening_name or opening_name(payload.get("eco")),
        played_at=parsed.played_at or played_at(payload.get("end_time")),
        ref=ref,
    )


def reference(payload: dict[str, Any]) -> str:
    """How a game is named in an error record: the link a person can open."""
    url = _text(payload.get("url")) or _text(payload.get("uuid"))
    if url:
        return url
    white = player(payload, "white").get("username") or "?"
    black = player(payload, "black").get("username") or "?"
    return f"{white} vs {black}"


def stored_cursor(session: Session, player: str) -> str | None:
    """The cursor of the last finished sync of this account.

    Scoped by account name and not only by source: two chess.com accounts in one database
    have two archive lists, and the other one's cursor names a month this player's list
    does not have, which sends `select_archives` back to the start of the whole archive on
    every second sync. The name lives in the job's message, which is where `run` puts it.
    """
    key = player.strip().casefold()
    for job in list_jobs(session, Source.CHESSCOM, limit=CURSOR_LOOKBACK):
        if (
            job.status == JobStatus.DONE
            and job.cursor
            and (job.message or "").strip().casefold() == key
        ):
            return job.cursor
    return None


def parse_cursor(value: str | None) -> tuple[str | None, int]:
    """A stored cursor split back into the archive it names and how much of it was read."""
    text = (value or "").strip()
    if not text:
        return None, 0
    url, separator, count = text.rpartition(CURSOR_SEPARATOR)
    if not separator or not count.isdigit():
        return text, 0
    return url, int(count)


def read_since(value: Any) -> tuple[str | None, tuple[int, int] | None]:
    """`--since` as either a cursor to resume from or the first month to read."""
    if isinstance(value, date):
        return None, (value.year, value.month)
    text = str(value).strip()
    if text.startswith("http"):
        return text, None
    match = MONTH_TEXT.match(text)
    if match is not None:
        return None, (int(match.group(1)), int(match.group(2)))
    try:
        stamp = datetime.fromisoformat(text)
    except ValueError:
        raise ValueError(f"cannot read {value!r} as a chess.com cursor or a month") from None
    return None, (stamp.year, stamp.month)


def archive_month(url: str) -> tuple[int, int] | None:
    """The year and month an archive URL ends in."""
    match = ARCHIVE_MONTH.search(url)
    if match is None:
        return None
    return int(match.group(1)), int(match.group(2))


def request_headers(user_agent: str | None = None) -> dict[str, str]:
    """chess.com refuses a client that does not say what it is."""
    return {"accept": "application/json", "user-agent": user_agent or USER_AGENT}


def player(payload: dict[str, Any], side: str) -> dict[str, Any]:
    value = payload.get(side)
    return value if isinstance(value, dict) else {}


def read_time_control(value: Any) -> tuple[int | None, int | None]:
    """`300`, `300+5`, and daily's `1/259200`, which is a pace and not a clock to store."""
    text = _text(value)
    if not text or "/" in text:
        return None, None
    base, _, bonus = text.partition("+")
    if not base.isdigit():
        return None, None
    return int(base), int(bonus) if bonus.isdigit() else 0


def read_result(payload: dict[str, Any]) -> Result | None:
    """The outcome as the two players' `result` strings tell it, when the PGN did not."""
    white = str(player(payload, "white").get("result") or "").casefold()
    black = str(player(payload, "black").get("result") or "").casefold()
    if white == WIN:
        return Result.WHITE_WIN
    if black == WIN:
        return Result.BLACK_WIN
    if white in DRAW_RESULTS and black in DRAW_RESULTS:
        return Result.DRAW
    return None


def source_id(payload: dict[str, Any]) -> str | None:
    """chess.com's ID for the game: the number in its URL, else the archive entry's uuid."""
    match = GAME_ID.search(_text(payload.get("url")))
    if match is not None:
        return match.group(1)
    return _text(payload.get("uuid")) or None


def opening_name(value: Any) -> str | None:
    """chess.com names the opening in the ECO URL's last segment and nowhere else."""
    text = _text(value)
    if "/openings/" not in text:
        return None
    slug = text.rsplit("/", 1)[-1].split("?")[0]
    return slug.replace("-", " ").strip()[:OPENING_NAME_LENGTH] or None


def played_at(value: Any) -> datetime | None:
    """The archive entry's `end_time`, which is a UTC epoch second."""
    try:
        return datetime.fromtimestamp(int(value), tz=UTC)
    except (TypeError, ValueError, OSError, OverflowError):
        return None


def rating(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _get(client: httpx.Client, url: str, headers: dict[str, str] | None = None) -> httpx.Response:
    """One GET, retried while chess.com is asking the client to wait."""
    sent = headers if headers is not None else request_headers()
    response = client.get(url, headers=sent)
    for _ in range(MAX_ATTEMPTS - 1):
        if response.status_code not in RETRY_STATUSES:
            return response
        time.sleep(retry_after(response))
        response = client.get(url, headers=sent)
    return response


def retry_after(response: httpx.Response) -> int:
    """How long to wait, bounded so a wrong header cannot park a sync for an hour."""
    try:
        seconds = int(response.headers.get("retry-after", RETRY_SECONDS))
    except ValueError:
        seconds = RETRY_SECONDS
    return max(1, min(seconds, MAX_RETRY_SECONDS))


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""

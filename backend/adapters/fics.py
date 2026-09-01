"""FICS import adapter: yearly player exports from the FICS Games Database.

The database exposes one downloadable PGN archive for a player and year. A completed
year is immutable, while the current year keeps growing, so a cursor stores the last
calendar date scanned and the next sync fetches that year again. Pipeline deduplication
makes that overlap harmless and catches games already imported from a hand-downloaded
PGN too.
"""

from __future__ import annotations

import html
import io
import re
import time
import zipfile
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING, Any
from urllib.parse import urljoin, urlsplit
from zoneinfo import ZoneInfo

import chess.pgn
import httpx

from backend.adapters import pgn_import
from backend.db.enums import Platform, Source
from backend.services import accounts
from backend.services.import_service import (
    AccountIndex,
    ImportFailure,
    ImportResult,
    ParsedGame,
    ProgressHook,
    ingest_games,
    latest_cursor,
)

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from backend.db.models import ImportJob

DOWNLOAD_URL = "https://www.ficsgames.org/cgi-bin/download.cgi"
SEARCH_URL = "https://www.ficsgames.org/cgi-bin/search.fcgi"
BASE_URL = "https://www.ficsgames.org"
SEARCH_FORM_URL = f"{BASE_URL}/"
USER_AGENT = "Blunderbase/0.1 (personal chess database; FICS import adapter)"
TIMEOUT = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=120.0)

FIRST_ARCHIVE_DAY = date(1999, 11, 1)
TIMEZONE_SWITCH = date(2014, 12, 5)
EASTERN = ZoneInfo("America/New_York")
PACIFIC = ZoneInfo("America/Los_Angeles")

USERNAME = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,16}")
TEMP_ARCHIVE = re.compile(
    r"(?:href\s*=\s*[\"'])?((?:https?://[^\"'<>\s]+)?/tmp/[^\"'<>\s]+?\.pgn\.zip)",
    re.IGNORECASE,
)
SET_ID = re.compile(r'name=["\']set_id["\']\s+value=["\']([^"\']+)', re.IGNORECASE)
GAME_SAVE = re.compile(
    r"/cgi-bin/show\.cgi\?ID=(\d+)[;&]action=save",
    re.IGNORECASE,
)
ELAPSED = re.compile(r"\[%emt\s+(\d+):(\d{2}):(\d{2}(?:\.\d+)?)\]", re.IGNORECASE)

RETRY_STATUSES = frozenset({429, 503})
MAX_ATTEMPTS = 3
RETRY_SECONDS = 3.0
POLL_ATTEMPTS = 5
POLL_SECONDS = 4.0
SEARCH_RESULT_LIMIT = 5_000


class FicsArchiveError(RuntimeError):
    """The games database did not provide a readable export."""


class FicsUnavailableError(FicsArchiveError):
    """The games database has temporarily disabled downloads."""


@dataclass(slots=True)
class SyncState:
    """Progress through the export range, shared with the lazy game iterator."""

    reached: date
    exhausted: bool = False

    def observe(self, item: ParsedGame | ImportFailure) -> None:
        if isinstance(item, ParsedGame) and item.played_at is not None:
            self.reached = max(self.reached, item.played_at.date())


@dataclass(slots=True)
class ExportState:
    """Which of FICS's two official export surfaces this run can use."""

    bulk_unavailable: bool = False


def run(
    session: Session,
    job: ImportJob,
    *,
    username: str | None = None,
    since: Any = None,
    cursor: str | None = None,
    max_games: int | None = None,
    client: httpx.Client | None = None,
    progress: ProgressHook | None = None,
    analyze: bool = True,
    today: date | None = None,
    sleep: Callable[[float], None] = time.sleep,
    **options: Any,
) -> ImportResult:
    """Sync one FICS account from its last scanned date through the present year."""
    name = (username or "").strip()
    if not USERNAME.fullmatch(name):
        raise ValueError("a FICS import needs a valid FICS username (1-17 characters)")

    job.message = name
    account = accounts.register_account(session, Platform.FICS, name)
    job.account_id = account.id
    session.commit()
    index = AccountIndex.load(session)

    end = today or datetime.now(UTC).date()
    resume = cursor if cursor is not None else since
    if resume is None:
        resume = latest_cursor(session, Source.FICS, account.id)
    start = read_cursor(resume)
    if start > end:
        start = end
    state = SyncState(start)

    headers = {"User-Agent": USER_AGENT, "Accept": "application/zip, application/x-chess-pgn"}
    owned = client is None
    http = client if client is not None else httpx.Client(timeout=TIMEOUT, headers=headers)
    try:
        result = ingest_games(
            session,
            job,
            stream_games(
                http,
                name,
                start=start,
                end=end,
                max_games=max_games,
                state=state,
                headers=headers,
                sleep=sleep,
            ),
            progress=progress,
            accounts=index,
            analyze=analyze,
        )
    finally:
        if owned:
            http.close()

    # A complete scan reached "now", even when the player had no games. A limited scan
    # only advances to its last game so that an unconsumed part of the archive is revisited.
    result.cursor = (end if state.exhausted else state.reached).isoformat()
    return result


def read_cursor(value: Any) -> date:
    """A stored ISO date, with `all`/`full`/`archive` spelling the complete archive."""
    if value is None:
        return FIRST_ARCHIVE_DAY
    text = str(value).strip().casefold()
    if not text or text in {"all", "full", "archive"}:
        return FIRST_ARCHIVE_DAY
    try:
        parsed = date.fromisoformat(text)
    except ValueError as exc:
        raise ValueError("a FICS cursor must be YYYY-MM-DD or 'all'") from exc
    return max(parsed, FIRST_ARCHIVE_DAY)


def stream_games(
    client: httpx.Client,
    username: str,
    *,
    start: date,
    end: date,
    max_games: int | None = None,
    state: SyncState | None = None,
    headers: dict[str, str] | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> Iterator[ParsedGame | ImportFailure]:
    """Yield the selected player's exports oldest first, one broken game as one failure."""
    reached = state if state is not None else SyncState(start)
    exports = ExportState()
    produced = 0
    for year in range(start.year, end.year + 1):
        range_start = max(start, date(year, 1, 1))
        archive = fetch_year(
            client,
            username,
            year,
            start=range_start,
            # A successful bulk response ignores this and contains `year` only. If bulk
            # downloads are unavailable, one custom search can cover every year left
            # instead of paying the same broken-ZIP timeout for each empty year.
            end=end,
            state=exports,
            headers=headers,
            sleep=sleep,
        )
        items = list(parse_archive(archive))
        items.sort(key=_chronological_key)
        for item in items:
            if max_games is not None and produced >= max_games:
                return
            if isinstance(item, ParsedGame) and item.played_at is not None:
                played = item.played_at.date()
                if played < start or played > end:
                    continue
            produced += 1
            reached.observe(item)
            yield item
        if exports.bulk_unavailable:
            break
    reached.exhausted = True


def fetch_year(
    client: httpx.Client,
    username: str,
    year: int,
    *,
    start: date | None = None,
    end: date | None = None,
    state: ExportState | None = None,
    headers: dict[str, str] | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> str:
    """Download one year, falling back to the searchable exporter during bulk downtime."""
    exports = state if state is not None else ExportState()
    if not exports.bulk_unavailable:
        response = _request(
            client,
            "POST",
            DOWNLOAD_URL,
            headers=headers,
            data={
                "gametype": "11",
                "player": username,
                "year": str(year),
                "month": "0",
                "movetimes": "1",
                "download": "Download",
            },
            sleep=sleep,
        )
        try:
            return _archive_text(client, response, headers=headers, sleep=sleep)
        except FicsUnavailableError:
            exports.bulk_unavailable = True

    return fetch_search_range(
        client,
        username,
        start or date(year, 1, 1),
        end or date(year, 12, 31),
        headers=headers,
        sleep=sleep,
    )


def fetch_search_range(
    client: httpx.Client,
    username: str,
    start: date,
    end: date,
    *,
    headers: dict[str, str] | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> str:
    """Use FICS's custom-search download, splitting ranges that hit its 5,000-game cap."""
    # `set_id` names the generated download, so every query needs a fresh server-issued
    # value; reusing one can make a later year poll the previous year's temporary file.
    set_id = _search_token(client, headers=headers, sleep=sleep)

    response = _request(
        client,
        "POST",
        SEARCH_URL,
        headers=headers,
        data={
            **_search_data(username, start, end, set_id),
            "dlgames": "Download (with movetimes)",
        },
        sleep=sleep,
    )
    try:
        archive = _archive_text(client, response, headers=headers, sleep=sleep)
    except FicsArchiveError as exc:
        # The site's generated-ZIP service can fail immediately with E001 or hand back a
        # temporary URL whose file never appears. Ordinary search and every game's Save
        # action remain healthy in both cases. Unknown archive failures stay fatal.
        archive_never_appeared = (
            str(exc) == "FICS Games Database did not finish preparing the archive"
        )
        if "e001" not in response.text.casefold() and not archive_never_appeared:
            raise
        archive = fetch_saved_games(
            client,
            username,
            start,
            end,
            headers=headers,
            sleep=sleep,
        )
    if archive.count("[FICSGamesDBGameNo ") < SEARCH_RESULT_LIMIT:
        return archive
    if start >= end:
        raise FicsArchiveError(
            f"FICS search export exceeded {SEARCH_RESULT_LIMIT} games on {start.isoformat()}"
        )

    middle = start + timedelta(days=(end - start).days // 2)
    left = fetch_search_range(client, username, start, middle, headers=headers, sleep=sleep)
    right = fetch_search_range(
        client,
        username,
        middle + timedelta(days=1),
        end,
        headers=headers,
        sleep=sleep,
    )
    return f"{left}\n\n{right}"


def fetch_saved_games(
    client: httpx.Client,
    username: str,
    start: date,
    end: date,
    *,
    headers: dict[str, str] | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> str:
    """Fetch individual PGNs when FICS can search but cannot build a ZIP archive."""
    set_id = _search_token(client, headers=headers, sleep=sleep)
    response = _request(
        client,
        "POST",
        SEARCH_URL,
        headers=headers,
        data={**_search_data(username, start, end, set_id), "Games": "Search"},
        sleep=sleep,
    )
    response.raise_for_status()
    body = html.unescape(response.text)
    game_ids = list(dict.fromkeys(GAME_SAVE.findall(body)))
    if not game_ids:
        lowered = body.casefold()
        if "search result" in lowered or "no games" in lowered or "not in" in lowered:
            return ""
        raise FicsArchiveError("FICS Games Database returned no searchable game list")

    games: list[str] = []
    for game_id in game_ids:
        url = f"{BASE_URL}/cgi-bin/show.cgi?ID={game_id};action=save"
        saved = _request(client, "GET", url, headers=headers, sleep=sleep)
        games.append(_archive_text(client, saved, headers=headers, sleep=sleep))
    return "\n\n".join(games)


def _search_token(
    client: httpx.Client,
    *,
    headers: dict[str, str] | None,
    sleep: Callable[[float], None],
) -> str:
    form = _request(client, "GET", SEARCH_FORM_URL, headers=headers, sleep=sleep)
    form.raise_for_status()
    match = SET_ID.search(form.text)
    if match is None:
        raise FicsArchiveError("FICS Games Database search form has no query token")
    return html.unescape(match.group(1))


def _search_data(username: str, start: date, end: date, set_id: str) -> dict[str, str]:
    return {
        "set_id": set_id,
        "white": username,
        "colors": "1",
        "black": "",
        "rclass": "0",
        "rgroup": "2",
        "variant": "0",
        "comps": "0",
        "result": "1",
        "rtimeoperator": "1",
        "gtime": "9999",
        "rincoperator": "1",
        "ginc": "9999",
        "eco1": "",
        "eco2": "",
        "date-sel-after-dd": str(start.day),
        "date-sel-after-mm": f"{start.month:02d}",
        "date-sel-after": str(start.year),
        "date-sel-dd": str(end.day),
        "date-sel-mm": f"{end.month:02d}",
        "date-sel": str(end.year),
    }


def parse_archive(text: str) -> Iterator[ParsedGame | ImportFailure]:
    """Parse a FICS PGN export and replace generic PGN metadata with FICS metadata."""
    stream = io.StringIO(text)
    index = 0
    while True:
        try:
            game = chess.pgn.read_game(stream)
        except Exception as exc:
            yield ImportFailure(ref=f"game {index + 1}", error=f"{type(exc).__name__}: {exc}")
            return
        if game is None:
            return
        index += 1
        game_id = (game.headers.get("FICSGamesDBGameNo") or "").strip() or None
        ref = f"fics:{game_id}" if game_id else pgn_import.reference(game.headers, index)
        if game.errors:
            yield ImportFailure(ref=ref, error="; ".join(str(error) for error in game.errors))
            continue
        variant = pgn_import._variant(game.headers)
        if variant not in pgn_import.SUPPORTED_VARIANTS:
            yield ImportFailure(ref=ref, error=f"unsupported variant {variant!r}")
            continue
        try:
            parsed = pgn_import.parse_game(game, ref=ref, variant=variant)
            parsed.source = Source.FICS
            parsed.source_id = game_id
            parsed.played_at = played_at(game.headers)
            clocks = elapsed_clocks(game, parsed.initial_clock, parsed.increment)
            if clocks is not None:
                parsed.clocks = clocks
            yield parsed
        except Exception as exc:
            yield ImportFailure(ref=ref, error=f"{type(exc).__name__}: {exc}")


def played_at(headers: chess.pgn.Headers) -> datetime | None:
    """Interpret the database's Date/Time fields in its documented historical timezone."""
    raw_date = (headers.get("Date") or "").strip().replace("-", ".")
    try:
        day = datetime.strptime(raw_date, "%Y.%m.%d").date()
    except ValueError:
        return pgn_import._played_at(headers)
    hour, minute, second = pgn_import._clock_time(headers.get("Time"))
    zone = EASTERN if day >= TIMEZONE_SWITCH else PACIFIC
    return datetime(day.year, day.month, day.day, hour, minute, second, tzinfo=zone).astimezone(UTC)


def elapsed_clocks(
    game: chess.pgn.Game, initial: int | None, increment: int | None
) -> list[float | None] | None:
    """Turn FICS `%emt` elapsed-move comments into the remaining clock after each ply."""
    if initial is None:
        return None
    remaining = [
        float(_header_clock(game.headers.get("WhiteClock"), initial)),
        float(_header_clock(game.headers.get("BlackClock"), initial)),
    ]
    clocks: list[float | None] = []
    found = False
    for ply, node in enumerate(game.mainline()):
        match = ELAPSED.search(node.comment or "")
        if match is None:
            clocks.append(None)
            continue
        elapsed = int(match.group(1)) * 3600 + int(match.group(2)) * 60 + float(match.group(3))
        side = ply % 2
        remaining[side] = max(0.0, remaining[side] - elapsed + float(increment or 0))
        clocks.append(remaining[side])
        found = True
    return clocks if found else None


def _header_clock(value: str | None, fallback: int) -> float:
    parts = (value or "").strip().split(":")
    if len(parts) != 3:
        return float(fallback)
    try:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    except ValueError:
        return float(fallback)


def _chronological_key(item: ParsedGame | ImportFailure) -> tuple[int, datetime]:
    if isinstance(item, ParsedGame) and item.played_at is not None:
        return 0, item.played_at
    return 1, datetime.max.replace(tzinfo=UTC)


def _request(
    client: httpx.Client,
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None,
    sleep: Callable[[float], None],
    **kwargs: Any,
) -> httpx.Response:
    response: httpx.Response | None = None
    for attempt in range(MAX_ATTEMPTS):
        response = client.request(method, url, headers=headers, **kwargs)
        if response.status_code not in RETRY_STATUSES:
            return response
        if attempt + 1 < MAX_ATTEMPTS:
            retry = response.headers.get("Retry-After")
            sleep(float(retry) if retry and retry.isdigit() else RETRY_SECONDS)
    assert response is not None
    response.raise_for_status()
    return response


def _archive_text(
    client: httpx.Client,
    response: httpx.Response,
    *,
    headers: dict[str, str] | None,
    sleep: Callable[[float], None],
) -> str:
    if response.status_code == 404:
        return ""
    response.raise_for_status()
    direct = _decode_archive(response.content)
    if direct is not None:
        return direct

    body = response.text
    lowered = body.casefold()
    if "downloads are currently not available" in lowered:
        raise FicsUnavailableError("FICS Games Database downloads are currently unavailable")
    if "no games" in lowered or "0 games" in lowered:
        return ""

    match = TEMP_ARCHIVE.search(html.unescape(body))
    if match is None:
        raise FicsArchiveError("FICS Games Database returned no PGN archive")
    url = urljoin(BASE_URL, match.group(1))
    host = (urlsplit(url).hostname or "").casefold()
    if host not in {"ficsgames.org", "www.ficsgames.org"}:
        raise FicsArchiveError("FICS Games Database returned an archive on an unexpected host")

    for attempt in range(POLL_ATTEMPTS):
        archive = _request(client, "GET", url, headers=headers, sleep=sleep)
        if archive.status_code == 404:
            if attempt + 1 < POLL_ATTEMPTS:
                sleep(POLL_SECONDS)
            continue
        archive.raise_for_status()
        decoded = _decode_archive(archive.content)
        if decoded is not None:
            return decoded
        if attempt + 1 < POLL_ATTEMPTS:
            sleep(POLL_SECONDS)
    raise FicsArchiveError("FICS Games Database did not finish preparing the archive")


def _decode_archive(payload: bytes) -> str | None:
    if payload.startswith(b"PK"):
        try:
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                names = [
                    name
                    for name in archive.namelist()
                    if not name.endswith("/") and name.casefold().endswith(".pgn")
                ]
                if not names:
                    raise FicsArchiveError("FICS archive contains no PGN file")
                return "\n\n".join(
                    archive.read(name).decode("utf-8-sig", errors="replace") for name in names
                )
        except zipfile.BadZipFile as exc:
            raise FicsArchiveError("FICS returned a corrupt ZIP archive") from exc
    text = payload.decode("utf-8-sig", errors="replace")
    if text.lstrip().startswith("["):
        return text
    return None

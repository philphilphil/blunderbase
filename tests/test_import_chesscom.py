from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.adapters import chesscom
from backend.db.enums import Color, JobStatus, Platform, Result, Source, Speed
from backend.db.models import Account, Game, GamePosition
from backend.services import import_service

BASE = "https://api.chess.com/pub/player/blunderbase/games"
ARCHIVES = f"{BASE}/archives"
START_EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"
DECEMBER = f"{BASE}/2025/12"
JANUARY = f"{BASE}/2026/01"
FEBRUARY = f"{BASE}/2026/02"


class FakeApi:
    """The archive fixture served over an httpx transport, remembering what was asked for."""

    def __init__(self, site: dict[str, Any]) -> None:
        self.site = site
        self.requests: list[httpx.Request] = []
        self.responses: dict[str, list[httpx.Response]] = {}

    def queue(self, url: str, *responses: httpx.Response) -> None:
        """Answer the next requests for one URL with these, before falling back to the site."""
        self.responses.setdefault(url, []).extend(responses)

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        url = str(request.url)
        queued = self.responses.get(url)
        if queued:
            return queued.pop(0)
        document = self.site.get(url)
        if document is None:
            return httpx.Response(404, json={"code": 0, "message": "Not Found"})
        return httpx.Response(200, json=document)

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handle))

    @property
    def urls(self) -> list[str]:
        return [str(request.url) for request in self.requests]


@pytest.fixture()
def api(fixtures_dir: Path) -> Iterator[FakeApi]:
    site = json.loads((fixtures_dir / "chesscom_archives.json").read_text(encoding="utf-8"))
    yield FakeApi(site)


@pytest.fixture()
def sync(api: FakeApi) -> Callable[..., Any]:
    """Run a chess.com import against the fake API with its own client."""

    def run(session: Session, **options: Any) -> Any:
        with api.client() as client:
            return import_service.run_import(
                session, "chesscom", username="blunderbase", client=client, **options
            )

    return run


def _count(session: Session, model: Any) -> int:
    return session.scalar(select(func.count()).select_from(model))


def _game(session: Session, source_id: str) -> Game:
    return session.scalars(select(Game).where(Game.source_id == source_id)).one()


def _owner(session: Session) -> Account:
    account = Account(platform=Platform.CHESSCOM, username="Blunderbase", is_owner=True)
    session.add(account)
    session.commit()
    return account


def test_every_month_is_read_oldest_first(
    session: Session, sync: Callable[..., Any], api: FakeApi
) -> None:
    job = sync(session)

    assert job.status is JobStatus.DONE
    assert (job.games_seen, job.games_imported, job.games_skipped, job.games_failed) == (6, 4, 0, 2)
    assert api.urls == [ARCHIVES, DECEMBER, JANUARY, FEBRUARY]
    assert _count(session, Game) == 4
    assert {game.source for game in session.scalars(select(Game))} == {Source.CHESSCOM}
    assert _count(session, GamePosition) == 11 + 21 + 9 + 5


def test_the_cursor_is_the_last_archive_and_how_much_of_it_was_read(
    session: Session, sync: Callable[..., Any]
) -> None:
    job = sync(session)

    assert job.cursor == f"{FEBRUARY}|3"
    assert import_service.latest_cursor(session, "chesscom") == f"{FEBRUARY}|3"


def test_a_cursor_belongs_to_the_account_it_was_read_for(
    session: Session, sync: Callable[..., Any]
) -> None:
    """Two chess.com accounts in one database have two archive lists: resuming one from
    the other's cursor names a month this player's list does not have, and `select_archives`
    then walks the whole history again on every second sync."""
    sync(session)

    assert chesscom.stored_cursor(session, "Blunderbase") == f"{FEBRUARY}|3"
    assert chesscom.stored_cursor(session, "someone-else") is None


def test_a_sync_is_attributed_to_the_owners_account(
    session: Session, sync: Callable[..., Any]
) -> None:
    account = _owner(session)

    job = sync(session)

    assert job.account_id == account.id


def test_metadata_comes_off_the_json_over_the_pgn(
    session: Session, sync: Callable[..., Any]
) -> None:
    _owner(session)
    sync(session)
    game = _game(session, "111111111")

    assert (game.white_name, game.black_name) == ("Blunderbase", "opponent1")
    assert (game.white_rating, game.black_rating) == (1503, 1488)
    assert game.owner_color is Color.WHITE
    assert game.result is Result.WHITE_WIN
    assert game.termination == "Blunderbase won by resignation"
    assert game.rated is True
    assert game.speed is Speed.BLITZ
    assert (game.time_control, game.initial_clock, game.increment) == ("300+5", 300, 5)
    assert game.eco == "C54"
    assert game.opening_name == "Italian Game Classical Variation"
    assert game.variant == "standard"
    assert game.played_at is not None
    assert game.played_at.isoformat() == "2026-01-12T19:22:04+00:00"
    assert game.ply_count == 20
    assert game.moves_uci[:4] == ["e2e4", "e7e5", "g1f3", "b8c6"]
    assert game.moves_san[-1] == "O-O"
    assert game.clocks is not None
    assert game.clocks[:2] == [300.0, 300.0]


def test_a_game_keeps_the_castling_rights_it_started_with(
    session: Session, sync: Callable[..., Any]
) -> None:
    """The archive entry's `initial_setup` is a placement; reading it as a FEN loses these."""
    sync(session)
    game = _game(session, "111111111")
    positions = session.scalars(
        select(GamePosition).where(GamePosition.game_id == game.id).order_by(GamePosition.ply)
    ).all()

    assert positions[0].position.fen == START_EPD
    assert [position.move_uci for position in positions[-3:]] == ["e1g1", "e8g8", None]


def test_a_daily_game_keeps_its_pace_but_stores_no_clock(
    session: Session, sync: Callable[..., Any]
) -> None:
    _owner(session)
    sync(session)
    game = _game(session, "222222222")

    assert game.speed is Speed.CORRESPONDENCE
    assert game.time_control == "1/259200"
    assert (game.initial_clock, game.increment) == (None, None)
    assert game.clocks is None
    assert game.owner_color is Color.BLACK
    assert game.result is Result.DRAW


def test_a_game_that_cannot_be_read_is_recorded_and_the_sync_keeps_going(
    session: Session, sync: Callable[..., Any]
) -> None:
    job = sync(session)

    refs = {error["ref"]: error["error"] for error in job.errors}
    assert set(refs) == {
        "https://www.chess.com/game/live/444444444",
        "https://www.chess.com/game/live/555555555",
    }
    assert "Qxf7" in refs["https://www.chess.com/game/live/444444444"]
    assert "bughouse" in refs["https://www.chess.com/game/live/555555555"]
    # The game after the two failures is in the database, and so is the one before them.
    assert _game(session, "333333333") is not None
    assert _count(session, Game) == 4


def test_a_stored_cursor_skips_finished_months_and_re_reads_the_open_one(
    session: Session, sync: Callable[..., Any], api: FakeApi
) -> None:
    sync(session)
    api.requests.clear()

    job = sync(session)

    assert api.urls == [ARCHIVES, FEBRUARY]
    assert (job.games_seen, job.games_imported, job.games_skipped) == (0, 0, 0)
    assert job.cursor == f"{FEBRUARY}|3"
    assert _count(session, Game) == 4


def test_a_re_read_month_does_not_import_a_game_twice(
    session: Session, sync: Callable[..., Any], api: FakeApi
) -> None:
    sync(session)
    # A cursor whose count is behind what the month already holds: every one of its games is
    # fetched again, and only the dedup on the source ID keeps them out of the database.
    stale = _game(session, "111111111")
    stale.dedup_hash = "not-the-hash-of-these-moves"
    session.commit()
    api.requests.clear()

    job = sync(session, cursor=f"{JANUARY}|0")

    assert api.urls == [ARCHIVES, JANUARY, FEBRUARY]
    assert (job.games_seen, job.games_imported, job.games_skipped, job.games_failed) == (5, 0, 3, 2)
    assert _count(session, Game) == 4
    assert job.cursor == f"{FEBRUARY}|3"


def test_a_limit_stops_inside_a_month_and_the_cursor_resumes_there(
    session: Session, sync: Callable[..., Any], api: FakeApi
) -> None:
    first = sync(session, max_games=2)

    assert api.urls == [ARCHIVES, DECEMBER, JANUARY]
    assert (first.games_seen, first.games_imported) == (2, 2)
    assert first.cursor == f"{JANUARY}|1"
    api.requests.clear()

    second = sync(session)

    assert api.urls == [ARCHIVES, JANUARY, FEBRUARY]
    assert (second.games_seen, second.games_imported, second.games_failed) == (4, 2, 2)
    assert second.cursor == f"{FEBRUARY}|3"
    assert _count(session, Game) == 4


def test_since_names_the_first_month_to_read(
    session: Session, sync: Callable[..., Any], api: FakeApi
) -> None:
    job = sync(session, since="2026-01")

    assert api.urls == [ARCHIVES, JANUARY, FEBRUARY]
    assert job.games_imported == 3


def test_every_request_says_which_application_it_is(
    session: Session, sync: Callable[..., Any], api: FakeApi
) -> None:
    sync(session)

    assert api.requests
    for request in api.requests:
        assert request.headers["user-agent"].startswith("Blunderbase/")
        assert request.headers["accept"] == "application/json"


def test_an_unknown_player_fails_the_job_and_imports_nothing(
    session: Session, sync: Callable[..., Any], api: FakeApi
) -> None:
    api.site.pop(ARCHIVES)

    job = sync(session)

    assert job.status is JobStatus.FAILED
    assert job.message is not None and "blunderbase" in job.message
    assert _count(session, Game) == 0


def test_a_rate_limited_request_is_tried_again(
    session: Session,
    sync: Callable[..., Any],
    api: FakeApi,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    waited: list[int] = []
    monkeypatch.setattr(chesscom.time, "sleep", waited.append)
    api.queue(FEBRUARY, httpx.Response(429, headers={"retry-after": "2"}))

    job = sync(session)

    assert waited == [2]
    assert api.urls.count(FEBRUARY) == 2
    assert job.status is JobStatus.DONE
    assert job.games_imported == 4


def test_a_username_that_is_not_one_is_refused_before_any_request(
    session: Session, api: FakeApi
) -> None:
    with api.client() as client:
        job = import_service.run_import(
            session, "chesscom", username="../player/someone-else", client=client
        )

    assert job.status is JobStatus.FAILED
    assert api.requests == []


def test_parse_cursor_reads_what_the_run_wrote() -> None:
    assert chesscom.parse_cursor(f"{FEBRUARY}|12") == (FEBRUARY, 12)
    assert chesscom.parse_cursor(FEBRUARY) == (FEBRUARY, 0)
    assert chesscom.parse_cursor(None) == (None, 0)
    assert chesscom.ArchiveCursor(FEBRUARY, 12).text() == f"{FEBRUARY}|12"
    assert chesscom.ArchiveCursor().text() is None


def test_select_archives_keeps_the_cursor_month_and_everything_after_it() -> None:
    archives = [DECEMBER, JANUARY, FEBRUARY]

    assert chesscom.select_archives(archives, cursor_url=JANUARY) == [JANUARY, FEBRUARY]
    assert chesscom.select_archives(archives) == archives
    # A cursor from an account that has been renamed names a month this list does not have.
    assert chesscom.select_archives(archives, cursor_url=f"{BASE}/2019/07") == archives
    assert chesscom.select_archives(archives, month=(2026, 2)) == [FEBRUARY]


def test_since_reads_a_month_a_date_or_a_cursor() -> None:
    assert chesscom.read_since("2026-02") == (None, (2026, 2))
    assert chesscom.read_since("2026/2") == (None, (2026, 2))
    assert chesscom.read_since("2026-02-14T08:00:00") == (None, (2026, 2))
    assert chesscom.read_since(f"{FEBRUARY}|3") == (f"{FEBRUARY}|3", None)
    with pytest.raises(ValueError):
        chesscom.read_since("last tuesday")


def test_the_source_id_falls_back_to_the_archive_uuid() -> None:
    assert chesscom.source_id({"url": "https://www.chess.com/game/live/42"}) == "42"
    assert chesscom.source_id({"url": "https://www.chess.com/live", "uuid": "abc"}) == "abc"
    assert chesscom.source_id({}) is None


def test_a_time_control_is_a_clock_only_when_it_is_one() -> None:
    assert chesscom.read_time_control("300+5") == (300, 5)
    assert chesscom.read_time_control("600") == (600, 0)
    assert chesscom.read_time_control("1/259200") == (None, None)
    assert chesscom.read_time_control(None) == (None, None)

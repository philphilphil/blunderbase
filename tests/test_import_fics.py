from __future__ import annotations

import io
import zipfile
from collections.abc import Callable
from datetime import date
from typing import Any
from urllib.parse import parse_qs

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.adapters import fics
from backend.db.enums import Color, JobStatus, Platform, Source, Speed
from backend.db.models import Account, Game, ImportJob
from backend.services import import_service

PLAYER = "ExamplePlayer"
TODAY = date(2026, 8, 31)

PGN = """[Event "FICS rated blitz game"]
[Site "FICS freechess.org"]
[FICSGamesDBGameNo "740792994"]
[White "ExamplePlayer"]
[Black "Allnovice"]
[WhiteElo "1559"]
[BlackElo "1475"]
[TimeControl "360+0"]
[Date "2026.08.31"]
[Time "13:37:00"]
[WhiteClock "0:06:00.000"]
[BlackClock "0:06:00.000"]
[ECO "A00"]
[Result "1-0"]

1. g3 {[%emt 00:00:01]} d5 {[%emt 00:00:02]} 2. Bg2 {[%emt 00:00:03]} e5 {[%emt 00:00:04]} 1-0
"""


def zipped(text: str = PGN) -> bytes:
    target = io.BytesIO()
    with zipfile.ZipFile(target, "w") as archive:
        archive.writestr("games.pgn", text)
    return target.getvalue()


class FakeDatabase:
    def __init__(self, response: Callable[[httpx.Request], httpx.Response] | None = None) -> None:
        self.requests: list[httpx.Request] = []
        self.response = response

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.response is not None:
            return self.response(request)
        return httpx.Response(200, content=zipped(), headers={"content-type": "application/zip"})

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handle))


def sync(session: Session, database: FakeDatabase, **options: Any) -> ImportJob:
    with database.client() as client:
        return import_service.run_import(
            session,
            Source.FICS,
            username=PLAYER,
            client=client,
            today=TODAY,
            sleep=lambda _: None,
            **options,
        )


def test_a_yearly_export_is_stored_as_fics_games_owned_by_the_connected_account(
    session: Session,
) -> None:
    database = FakeDatabase()

    job = sync(session, database, since="2026-01-01")

    assert job.status is JobStatus.DONE
    assert (job.games_seen, job.games_imported, job.games_failed) == (1, 1, 0)
    assert job.cursor == "2026-08-31"
    account = session.scalars(select(Account)).one()
    assert (account.platform, account.username, account.is_owner) == (
        Platform.FICS,
        PLAYER,
        True,
    )
    assert job.account_id == account.id

    game = session.scalars(select(Game)).one()
    assert (game.source, game.source_id) == (Source.FICS, "740792994")
    assert game.owner_color is Color.WHITE
    assert (game.white_rating, game.black_rating) == (1559, 1475)
    assert (game.rated, game.speed) == (True, Speed.BLITZ)
    assert game.played_at is not None
    assert game.played_at.isoformat() == "2026-08-31T17:37:00+00:00"
    assert game.clocks == [359.0, 358.0, 356.0, 354.0]

    request = database.requests[0]
    form = parse_qs(request.content.decode())
    assert (request.method, str(request.url)) == ("POST", fics.DOWNLOAD_URL)
    assert form == {
        "gametype": ["11"],
        "player": [PLAYER],
        "year": ["2026"],
        "month": ["0"],
        "movetimes": ["1"],
        "download": ["Download"],
    }


def test_a_second_sync_refetches_only_the_cursors_year_and_deduplicates(
    session: Session,
) -> None:
    database = FakeDatabase()

    first = sync(session, database, since="2026-01-01")
    second = sync(session, database)

    assert first.cursor == second.cursor == "2026-08-31"
    assert (second.games_seen, second.games_imported, second.games_skipped) == (1, 0, 1)
    assert [parse_qs(request.content.decode())["year"] for request in database.requests] == [
        ["2026"],
        ["2026"],
    ]


def test_a_generated_temporary_archive_is_polled_until_ready(session: Session) -> None:
    temporary = f"{fics.BASE_URL}/tmp/player.pgn.zip"
    polls = 0

    def response(request: httpx.Request) -> httpx.Response:
        nonlocal polls
        if request.method == "POST":
            return httpx.Response(200, text=f'<a href="{temporary}">archive</a>')
        polls += 1
        if polls == 1:
            return httpx.Response(404)
        return httpx.Response(200, content=zipped())

    database = FakeDatabase(response)

    job = sync(session, database, since="2026-01-01")

    assert job.status is JobStatus.DONE
    assert job.games_imported == 1
    assert [request.method for request in database.requests] == ["POST", "GET", "GET"]


def test_custom_search_is_used_when_the_bulk_download_is_temporarily_disabled(
    session: Session,
) -> None:
    temporary = f"{fics.BASE_URL}/tmp/search.pgn.zip"

    def response(request: httpx.Request) -> httpx.Response:
        if str(request.url) == fics.DOWNLOAD_URL:
            return httpx.Response(
                200, text="Downloads are currently not available, please check back later."
            )
        if request.method == "GET" and str(request.url) == fics.SEARCH_FORM_URL:
            return httpx.Response(200, text='<input name="set_id" value="query-token">')
        if request.method == "POST" and str(request.url) == fics.SEARCH_URL:
            form = parse_qs(request.content.decode())
            assert form["white"] == [PLAYER]
            assert form["colors"] == ["1"]
            assert form["date-sel-after"] == form["date-sel"] == ["2026"]
            assert form["set_id"] == ["query-token"]
            return httpx.Response(200, text=f'<a href="{temporary}">archive</a>')
        return httpx.Response(200, content=zipped())

    database = FakeDatabase(response)

    job = sync(session, database, since="2026-01-01")

    assert job.status is JobStatus.DONE
    assert job.games_imported == 1
    assert [(request.method, str(request.url)) for request in database.requests] == [
        ("POST", fics.DOWNLOAD_URL),
        ("GET", fics.SEARCH_FORM_URL),
        ("POST", fics.SEARCH_URL),
        ("GET", temporary),
    ]


def test_a_bulk_outage_searches_the_whole_remaining_history_once(
    session: Session,
) -> None:
    game_url = f"{fics.BASE_URL}/cgi-bin/show.cgi?ID=740792994;action=save"
    forms = 0
    searches = 0

    def response(request: httpx.Request) -> httpx.Response:
        nonlocal forms, searches
        if str(request.url) == fics.DOWNLOAD_URL:
            return httpx.Response(
                200, text="Downloads are currently not available, please check back later."
            )
        if request.method == "GET" and str(request.url) == fics.SEARCH_FORM_URL:
            forms += 1
            return httpx.Response(200, text=f'<input name="set_id" value="query-{forms}">')
        if request.method == "POST" and str(request.url) == fics.SEARCH_URL:
            searches += 1
            form = parse_qs(request.content.decode())
            assert (form["date-sel-after-dd"], form["date-sel-after-mm"]) == (["1"], ["11"])
            assert (form["date-sel-after"], form["date-sel"]) == (["1999"], ["2026"])
            if "dlgames" in form:
                return httpx.Response(200, text="Error saving search result (E001)")
            return httpx.Response(
                200,
                text=f'<table class="result-table"><a href="{game_url}">Save</a></table>',
            )
        if request.method == "GET" and str(request.url) == game_url:
            return httpx.Response(200, text=PGN)
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    database = FakeDatabase(response)

    job = sync(session, database, since="all")

    assert job.status is JobStatus.DONE
    assert job.games_imported == 1
    assert searches == 2


def test_individual_games_are_saved_when_a_temporary_archive_never_appears(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(fics, "POLL_ATTEMPTS", 2)
    temporary = f"{fics.BASE_URL}/tmp/search.pgn.zip"
    game_url = f"{fics.BASE_URL}/cgi-bin/show.cgi?ID=740792994;action=save"
    forms = 0
    polls = 0

    def response(request: httpx.Request) -> httpx.Response:
        nonlocal forms, polls
        if str(request.url) == fics.DOWNLOAD_URL:
            return httpx.Response(
                200, text="Downloads are currently not available, please check back later."
            )
        if request.method == "GET" and str(request.url) == fics.SEARCH_FORM_URL:
            forms += 1
            return httpx.Response(200, text=f'<input name="set_id" value="query-{forms}">')
        if request.method == "POST" and str(request.url) == fics.SEARCH_URL:
            form = parse_qs(request.content.decode())
            if "dlgames" in form:
                return httpx.Response(200, text=f'<a href="{temporary}">archive</a>')
            assert form["Games"] == ["Search"]
            return httpx.Response(
                200,
                text=f'<table class="result-table"><a href="{game_url}">Save</a></table>',
            )
        if request.method == "GET" and str(request.url) == temporary:
            polls += 1
            return httpx.Response(404)
        if request.method == "GET" and str(request.url) == game_url:
            return httpx.Response(200, text=PGN)
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    database = FakeDatabase(response)

    job = sync(session, database, since="2026-01-01")

    assert job.status is JobStatus.DONE
    assert job.games_imported == 1
    assert polls == 2


def test_individual_games_are_saved_when_search_archive_generation_fails(
    session: Session,
) -> None:
    game_url = f"{fics.BASE_URL}/cgi-bin/show.cgi?ID=740792994;action=save"
    forms = 0

    def response(request: httpx.Request) -> httpx.Response:
        nonlocal forms
        if str(request.url) == fics.DOWNLOAD_URL:
            return httpx.Response(
                200, text="Downloads are currently not available, please check back later."
            )
        if request.method == "GET" and str(request.url) == fics.SEARCH_FORM_URL:
            forms += 1
            return httpx.Response(200, text=f'<input name="set_id" value="query-{forms}">')
        if request.method == "POST" and str(request.url) == fics.SEARCH_URL:
            form = parse_qs(request.content.decode())
            if "dlgames" in form:
                return httpx.Response(
                    200,
                    text='<title>FICS Games Database - Error</title>'
                    '<div class="messagetext">'
                    'Error encountered when saving search result (E001)'
                    '</div>',
                )
            assert form["Games"] == ["Search"]
            return httpx.Response(
                200,
                text=f'<table class="result-table"><a href="{game_url}">Save</a></table>',
            )
        if request.method == "GET" and str(request.url) == game_url:
            return httpx.Response(200, text=PGN)
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    database = FakeDatabase(response)

    job = sync(session, database, since="2026-01-01")

    assert job.status is JobStatus.DONE
    assert job.games_imported == 1
    assert [(request.method, str(request.url)) for request in database.requests] == [
        ("POST", fics.DOWNLOAD_URL),
        ("GET", fics.SEARCH_FORM_URL),
        ("POST", fics.SEARCH_URL),
        ("GET", fics.SEARCH_FORM_URL),
        ("POST", fics.SEARCH_URL),
        ("GET", game_url),
    ]

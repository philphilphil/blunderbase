"""The scheduled sync: the Sync button on a clock.

The service half decides what is due against an in-memory library; the worker half runs a
tick against a fake adapter; the HTTP half is the two calls the import page makes.
"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.api.app import create_app
from backend.api.events import EventBroker
from backend.config import Settings
from backend.db.enums import JobStatus, Platform, Source
from backend.db.migrate import upgrade_to_head
from backend.db.models import Account, ImportJob
from backend.db.session import get_sessionmaker
from backend.services import app_settings as app_settings_service
from backend.services import import_service
from backend.services.auto_sync import DueSync, due_syncs
from backend.services.import_service import ImportResult
from backend.workers.auto_sync import AutoSync
from tests.conftest import running_app

NOW = datetime(2026, 9, 2, 12, 0, tzinfo=UTC)

def fake_run(session: Session, job: ImportJob, **options: Any) -> ImportResult:
    """An adapter that stores nothing and writes what it was told on the job row.

    On the row rather than in a module-level list, because `get_adapter` imports this file
    by its dotted name and gets a second copy of the module, with a list of its own.
    """
    job.message = f"{options.get('username')} progress={'progress' in options}"
    return ImportResult(cursor="1")


def account(session: Session, platform: Platform, username: str, owner: bool = True) -> Account:
    row = Account(platform=platform, username=username, is_owner=owner)
    session.add(row)
    session.flush()
    return row


def synced(session: Session, source: Source, ago: timedelta, account_id: int | None = None):
    job = ImportJob(
        source=source,
        status=JobStatus.DONE,
        account_id=account_id,
        started_at=NOW - ago,
        finished_at=NOW - ago + timedelta(seconds=30),
    )
    session.add(job)
    session.flush()
    job.created_at = NOW - ago
    session.flush()
    return job


# --- what is due ------------------------------------------------------------


def test_an_account_never_synced_is_due_at_once(session: Session) -> None:
    account(session, Platform.LICHESS, "phib")

    assert [d.username for d in due_syncs(session, 30, NOW)] == ["phib"]


def test_an_account_synced_inside_the_interval_is_not_due(session: Session) -> None:
    row = account(session, Platform.LICHESS, "phib")
    synced(session, Source.LICHESS, timedelta(minutes=10), row.id)

    assert due_syncs(session, 30, NOW) == []
    assert [d.username for d in due_syncs(session, 10, NOW)] == ["phib"]


def test_a_sync_that_never_named_the_account_still_counts(session: Session) -> None:
    account(session, Platform.CHESSCOM, "AlexKnight")
    synced(session, Source.CHESSCOM, timedelta(minutes=5), account_id=None)

    assert due_syncs(session, 30, NOW) == []


def test_only_owner_accounts_on_syncable_platforms_are_due(session: Session) -> None:
    account(session, Platform.LICHESS, "phib")
    account(session, Platform.OTB, "club")
    account(session, Platform.CHESSCOM, "somebody-else", owner=False)

    assert [(d.source, d.username) for d in due_syncs(session, 30, NOW)] == [("lichess", "phib")]


def test_a_failed_sync_is_retried_on_the_same_clock(session: Session) -> None:
    row = account(session, Platform.FICS, "phib")
    job = synced(session, Source.FICS, timedelta(minutes=20), row.id)
    job.status = JobStatus.FAILED
    session.flush()

    assert due_syncs(session, 30, NOW) == []
    assert len(due_syncs(session, 20, NOW)) == 1


# --- the setting -------------------------------------------------------------


def test_the_schedule_is_off_until_set_and_floored_at_a_minute(session: Session) -> None:
    assert app_settings_service.get_auto_sync_minutes(session) is None
    assert app_settings_service.set_auto_sync_minutes(session, 0) == 1
    assert app_settings_service.set_auto_sync_minutes(session, 45) == 45
    assert app_settings_service.get_auto_sync_minutes(session) == 45
    assert app_settings_service.set_auto_sync_minutes(session, None) is None
    assert app_settings_service.get_auto_sync_minutes(session) is None


# --- the worker --------------------------------------------------------------


@pytest.fixture()
def fake_lichess(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setitem(import_service.SOURCES, "lichess", "tests.test_auto_sync:fake_run")
    yield


def test_a_tick_syncs_what_is_due_with_the_button_s_arguments(
    settings: Settings, fake_lichess: None
) -> None:
    settings.analysis_workers = False
    upgrade_to_head(settings)
    with get_sessionmaker(settings)() as session:
        account(session, Platform.LICHESS, "phib")
        app_settings_service.set_auto_sync_minutes(session, 15)
        session.commit()

    worker = AutoSync(settings=settings, broker=EventBroker())
    assert asyncio.run(worker.tick()) == 1

    # The run is on the record like any other — the username and the progress hook the
    # button would have passed — and the account is not due again.
    with get_sessionmaker(settings)() as session:
        jobs = import_service.list_jobs(session, source="lichess")
        assert len(jobs) == 1 and jobs[0].status is JobStatus.DONE
        assert jobs[0].message == "phib progress=True"
    assert asyncio.run(worker.tick()) == 0


def test_a_tick_does_nothing_while_the_schedule_is_off(
    settings: Settings, fake_lichess: None
) -> None:
    settings.analysis_workers = False
    upgrade_to_head(settings)
    with get_sessionmaker(settings)() as session:
        account(session, Platform.LICHESS, "phib")
        session.commit()

    assert asyncio.run(AutoSync(settings=settings, broker=EventBroker()).tick()) == 0
    with get_sessionmaker(settings)() as session:
        assert import_service.count_jobs(session) == 0


async def test_stopping_an_idle_scheduler_does_not_wait_out_the_grace(
    settings: Settings,
) -> None:
    """The loop only ever sleeps between ticks; shutdown must not sit through a sleep.

    Every test that boots the app stops this worker, so a grace paid here is paid a few
    hundred times a run — which is how it was found.
    """
    worker = AutoSync(settings=settings, broker=EventBroker())
    await worker.start()
    assert worker.running

    started = asyncio.get_running_loop().time()
    await worker.stop()
    assert asyncio.get_running_loop().time() - started < 1.0
    assert not worker.running


async def test_stopping_mid_sync_lets_the_sync_finish(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A sync that is mid-archive is worth waiting for, and it is the one thing that is."""
    settings.auto_sync_poll_seconds = 0.01
    release = threading.Event()
    finished: list[str] = []

    def blocked_sync(self: AutoSync, item: DueSync) -> None:
        release.wait(5)
        finished.append(item.username)

    monkeypatch.setattr(AutoSync, "_due", lambda self: [DueSync("lichess", "phib")])
    monkeypatch.setattr(AutoSync, "_sync", blocked_sync)

    worker = AutoSync(settings=settings, broker=EventBroker())
    await worker.start()
    while worker._syncing is None:
        await asyncio.sleep(0.01)

    stopping = asyncio.create_task(worker.stop())
    await asyncio.sleep(0.05)
    assert not stopping.done() and finished == []

    release.set()
    await asyncio.wait_for(stopping, 2)
    assert finished == ["phib"]
    assert not worker.running


# --- the two calls the page makes ---------------------------------------------


@pytest.fixture()
def api(settings: Settings) -> Iterator[TestClient]:
    settings.analysis_workers = False
    with running_app(create_app(settings)) as client:
        yield client


def test_the_schedule_is_read_set_and_cleared_over_http(api: TestClient) -> None:
    assert api.get("/import/schedule").json() == {"minutes": None, "disabled_sources": []}

    assert api.put("/import/schedule", json={"minutes": 30}).json() == {"minutes": 30, "disabled_sources": []}
    assert api.get("/import/schedule").json() == {"minutes": 30, "disabled_sources": []}

    assert api.put("/import/schedule", json={"minutes": None}).json() == {"minutes": None, "disabled_sources": []}
    assert api.put("/import/schedule", json={"minutes": 0}).status_code == 422


def test_the_serve_process_runs_the_scheduler_except_in_the_demo(settings: Settings) -> None:
    settings.analysis_workers = False
    with running_app(create_app(settings)) as client:
        assert client.app.state.auto_sync is not None
        assert client.app.state.auto_sync.running

    settings.runtime_mode = "demo"
    with TestClient(create_app(settings)) as client:
        assert client.app.state.auto_sync is None


def test_disabled_sources_are_skipped_until_enabled(session: Session) -> None:
    account(session, Platform.FICS, "rare")
    account(session, Platform.LICHESS, "daily")
    app_settings_service.set_disabled_sync_sources(session, ["fics"])
    assert [item.source for item in due_syncs(session, 30, NOW)] == ["lichess"]
    app_settings_service.set_disabled_sync_sources(session, [])
    assert len(due_syncs(session, 30, NOW)) == 2


def test_source_preferences_survive_schedule_changes(api: TestClient) -> None:
    assert api.put("/import/schedule", json={"disabled_sources": ["fics"]}).json()["disabled_sources"] == ["fics"]
    assert api.put("/import/schedule", json={"minutes": 30}).json()["disabled_sources"] == ["fics"]
    assert api.put("/import/schedule", json={"disabled_sources": []}).json()["minutes"] == 30
    assert api.put("/import/schedule", json={"disabled_sources": ["invalid"]}).status_code == 422

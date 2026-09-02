"""Which connected accounts are due a sync, given how often the owner asked for one.

The schedule is one number (`app_settings.get_auto_sync_minutes`): every connected account
on a platform that can be synced is read again once that many minutes have passed since
its last sync started — whatever that sync did. "Since it started" rather than "since it
finished" so that a sync that is still running is not due, and "whatever it did" so that a
failing one is retried on the same clock rather than every tick.

Nothing here runs anything: the worker in `workers/auto_sync.py` asks this what is due and
does the running, and the route that starts a sync by hand never looks here at all. Both
end in `import_service.run_import` with the same arguments the Sync button posts, so a
scheduled sync is a pressed button and not a second kind of import.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.db.enums import Platform, Source
from backend.db.models import Account, ImportJob

# The platforms a username can be synced from. OTB has no archive to read.
SYNCABLE: tuple[Platform, ...] = (Platform.LICHESS, Platform.CHESSCOM, Platform.FICS)


@dataclass(frozen=True, slots=True)
class DueSync:
    """One sync the schedule wants run now: the source and the username to give it."""

    source: str
    username: str


def due_syncs(session: Session, minutes: int, now: datetime) -> list[DueSync]:
    """Every connected account whose last sync started at least `minutes` ago.

    An account that has never been synced under its own id — connected by hand, or by a sync
    that failed before it named one — falls back to the newest sync of its platform, so a
    fresh deployment with one account and one manual sync does not run again immediately.
    Oldest account first, which is also the order the sources table lists them in.
    """
    interval = timedelta(minutes=minutes)
    due: list[DueSync] = []
    accounts = session.scalars(
        select(Account)
        .where(Account.is_owner.is_(True), Account.platform.in_(SYNCABLE))
        .order_by(Account.id)
    )
    for account in accounts:
        started = _last_started(session, account)
        if started is None or now - started >= interval:
            source = str(Source(str(account.platform)))
            due.append(DueSync(source=source, username=account.username))
    return due


def _last_started(session: Session, account: Account) -> datetime | None:
    """When this account's newest sync began, or its platform's if none names the account."""
    by_account = (
        select(ImportJob)
        .where(ImportJob.account_id == account.id)
        .order_by(ImportJob.created_at.desc(), ImportJob.id.desc())
        .limit(1)
    )
    job = session.scalars(by_account).first()
    if job is None:
        by_source = (
            select(ImportJob)
            .where(ImportJob.source == Source(str(account.platform)))
            .order_by(ImportJob.created_at.desc(), ImportJob.id.desc())
            .limit(1)
        )
        job = session.scalars(by_source).first()
    if job is None:
        return None
    return job.started_at or job.created_at

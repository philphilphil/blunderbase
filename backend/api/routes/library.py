"""`/library` — lossless installation backup, beside the portable PGN export."""

from __future__ import annotations

import re
import secrets
import shutil
import tempfile
import time
from datetime import date
from pathlib import Path

from fastapi import APIRouter, HTTPException
from starlette.background import BackgroundTask
from starlette.responses import FileResponse

from backend.api.deps import SettingsDep
from backend.api.schemas import BackupEstimate, BackupPrepared
from backend.services import backups as backups_service

router = APIRouter(prefix="/library", tags=["library"])

_PREPARED_PREFIX = "blunderbase-backup-ready-"
_PREPARED_TOKEN = re.compile(r"\d{4}-\d{2}-\d{2}_[A-Za-z0-9_-]{32}")
_PREPARED_TTL_SECONDS = 24 * 60 * 60


@router.get(
    "/backup/estimate",
    response_model=BackupEstimate,
    summary="Estimate the database backup download size",
)
def estimate_backup(settings: SettingsDep) -> BackupEstimate:
    """A cheap logical-page estimate; no snapshot is created until download."""
    return BackupEstimate(
        estimated_bytes=backups_service.estimate_database_bytes(settings.database_path)
    )


@router.post(
    "/backup/prepare",
    response_model=BackupPrepared,
    summary="Prepare a verified database backup",
)
def prepare_backup(settings: SettingsDep) -> BackupPrepared:
    """Create the snapshot while the UI shows progress, then return its download token."""
    _remove_stale_prepared(settings.data_dir)
    token = f"{date.today().isoformat()}_{secrets.token_urlsafe(24)}"
    directory = settings.data_dir / f"{_PREPARED_PREFIX}{token}"
    target = directory / "backup.db"
    directory.mkdir()
    try:
        copied = backups_service.backup_database(settings.database_path, target)
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    return BackupPrepared(
        token=token,
        filename=_prepared_filename(token),
        bytes=copied.bytes,
    )


@router.get(
    "/backup/prepared/{token}",
    summary="Download a prepared database backup",
    response_class=FileResponse,
    responses={200: {"content": {"application/vnd.sqlite3": {}}}},
)
def download_prepared_backup(token: str, settings: SettingsDep) -> FileResponse:
    """Stream a prepared snapshot once, deleting its temporary file afterward."""
    if _PREPARED_TOKEN.fullmatch(token) is None:
        raise HTTPException(status_code=404, detail="prepared backup not found")
    directory = settings.data_dir / f"{_PREPARED_PREFIX}{token}"
    target = directory / "backup.db"
    if not target.is_file():
        raise HTTPException(status_code=404, detail="prepared backup not found")
    return FileResponse(
        target,
        media_type="application/vnd.sqlite3",
        filename=_prepared_filename(token),
        background=BackgroundTask(shutil.rmtree, directory, ignore_errors=True),
    )


@router.get(
    "/backup",
    summary="Download a lossless database backup",
    response_class=FileResponse,
    responses={200: {"content": {"application/vnd.sqlite3": {}}}},
)
def download_backup(settings: SettingsDep) -> FileResponse:
    """A consistent SQLite snapshot; restoration remains an offline CLI operation."""
    directory = Path(tempfile.mkdtemp(prefix="blunderbase-backup-", dir=settings.data_dir))
    filename = f"blunderbase-backup-{date.today().isoformat()}.db"
    target = directory / filename
    try:
        backups_service.backup_database(settings.database_path, target)
    except Exception:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    return FileResponse(
        target,
        media_type="application/vnd.sqlite3",
        filename=filename,
        background=BackgroundTask(shutil.rmtree, directory, ignore_errors=True),
    )


def _prepared_filename(token: str) -> str:
    return f"blunderbase-backup-{token[:10]}.db"


def _remove_stale_prepared(data_dir: Path) -> None:
    cutoff = time.time() - _PREPARED_TTL_SECONDS
    for directory in data_dir.glob(f"{_PREPARED_PREFIX}*"):
        try:
            stale = (
                directory.is_dir()
                and not directory.is_symlink()
                and directory.stat().st_mtime < cutoff
            )
        except OSError:
            continue
        if stale:
            shutil.rmtree(directory, ignore_errors=True)

"""Consistent, integrity-checked copies of the complete SQLite installation database."""

from __future__ import annotations

import hashlib
import os
import shutil
import sqlite3
import tempfile
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path


class BackupError(RuntimeError):
    """A database could not be backed up, verified, or restored safely."""


@dataclass(frozen=True, slots=True)
class DatabaseCopy:
    path: Path
    bytes: int
    sha256: str
    schema_revision: str


def estimate_database_bytes(source: Path) -> int:
    """Estimate snapshot bytes from SQLite's logical page count without scanning the database."""
    source = _source(source)
    try:
        with closing(_read_only(source)) as source_db:
            page_count = source_db.execute("PRAGMA page_count").fetchone()
            page_size = source_db.execute("PRAGMA page_size").fetchone()
    except sqlite3.Error as exc:
        raise BackupError(str(exc)) from exc
    if page_count is None or page_size is None:
        raise BackupError("could not estimate database backup size")
    return int(page_count[0]) * int(page_size[0])


def backup_database(source: Path, destination: Path, *, overwrite: bool = False) -> DatabaseCopy:
    """Take a transactionally consistent SQLite backup, including committed WAL data."""
    source = _source(source)
    destination = _destination(source, destination, overwrite=overwrite)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = _temporary_for(destination)
    try:
        with closing(_read_only(source)) as source_db, closing(
            sqlite3.connect(temporary)
        ) as backup_db:
            source_db.backup(backup_db)
            backup_db.commit()
        revision = verify_database(temporary)
        _install(temporary, destination)
    except (OSError, sqlite3.Error, BackupError) as exc:
        temporary.unlink(missing_ok=True)
        if isinstance(exc, BackupError):
            raise
        raise BackupError(str(exc)) from exc
    return _summary(destination, revision)


def restore_database(source: Path, destination: Path, *, overwrite: bool = False) -> DatabaseCopy:
    """Verify a backup, copy it atomically into place, and verify the restored bytes."""
    source = _source(source)
    destination = _destination(source, destination, overwrite=overwrite)
    revision = verify_database(source)
    expected_hash = _sha256(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = _temporary_for(destination)
    try:
        shutil.copyfile(source, temporary)
        if _sha256(temporary) != expected_hash:
            raise BackupError("the restored copy does not match the backup checksum")
        verify_database(temporary)
        _install(temporary, destination)
        # A stopped WAL database may leave empty sidecars behind. They belong to the old
        # database identity and must never be replayed against the restored main file.
        Path(f"{destination}-wal").unlink(missing_ok=True)
        Path(f"{destination}-shm").unlink(missing_ok=True)
        verify_database(destination)
        # Opening a WAL-mode database for verification may recreate empty sidecars.
        Path(f"{destination}-wal").unlink(missing_ok=True)
        Path(f"{destination}-shm").unlink(missing_ok=True)
    except (OSError, sqlite3.Error, BackupError) as exc:
        temporary.unlink(missing_ok=True)
        if isinstance(exc, BackupError):
            raise
        raise BackupError(str(exc)) from exc
    return _summary(destination, revision)


def verify_database(path: Path) -> str:
    """Return the Alembic revision after SQLite's full integrity check passes."""
    path = _source(path)
    try:
        with closing(_read_only(path)) as connection:
            result = connection.execute("PRAGMA integrity_check").fetchone()
            if result is None or result[0] != "ok":
                detail = result[0] if result else "no result"
                raise BackupError(f"database integrity check failed: {detail}")
            revision = connection.execute("SELECT version_num FROM alembic_version").fetchone()
    except sqlite3.Error as exc:
        raise BackupError(f"not a valid Blunderbase database: {exc}") from exc
    if revision is None or not revision[0]:
        raise BackupError("not a valid Blunderbase database: no schema revision")
    return str(revision[0])


def _source(path: Path) -> Path:
    resolved = Path(path).expanduser().resolve()
    if not resolved.is_file():
        raise BackupError(f"no database file at {resolved}")
    return resolved


def _destination(source: Path, path: Path, *, overwrite: bool) -> Path:
    destination = Path(path).expanduser().resolve()
    if destination == source:
        raise BackupError("source and destination must be different files")
    if destination.exists() and not overwrite:
        raise BackupError(f"{destination} already exists; pass --force to replace it")
    if destination.exists() and not destination.is_file():
        raise BackupError(f"destination is not a file: {destination}")
    return destination


def _temporary_for(destination: Path) -> Path:
    descriptor, name = tempfile.mkstemp(
        prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent
    )
    os.close(descriptor)
    return Path(name)


def _install(temporary: Path, destination: Path) -> None:
    os.replace(temporary, destination)


def _read_only(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _summary(path: Path, revision: str) -> DatabaseCopy:
    return DatabaseCopy(
        path=path,
        bytes=path.stat().st_size,
        sha256=_sha256(path),
        schema_revision=revision,
    )

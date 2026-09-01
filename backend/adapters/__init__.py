"""Network- and process-facing adapters. Nothing here knows about the database."""

from __future__ import annotations

# What a caller writes instead of a cursor to mean "start from the beginning of the
# archive, whatever this source has stored". Every source that keeps a cursor understands
# the same word, because "start over" is one idea and an owner who learns it on one account
# should not find it refused on another — see `services.import_service` and the sources
# table's "From the beginning".
FULL_ARCHIVE = frozenset({"all", "full", "archive"})


def is_full_archive(value: object | None) -> bool:
    """Whether a `since` value asks for the whole archive rather than for a resume point."""
    if value is None:
        return False
    text = str(value).strip().casefold()
    return not text or text in FULL_ARCHIVE

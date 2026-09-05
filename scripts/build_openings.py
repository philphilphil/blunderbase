#!/usr/bin/env python
"""Regenerate `backend/data/openings.tsv` from lichess-org/chess-openings.

Upstream: https://github.com/lichess-org/chess-openings — five TSVs (`a.tsv` … `e.tsv`)
of `eco / name / pgn`, licensed CC0-1.0 (the text is vendored beside the table as
`openings.COPYING.txt`). The repository does not ship EPDs: its `dist/` build is a CI
artifact, so the keys are derived here instead, by replaying each opening's PGN and
taking `board.epd()` — the same spelling `services.explorer.normalize_fen` writes into
`positions.fen`, which is what lets a lookup be a dict hit rather than a translation.

    uv run python scripts/build_openings.py               # from the pinned commit
    uv run python scripts/build_openings.py --ref master  # from whatever is current
    uv run python scripts/build_openings.py --source ../chess-openings

The pinned default is what makes a regeneration reproducible: `master` moves, and a
rebuild that quietly picked up thirty new openings would be a data change nobody asked
for in a diff nobody reads. Bump `UPSTREAM_REF` deliberately when refreshing the book,
and update the provenance line in `docs/contributing.md` with it.
"""

from __future__ import annotations

import argparse
import io
import sys
import urllib.request
from collections.abc import Iterator
from pathlib import Path

import chess
import chess.pgn

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "backend" / "data" / "openings.tsv"

# The commit the vendored table was taken from (2026-08-04).
UPSTREAM_REF = "4b8622759e7ae6f93f011cc6c83a3823401ab45e"
RAW = "https://raw.githubusercontent.com/lichess-org/chess-openings"

VOLUMES = ("a", "b", "c", "d", "e")

# What upstream held at `UPSTREAM_REF`. Asserted rather than reported, because a fetch that
# silently returned a redirect page or half a file would otherwise be committed as a book.
EXPECTED_ROWS = 3810


def read_volume(name: str, *, ref: str, source: Path | None) -> str:
    if source is not None:
        return (source / f"{name}.tsv").read_text(encoding="utf-8")
    url = f"{RAW}/{ref}/{name}.tsv"
    with urllib.request.urlopen(url) as response:  # noqa: S310 — a literal https URL
        return response.read().decode("utf-8")


def rows(text: str) -> Iterator[tuple[str, str, str]]:
    """The `eco / name / pgn` triples of one volume, header dropped."""
    for number, raw in enumerate(text.splitlines(), start=1):
        if not raw.strip():
            continue
        fields = raw.split("\t")
        if len(fields) != 3:
            raise ValueError(f"line {number} has {len(fields)} fields, not 3: {raw!r}")
        if number == 1 and fields == ["eco", "name", "pgn"]:
            continue
        yield fields[0], fields[1], fields[2]


def epd_of(pgn: str) -> str:
    """The position an opening's move text arrives at, keyed the way the database keys it."""
    game = chess.pgn.read_game(io.StringIO(pgn))
    if game is None:
        raise ValueError(f"not a movetext: {pgn!r}")
    board = game.end().board()
    return board.epd()


def build(*, ref: str, source: Path | None) -> list[tuple[str, str, str]]:
    seen: dict[str, tuple[str, str, str]] = {}
    for volume in VOLUMES:
        for eco, name, pgn in rows(read_volume(volume, ref=ref, source=source)):
            epd = epd_of(pgn)
            if epd in seen:
                raise ValueError(f"two openings share {epd!r}: {seen[epd][2]!r} and {name!r}")
            seen[epd] = (epd, eco, name)
    return sorted(seen.values())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--ref", default=UPSTREAM_REF, help="the upstream commit or branch to fetch"
    )
    parser.add_argument(
        "--source", type=Path, default=None, help="a local checkout to read instead of fetching"
    )
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument(
        "--expect",
        type=int,
        default=EXPECTED_ROWS,
        help="rows the build must produce; 0 to accept whatever upstream holds",
    )
    args = parser.parse_args(argv)

    table = build(ref=args.ref, source=args.source)
    if args.expect and len(table) != args.expect:
        print(
            f"expected {args.expect} openings, built {len(table)} — "
            "pass --expect to accept a refreshed upstream",
            file=sys.stderr,
        )
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    lines = ["epd\teco\tname", *(f"{epd}\t{eco}\t{name}" for epd, eco, name in table)]
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(table)} openings -> {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

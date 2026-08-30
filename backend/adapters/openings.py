"""The vendored opening book: an EPD in, an ECO code and a name out.

`backend/data/openings.tsv` is lichess-org/chess-openings (CC0-1.0, the text is beside it
as `openings.COPYING.txt`) with the positions derived — see `scripts/build_openings.py`,
which is what regenerates it. The keys are `board.epd()`, exactly the spelling
`services.explorer.normalize_fen` writes into `positions.fen`, so a lookup is a dict hit
rather than a translation between two spellings of the same position.

An adapter in the ordinary sense: it reads a file and hands back plain data. There is no
Session here and nothing knows a database exists.

The book is shallow — 3,810 openings, most of them three to five plies in, none past
seventeen — so a position deep in a line is almost never named itself. `deepest` is the
answer to that: hand it the whole line and it reports the last position on it the book has
heard of. A lookup of only the queried position would leave most of the explorer unnamed.
"""

from __future__ import annotations

from collections.abc import Sequence
from functools import lru_cache
from pathlib import Path
from typing import NamedTuple

BOOK_PATH = Path(__file__).resolve().parents[1] / "data" / "openings.tsv"

HEADER = ("epd", "eco", "name")


class Opening(NamedTuple):
    """What the book knows about one position."""

    eco: str
    name: str


class NamedPosition(NamedTuple):
    """A named position found somewhere along a line: how far in, and what it is called."""

    index: int
    eco: str
    name: str


@lru_cache(maxsize=1)
def book() -> dict[str, Opening]:
    """The whole table, read once. Keyed by EPD, in the order the file lists them.

    Cached rather than loaded at import, so a process that only ever serves `/health` never
    pays for it, and 3,810 rows is small enough that there is nothing to page in.
    """
    table: dict[str, Opening] = {}
    with BOOK_PATH.open(encoding="utf-8") as handle:
        for number, raw in enumerate(handle, start=1):
            line = raw.rstrip("\n")
            if not line:
                continue
            fields = line.split("\t")
            if len(fields) != 3:
                raise ValueError(f"{BOOK_PATH}:{number} has {len(fields)} fields, not 3")
            if number == 1 and tuple(fields) == HEADER:
                continue
            epd, eco, name = fields
            table[epd] = Opening(eco=eco, name=name)
    return table


def find(epd: str) -> Opening | None:
    """What this exact position is called, or None when the book does not name it.

    The EPD has to be normalised already — `services.explorer.normalize_fen` is where a
    caller's FEN becomes one, and it is the same function that produced these keys.
    """
    return book().get(epd)


def deepest(epds: Sequence[str]) -> NamedPosition | None:
    """The last position along a line that the book names, or None when it names none.

    `epds` is a line root-first: index 0 is the position before any move was played, so an
    index is also the ply the name was found at. Searched backwards because the answer is
    almost always near the end of what the book covers and never further than that.
    """
    for index in range(len(epds) - 1, -1, -1):
        opening = book().get(epds[index])
        if opening is not None:
            return NamedPosition(index=index, eco=opening.eco, name=opening.name)
    return None

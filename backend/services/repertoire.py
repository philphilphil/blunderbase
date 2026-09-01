"""The owner's two opening repertoires: what they mean to play, one tree per colour.

Everywhere else in Blunderbase describes games that were played. This describes games that
have not been: a repertoire is a plan, so it is stored on its own and joins to nothing in
the library — putting intentions into `positions` would make the explorer's counts lie
about what the owner has actually done.

The rules worth knowing before reading the code:

* There are exactly two trees, keyed by the colour the *owner* plays. A node's `parent_id`
  is the move it answers, and a NULL parent is a first move from the standard start
  position — there is no root row, because the start position is not a choice.
* Siblings are ordered by `rank`, and rank 0 is the main line. Promoting a move renumbers
  its siblings rather than setting a flag, so "the main move" is a property of the order
  and cannot be true of two moves at once. Deleting one renumbers what is left for the
  same reason: a set with a hole where rank 0 was would be a position whose repertoire has
  no main move, and a new move added to it would land in the middle of the list.
* A line is added by replaying it from `chess.Board()`. That is what validates it — an
  illegal move is a `RepertoireError`, never a row — and it is also where the SAN comes
  from, so a stored SAN can never disagree with the position it was written in.
* Every node stores the normalised EPD *after* its move, through the explorer's own
  `normalize_fen`. That is what makes a lookup from a board transposition-aware:
  `subtrees_at` answers "what does my repertoire say here" for a position reached any way
  at all, without walking a path.
* Adding a line is idempotent: a move already stored under the walked parent is reused, so
  re-adding a line that is already in the tree creates nothing and changes no ranks.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from backend.db.enums import Color
from backend.db.models import RepertoireMove
from backend.db.types import utcnow
from backend.services.explorer import normalize_fen

# What "the caller said nothing about the comment" looks like. `None` cannot be it: the
# contract gives `None` the meaning "clear it", and the two have to stay tellable apart.
UNCHANGED: Any = object()


class RepertoireError(ValueError):
    """A line that could not be played, or one with no moves in it."""


def tree(session: Session, color: Color) -> dict[str, Any]:
    """One colour's whole repertoire, as nested nodes.

    One SELECT and an assembly in Python rather than a walk per level: a repertoire is
    hundreds of rows at most, and a recursive query would be one round trip per ply for a
    payload the caller wants whole anyway.
    """
    rows = _rows(session, color)
    _nodes, roots = _assemble(rows)
    return {"color": str(color), "moves": roots}


def add_line(session: Session, color: Color, ucis: Sequence[str]) -> dict[str, Any]:
    """Store a line from the start position, creating only the moves that are missing.

    The whole line is replayed before any of it is written, which is what makes a bad line
    change nothing at all: the tenth move being illegal must not leave the first nine
    behind. Returns how many nodes were created and the tip the line ends on.
    """
    wanted = [str(uci).strip() for uci in ucis or () if str(uci).strip()]
    if not wanted:
        raise RepertoireError("a repertoire line needs at least one move in UCI")
    steps = _replay(wanted)

    parent_id: int | None = None
    node: RepertoireMove | None = None
    created = 0
    for uci, san, epd in steps:
        node = _child(session, color, parent_id, uci)
        if node is None:
            node = RepertoireMove(
                color=color,
                parent_id=parent_id,
                move_uci=uci,
                move_san=san,
                epd=epd,
                comment="",
                rank=_next_rank(session, color, parent_id),
            )
            session.add(node)
            session.flush()
            created += 1
        parent_id = node.id

    session.commit()
    # The loop ran at least once, because `wanted` is not empty.
    assert node is not None
    return {"created": created, "tip": move_payload(node)}


def update_move(
    session: Session,
    move_id: int,
    *,
    comment: str | None = UNCHANGED,
    promote: bool = False,
) -> dict[str, Any]:
    """Rewrite a move's comment, promote it to the main line, or both.

    `comment=None` clears the comment; leaving the argument out leaves it alone. Promoting
    is a renumbering of the whole sibling set — the promoted move takes rank 0 and the
    others keep their order below it — which is what stops two moves both claiming to be
    the main line.
    """
    row = _get(session, move_id)
    if comment is not UNCHANGED:
        row.comment = str(comment).strip() if comment is not None else ""
    if promote:
        _promote(session, row)
    row.updated_at = utcnow()
    session.commit()
    return move_payload(row)


def delete_move(session: Session, move_id: int) -> None:
    """Forget a move and everything the repertoire said after it.

    The descendants are collected in Python and deleted by id rather than left to a
    cascade: SQLite enforces foreign keys only where the pragma is on for the connection,
    and a repertoire is small enough that a level-at-a-time walk is the honest version.
    """
    row = _get(session, move_id)
    color, parent_id = row.color, row.parent_id
    doomed = _descendants(session, row)
    session.execute(delete(RepertoireMove).where(RepertoireMove.id.in_(doomed)))
    session.flush()
    # The survivors close ranks. Leaving the gap would leave a sibling set with no rank 0
    # in it, and "rank 0 is the main line" is the only thing that says which move is the
    # main line — a reader that believes the contract would find the position had none.
    _renumber(session, color, parent_id)
    session.commit()


def subtrees_at(session: Session, color: Color, fen: str) -> list[dict[str, Any]]:
    """What the repertoire says in a position, however it was reached.

    Matched on the stored EPD rather than on a path, so a transposition finds the same
    preparation as the move order it was entered under. Each hit carries the path from the
    start position that reaches it and the subtree that continues from it. Read-only.
    """
    epd, _zobrist, _side = normalize_fen(fen)
    rows = _rows(session, color)
    nodes, _roots = _assemble(rows)
    by_id = {row.id: row for row in rows}
    return [
        {"path": _path(row, by_id), "node": nodes[row.id]}
        for row in rows
        if row.epd == epd
    ]


def move_payload(
    row: RepertoireMove, children: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    """One node as every surface reads it. `children` is left out where it is not asked for."""
    payload: dict[str, Any] = {
        "id": row.id,
        "uci": row.move_uci,
        "san": row.move_san,
        # Never null in a payload: "no comment" and "the comment is empty" are the same
        # thing here, and a client that renders one should not have to check for both.
        "comment": row.comment or "",
        "rank": row.rank,
        "epd": row.epd,
    }
    if children is not None:
        payload["children"] = children
    return payload


# --- internals -------------------------------------------------------------


def _replay(ucis: Sequence[str]) -> list[tuple[str, str, str]]:
    """A line from the start position as `(uci, san, epd)` per move, or a `RepertoireError`.

    Nothing here touches the database: this is the whole of the validation, and it runs to
    the end of the line before the first row is written.
    """
    import chess

    board = chess.Board()
    steps: list[tuple[str, str, str]] = []
    for uci in ucis:
        try:
            move = board.parse_uci(uci)
        except ValueError as exc:
            raise RepertoireError(f"{uci!r} cannot be played here: {exc}") from None
        # `parse_uci` promises a move that is "either legal or a null move" — the null move
        # `0000` is returned before the legality check runs at all. It is not something a
        # repertoire can hold: it would store a node with SAN `--` whose EPD is the parent
        # position with the side to move flipped, which would then match transpositions in
        # `subtrees_at` and could only be got rid of by hand.
        if not move:
            raise RepertoireError(f"{uci!r} is not a move")
        san = board.san(move)
        board.push(move)
        epd, _zobrist, _side = normalize_fen(board.fen())
        steps.append((uci, san, epd))
    return steps


def _rows(session: Session, color: Color) -> list[RepertoireMove]:
    """Every node of one tree, siblings already in the order they are shown in."""
    return list(
        session.scalars(
            select(RepertoireMove)
            .where(RepertoireMove.color == color)
            .order_by(RepertoireMove.rank, RepertoireMove.id)
        )
    )


def _assemble(
    rows: Sequence[RepertoireMove],
) -> tuple[dict[int, dict[str, Any]], list[dict[str, Any]]]:
    """The rows as payloads hung off each other, plus the first moves.

    The rows arrive in sibling order, so appending each node to its parent as it comes is
    what puts the children in order — no sort per level.
    """
    nodes = {row.id: move_payload(row, children=[]) for row in rows}
    roots: list[dict[str, Any]] = []
    for row in rows:
        if row.parent_id is None:
            roots.append(nodes[row.id])
            continue
        parent = nodes.get(row.parent_id)
        if parent is not None:
            parent["children"].append(nodes[row.id])
    return nodes, roots


def _path(row: RepertoireMove, by_id: dict[int, RepertoireMove]) -> list[dict[str, Any]]:
    """The moves from the start position up to and including this one."""
    walked: list[RepertoireMove] = []
    current: RepertoireMove | None = row
    while current is not None:
        walked.append(current)
        current = by_id.get(current.parent_id) if current.parent_id is not None else None
    return [move_payload(step) for step in reversed(walked)]


def _get(session: Session, move_id: int) -> RepertoireMove:
    row = session.get(RepertoireMove, int(move_id))
    if row is None:
        raise LookupError(f"no repertoire move with id {move_id}")
    return row


def _child(
    session: Session, color: Color, parent_id: int | None, uci: str
) -> RepertoireMove | None:
    """The move already stored under a parent, which is what makes re-adding a line free."""
    return session.scalars(
        select(RepertoireMove)
        .where(
            RepertoireMove.color == color,
            RepertoireMove.parent_id.is_(None)
            if parent_id is None
            else RepertoireMove.parent_id == parent_id,
            RepertoireMove.move_uci == uci,
        )
        .order_by(RepertoireMove.id)
    ).first()


def _next_rank(session: Session, color: Color, parent_id: int | None) -> int:
    """Where a new sibling goes: below every sibling it has, or 0 when it is the first.

    One past the highest rank in the set rather than a count of it. A count is the same
    number only while the ranks are 0..n-1, and it collides with an existing sibling the
    moment they are not — which would put a move added later in the *middle* of the list,
    the one place "a new move is an alternative below its siblings" does not allow.
    """
    return max((sibling.rank for sibling in _siblings(session, color, parent_id)), default=-1) + 1


def _siblings(session: Session, color: Color, parent_id: int | None) -> list[RepertoireMove]:
    return list(
        session.scalars(
            select(RepertoireMove)
            .where(
                RepertoireMove.color == color,
                RepertoireMove.parent_id.is_(None)
                if parent_id is None
                else RepertoireMove.parent_id == parent_id,
            )
            .order_by(RepertoireMove.rank, RepertoireMove.id)
        )
    )


def _promote(session: Session, row: RepertoireMove) -> None:
    """Make a move the main line, keeping the order of the ones it steps in front of."""
    _apply_ranks(
        [row]
        + [
            sibling
            for sibling in _siblings(session, row.color, row.parent_id)
            if sibling.id != row.id
        ]
    )


def _renumber(session: Session, color: Color, parent_id: int | None) -> None:
    """Rank a sibling set 0..n-1 again, in the order it is already read in."""
    _apply_ranks(_siblings(session, color, parent_id))


def _apply_ranks(order: Sequence[RepertoireMove]) -> None:
    """Number a sibling set from the top. Only the rows that move are touched."""
    for rank, sibling in enumerate(order):
        if sibling.rank != rank:
            sibling.rank = rank
            sibling.updated_at = utcnow()


def _descendants(session: Session, row: RepertoireMove) -> list[int]:
    """A node's id and every id below it, a level at a time."""
    collected = [row.id]
    frontier = [row.id]
    while frontier:
        children = list(
            session.scalars(
                select(RepertoireMove.id).where(RepertoireMove.parent_id.in_(frontier))
            )
        )
        collected.extend(children)
        frontier = children
    return collected

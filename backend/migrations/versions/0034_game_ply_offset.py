"""games carry the parity of their start; collection ids are never reused

`games.ply_offset` is `games.ply_offset(start_fen)` stored on the row. `build_card`, the game
view and Maia's owner plies already number a game set up from a position from its own start
(0033), but "the owner's moves" in SQL — Stats, the per-game stat fold, the library's "has
blunders" — still read ply parity as if every game began with White's first move, so in a
game with Black to move first they counted the opponent's moves as the owner's. The column
is what that condition now reads. It is backfilled here from the PGN's FEN header, read the
way `games.start_fen` reads it and shifted the way `games.ply_offset` shifts, both copied
rather than imported for the reason 0033 gives.

Only an odd offset changes whose move a ply is, and for those games two stored answers were
folded on the wrong side:

- the stat summary and its columns are cleared, so the backfill sweep folds them again
  (the full scan answers until it has);
- a run that kept Maia policies on one side only (`maia_both_sides` off) kept them on the
  opponent's plies. Those policies are cleared, so `_settled_maia_levels` no longer counts
  the level as there and the Maia fill asks for it again. A run that kept both sides was
  right all along and is left alone.

`collections` is rebuilt with AUTOINCREMENT. SQLite otherwise hands the id of the newest
collection, once deleted, to the next one made — and a rule book loaded by another process
(a CLI sync) or a bookmarked `/games?collection=` would then point at the new collection.
The rebuild keeps every id; the foreign keys are off during migrations (`env.py`).

The downgrade drops the column and rebuilds `collections` without AUTOINCREMENT; the
cleared summaries and policies were wrong and are not put back.

Revision ID: 0034_game_ply_offset
Revises: 0033_start_position_cards
Create Date: 2026-09-28 12:00:00.000000

"""

from __future__ import annotations

import re

import sqlalchemy as sa
from alembic import op

revision = "0034_game_ply_offset"
down_revision = "0033_start_position_cards"
branch_labels = None
depends_on = None

_FEN_HEADER = re.compile(r'^\s*\[FEN\s+"([^"]*)"\s*\]', re.MULTILINE)


def _offset(pgn: str | None) -> int:
    """`games.ply_offset` of the start FEN in this PGN; 0 without one."""
    match = _FEN_HEADER.search(pgn or "")
    if match is None:
        return 0
    fields = match.group(1).split()
    if not fields:
        return 0
    black = len(fields) > 1 and fields[1].lower() == "b"
    try:
        fullmove = max(int(fields[5]), 1) if len(fields) > 5 else 1
    except ValueError:
        fullmove = 1
    return 2 * (fullmove - 1) + (1 if black else 0)


def upgrade() -> None:
    with op.batch_alter_table("games", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("ply_offset", sa.Integer(), nullable=False, server_default="0")
        )

    bind = op.get_bind()
    offsets = [
        {"id": row[0], "offset": offset}
        for row in bind.execute(sa.text("SELECT id, pgn FROM games WHERE pgn LIKE '%[FEN %'"))
        if (offset := _offset(row[1]))
    ]
    if offsets:
        bind.execute(sa.text("UPDATE games SET ply_offset = :offset WHERE id = :id"), offsets)

    odd = [{"id": item["id"]} for item in offsets if item["offset"] % 2]
    if odd:
        bind.execute(
            sa.text(
                "UPDATE games SET stat_summary = NULL, stat_owner_moves = NULL, "
                "stat_blunders = NULL, stat_worst_win_loss = NULL WHERE id = :id"
            ),
            odd,
        )
        one_sided = [
            {"run_id": row[0]}
            for item in odd
            for row in bind.execute(
                sa.text(
                    "SELECT move_evals.run_id FROM move_evals "
                    "JOIN analysis_runs ON analysis_runs.id = move_evals.run_id "
                    "WHERE analysis_runs.game_id = :id AND move_evals.maia_policy IS NOT NULL "
                    "GROUP BY move_evals.run_id HAVING COUNT(DISTINCT move_evals.ply % 2) = 1"
                ),
                item,
            )
        ]
        if one_sided:
            bind.execute(
                sa.text("UPDATE move_evals SET maia_policy = NULL WHERE run_id = :run_id"),
                one_sided,
            )

    with op.batch_alter_table(
        "collections", recreate="always", table_kwargs={"sqlite_autoincrement": True}
    ) as batch_op:
        pass


def downgrade() -> None:
    with op.batch_alter_table(
        "collections", recreate="always", table_kwargs={"sqlite_autoincrement": False}
    ) as batch_op:
        pass
    with op.batch_alter_table("games", schema=None) as batch_op:
        batch_op.drop_column("ply_offset")

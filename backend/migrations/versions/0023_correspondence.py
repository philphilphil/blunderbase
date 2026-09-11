"""correspondence games, their tree, its evaluations and the searches over it

Correspondence play is the one mode where the work is not the game's move list but the
tree of candidate moves behind it, so it needs tables of its own: `correspondence_games`
is the live state of a game being played over months, `correspondence_nodes` is the tree,
`correspondence_evals` is what an engine knows about a position, and
`correspondence_searches` is the engine work itself.

Three of the four cascade from `games.id` — a correspondence game *is* a `Game`, and
deleting it takes its tree and the searches inside it. `correspondence_evals` deliberately
does not: it is keyed by the position rather than by a node, so a transposition, a second
game and a node deleted and added again all read the same verdict, and the row outlives
every node that ever pointed at it.

`analysis_runs` gains one nullable column so a bounded task's run can hand its evaluation
back to the tree. It carries no foreign key on purpose: `correspondence_searches.run_id`
points the other way, two enforced references between one pair of tables is a cycle, and
a constraint here would mean a batch rebuild of `analysis_runs` — which on SQLite would
recreate the mixed-direction claim index without its directions.

Revision ID: 0023_correspondence
Revises: 0022_single_owner
Create Date: 2026-09-11 08:00:00.000000

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0023_correspondence"
down_revision = "0022_single_owner"
branch_labels = None
depends_on = None

RUN_COLUMN = "correspondence_search_id"
RUN_INDEX = "ix_analysis_runs_correspondence_search_id"


def upgrade() -> None:
    op.create_table(
        "correspondence_games",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("game_id", sa.Integer(), nullable=False),
        sa.Column("event", sa.String(length=128), nullable=True),
        sa.Column("url", sa.String(length=512), nullable=True),
        sa.Column("reply_due", sa.DateTime(), nullable=True),
        sa.Column("days_per_move", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("last_move_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["game_id"], ["games.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("game_id", name="uq_correspondence_games_game_id"),
    )
    op.create_index("ix_correspondence_games_reply_due", "correspondence_games", ["reply_due"])

    op.create_table(
        "correspondence_nodes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("game_id", sa.Integer(), nullable=False),
        sa.Column("parent_id", sa.Integer(), nullable=True),
        sa.Column("move_uci", sa.String(length=8), nullable=True),
        sa.Column("move_san", sa.String(length=16), nullable=True),
        sa.Column("epd", sa.String(length=120), nullable=False),
        sa.Column("ply", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rank", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("played", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("pinned_engine_id", sa.Integer(), nullable=True),
        sa.Column("mark", sa.String(length=32), nullable=True),
        sa.Column("conditional", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("comment", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["game_id"], ["games.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parent_id"], ["correspondence_nodes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["pinned_engine_id"], ["engines.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "parent_id", "move_uci", name="uq_correspondence_nodes_parent_id_move_uci"
        ),
    )
    op.create_index(
        "ix_correspondence_nodes_game_id_parent_id",
        "correspondence_nodes",
        ["game_id", "parent_id"],
    )
    op.create_index("ix_correspondence_nodes_epd", "correspondence_nodes", ["epd"])

    op.create_table(
        "correspondence_evals",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("epd", sa.String(length=120), nullable=False),
        sa.Column("engine_id", sa.Integer(), nullable=True),
        sa.Column("engine_name", sa.String(length=64), nullable=False),
        sa.Column("engine_version", sa.String(length=64), nullable=True),
        sa.Column("cp", sa.Integer(), nullable=True),
        sa.Column("mate", sa.Integer(), nullable=True),
        sa.Column("depth", sa.Integer(), nullable=True),
        sa.Column("nodes", sa.Integer(), nullable=True),
        sa.Column("time_ms", sa.Integer(), nullable=True),
        sa.Column("best_lines", sa.JSON(none_as_null=True), nullable=True),
        sa.Column("history", sa.JSON(), nullable=False),
        sa.Column("tablebase", sa.JSON(none_as_null=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["engine_id"], ["engines.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("epd", "engine_id", name="uq_correspondence_evals_epd_engine_id"),
    )
    op.create_index("ix_correspondence_evals_epd", "correspondence_evals", ["epd"])

    op.create_table(
        "correspondence_searches",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("node_id", sa.Integer(), nullable=False),
        sa.Column("engine_id", sa.Integer(), nullable=True),
        sa.Column("multipv", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=True),
        sa.Column("limit_depth", sa.Integer(), nullable=True),
        sa.Column("limit_nodes", sa.Integer(), nullable=True),
        sa.Column("limit_seconds", sa.Integer(), nullable=True),
        sa.Column("root_moves", sa.JSON(none_as_null=True), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("warm", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("runner_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("paused_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("heartbeat_at", sa.DateTime(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("stderr", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["node_id"], ["correspondence_nodes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["engine_id"], ["engines.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["runner_id"], ["runners.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_correspondence_searches_node_id", "correspondence_searches", ["node_id"])
    op.create_index("ix_correspondence_searches_status", "correspondence_searches", ["status"])

    # A plain nullable column, so SQLite adds it in place rather than rebuilding the table
    # the analysis queue claims out of.
    op.add_column("analysis_runs", sa.Column(RUN_COLUMN, sa.Integer(), nullable=True))
    op.create_index(RUN_INDEX, "analysis_runs", [RUN_COLUMN])


def downgrade() -> None:
    op.drop_index(RUN_INDEX, table_name="analysis_runs")
    with op.batch_alter_table("analysis_runs", schema=None) as batch_op:
        batch_op.drop_column(RUN_COLUMN)

    op.drop_index("ix_correspondence_searches_status", table_name="correspondence_searches")
    op.drop_index("ix_correspondence_searches_node_id", table_name="correspondence_searches")
    op.drop_table("correspondence_searches")

    op.drop_index("ix_correspondence_evals_epd", table_name="correspondence_evals")
    op.drop_table("correspondence_evals")

    op.drop_index("ix_correspondence_nodes_epd", table_name="correspondence_nodes")
    op.drop_index("ix_correspondence_nodes_game_id_parent_id", table_name="correspondence_nodes")
    op.drop_table("correspondence_nodes")

    op.drop_index("ix_correspondence_games_reply_due", table_name="correspondence_games")
    op.drop_table("correspondence_games")

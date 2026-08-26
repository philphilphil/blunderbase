"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-08-25 21:11:01.643335

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('accounts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('platform', sa.String(length=32), nullable=False),
    sa.Column('username', sa.String(length=64), nullable=False),
    sa.Column('display_name', sa.String(length=128), nullable=True),
    sa.Column('is_owner', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_accounts')),
    sa.UniqueConstraint('platform', 'username', name='uq_accounts_platform_username')
    )
    op.create_table('engines',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=64), nullable=False),
    sa.Column('kind', sa.String(length=32), nullable=False),
    sa.Column('path', sa.String(length=512), nullable=False),
    sa.Column('version', sa.String(length=64), nullable=True),
    sa.Column('options', sa.JSON(), nullable=False),
    sa.Column('enabled', sa.Boolean(), nullable=False),
    sa.Column('default_tier', sa.String(length=32), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_engines')),
    sa.UniqueConstraint('name', name=op.f('uq_engines_name'))
    )
    op.create_table('positions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('fen', sa.String(length=120), nullable=False),
    sa.Column('zobrist_key', sa.String(length=16), nullable=False),
    sa.Column('side_to_move', sa.String(length=32), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_positions')),
    sa.UniqueConstraint('fen', name=op.f('uq_positions_fen'))
    )
    with op.batch_alter_table('positions', schema=None) as batch_op:
        batch_op.create_index('ix_positions_zobrist_key', ['zobrist_key'], unique=False)

    op.create_table('import_jobs',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('source', sa.String(length=32), nullable=False),
    sa.Column('account_id', sa.Integer(), nullable=True),
    sa.Column('status', sa.String(length=32), nullable=False),
    sa.Column('cursor', sa.String(length=128), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('started_at', sa.DateTime(), nullable=True),
    sa.Column('finished_at', sa.DateTime(), nullable=True),
    sa.Column('games_seen', sa.Integer(), nullable=False),
    sa.Column('games_imported', sa.Integer(), nullable=False),
    sa.Column('games_skipped', sa.Integer(), nullable=False),
    sa.Column('games_failed', sa.Integer(), nullable=False),
    sa.Column('errors', sa.JSON(), nullable=False),
    sa.Column('message', sa.Text(), nullable=True),
    sa.ForeignKeyConstraint(['account_id'], ['accounts.id'], name=op.f('fk_import_jobs_account_id_accounts')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_import_jobs'))
    )
    with op.batch_alter_table('import_jobs', schema=None) as batch_op:
        batch_op.create_index('ix_import_jobs_source_created_at', ['source', 'created_at'], unique=False)

    op.create_table('games',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('source', sa.String(length=32), nullable=False),
    sa.Column('source_id', sa.String(length=64), nullable=True),
    sa.Column('dedup_hash', sa.String(length=64), nullable=False),
    sa.Column('white_name', sa.String(length=128), nullable=False),
    sa.Column('black_name', sa.String(length=128), nullable=False),
    sa.Column('white_rating', sa.Integer(), nullable=True),
    sa.Column('black_rating', sa.Integer(), nullable=True),
    sa.Column('white_account_id', sa.Integer(), nullable=True),
    sa.Column('black_account_id', sa.Integer(), nullable=True),
    sa.Column('owner_color', sa.String(length=32), nullable=True),
    sa.Column('result', sa.String(length=32), nullable=False),
    sa.Column('termination', sa.String(length=64), nullable=True),
    sa.Column('variant', sa.String(length=32), nullable=False),
    sa.Column('rated', sa.Boolean(), nullable=True),
    sa.Column('speed', sa.String(length=32), nullable=True),
    sa.Column('time_control', sa.String(length=32), nullable=True),
    sa.Column('initial_clock', sa.Integer(), nullable=True),
    sa.Column('increment', sa.Integer(), nullable=True),
    sa.Column('eco', sa.String(length=8), nullable=True),
    sa.Column('opening_name', sa.String(length=128), nullable=True),
    sa.Column('played_at', sa.DateTime(), nullable=True),
    sa.Column('imported_at', sa.DateTime(), nullable=False),
    sa.Column('pgn', sa.Text(), nullable=False),
    sa.Column('moves_uci', sa.JSON(), nullable=False),
    sa.Column('moves_san', sa.JSON(), nullable=False),
    sa.Column('clocks', sa.JSON(), nullable=True),
    sa.Column('ply_count', sa.Integer(), nullable=False),
    sa.Column('import_job_id', sa.Integer(), nullable=True),
    sa.ForeignKeyConstraint(['black_account_id'], ['accounts.id'], name=op.f('fk_games_black_account_id_accounts')),
    sa.ForeignKeyConstraint(['import_job_id'], ['import_jobs.id'], name=op.f('fk_games_import_job_id_import_jobs')),
    sa.ForeignKeyConstraint(['white_account_id'], ['accounts.id'], name=op.f('fk_games_white_account_id_accounts')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_games')),
    sa.UniqueConstraint('source', 'source_id', name='uq_games_source_source_id')
    )
    with op.batch_alter_table('games', schema=None) as batch_op:
        batch_op.create_index('ix_games_dedup_hash', ['dedup_hash'], unique=False)
        batch_op.create_index('ix_games_played_at', ['played_at'], unique=False)

    op.create_table('analysis_runs',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('game_id', sa.Integer(), nullable=True),
    sa.Column('fen', sa.String(length=120), nullable=True),
    sa.Column('engine_id', sa.Integer(), nullable=True),
    sa.Column('tier', sa.String(length=32), nullable=False),
    sa.Column('status', sa.String(length=32), nullable=False),
    sa.Column('depth', sa.Integer(), nullable=True),
    sa.Column('nodes', sa.Integer(), nullable=True),
    sa.Column('multipv', sa.Integer(), nullable=False),
    sa.Column('ply_start', sa.Integer(), nullable=True),
    sa.Column('ply_end', sa.Integer(), nullable=True),
    sa.Column('priority', sa.Integer(), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('started_at', sa.DateTime(), nullable=True),
    sa.Column('finished_at', sa.DateTime(), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('stderr', sa.Text(), nullable=True),
    sa.ForeignKeyConstraint(['engine_id'], ['engines.id'], name=op.f('fk_analysis_runs_engine_id_engines')),
    sa.ForeignKeyConstraint(['game_id'], ['games.id'], name=op.f('fk_analysis_runs_game_id_games'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_analysis_runs'))
    )
    with op.batch_alter_table('analysis_runs', schema=None) as batch_op:
        batch_op.create_index('ix_analysis_runs_game_id', ['game_id'], unique=False)
        batch_op.create_index('ix_analysis_runs_status_priority_created_at', ['status', 'priority', 'created_at'], unique=False)

    op.create_table('game_positions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('game_id', sa.Integer(), nullable=False),
    sa.Column('ply', sa.Integer(), nullable=False),
    sa.Column('position_id', sa.Integer(), nullable=False),
    sa.Column('move_uci', sa.String(length=8), nullable=True),
    sa.Column('move_san', sa.String(length=16), nullable=True),
    sa.ForeignKeyConstraint(['game_id'], ['games.id'], name=op.f('fk_game_positions_game_id_games'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['position_id'], ['positions.id'], name=op.f('fk_game_positions_position_id_positions')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_game_positions')),
    sa.UniqueConstraint('game_id', 'ply', name='uq_game_positions_game_id_ply')
    )
    with op.batch_alter_table('game_positions', schema=None) as batch_op:
        batch_op.create_index('ix_game_positions_position_id', ['position_id'], unique=False)

    op.create_table('notes',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('tags', sa.JSON(), nullable=False),
    sa.Column('game_id', sa.Integer(), nullable=True),
    sa.Column('position_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['game_id'], ['games.id'], name=op.f('fk_notes_game_id_games'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['position_id'], ['positions.id'], name=op.f('fk_notes_position_id_positions')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_notes'))
    )
    with op.batch_alter_table('notes', schema=None) as batch_op:
        batch_op.create_index('ix_notes_created_at', ['created_at'], unique=False)
        batch_op.create_index('ix_notes_game_id', ['game_id'], unique=False)

    op.create_table('move_evals',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('run_id', sa.Integer(), nullable=False),
    sa.Column('ply', sa.Integer(), nullable=False),
    sa.Column('position_id', sa.Integer(), nullable=True),
    sa.Column('move_uci', sa.String(length=8), nullable=True),
    sa.Column('move_san', sa.String(length=16), nullable=True),
    sa.Column('eval_before_cp', sa.Integer(), nullable=True),
    sa.Column('eval_before_mate', sa.Integer(), nullable=True),
    sa.Column('eval_after_cp', sa.Integer(), nullable=True),
    sa.Column('eval_after_mate', sa.Integer(), nullable=True),
    sa.Column('win_before', sa.Float(), nullable=True),
    sa.Column('win_after', sa.Float(), nullable=True),
    sa.Column('win_loss', sa.Float(), nullable=True),
    sa.Column('classification', sa.String(length=32), nullable=True),
    sa.Column('best_move_uci', sa.String(length=8), nullable=True),
    sa.Column('best_lines', sa.JSON(), nullable=True),
    sa.Column('maia_policy', sa.JSON(), nullable=True),
    sa.ForeignKeyConstraint(['position_id'], ['positions.id'], name=op.f('fk_move_evals_position_id_positions')),
    sa.ForeignKeyConstraint(['run_id'], ['analysis_runs.id'], name=op.f('fk_move_evals_run_id_analysis_runs'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_move_evals')),
    sa.UniqueConstraint('run_id', 'ply', name='uq_move_evals_run_id_ply')
    )


def downgrade() -> None:
    op.drop_table('move_evals')
    with op.batch_alter_table('notes', schema=None) as batch_op:
        batch_op.drop_index('ix_notes_game_id')
        batch_op.drop_index('ix_notes_created_at')

    op.drop_table('notes')
    with op.batch_alter_table('game_positions', schema=None) as batch_op:
        batch_op.drop_index('ix_game_positions_position_id')

    op.drop_table('game_positions')
    with op.batch_alter_table('analysis_runs', schema=None) as batch_op:
        batch_op.drop_index('ix_analysis_runs_status_priority_created_at')
        batch_op.drop_index('ix_analysis_runs_game_id')

    op.drop_table('analysis_runs')
    with op.batch_alter_table('games', schema=None) as batch_op:
        batch_op.drop_index('ix_games_played_at')
        batch_op.drop_index('ix_games_dedup_hash')

    op.drop_table('games')
    with op.batch_alter_table('import_jobs', schema=None) as batch_op:
        batch_op.drop_index('ix_import_jobs_source_created_at')

    op.drop_table('import_jobs')
    with op.batch_alter_table('positions', schema=None) as batch_op:
        batch_op.drop_index('ix_positions_zobrist_key')

    op.drop_table('positions')
    op.drop_table('engines')
    op.drop_table('accounts')

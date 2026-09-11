"""Correspondence tasks: the bounded engine mode, and the expansion it unwinds.

A task is the one place the mode's two queues meet. It is an `AnalysisRun` over one node's
position — so it is claimed, retried, failed and cleared by machinery that knows nothing
about trees — and a `correspondence_searches` row, so the tree can draw a queue mark on the
node and find its way back when the answer lands. Everything here is about that seam:

* the two rows point at each other, and neither is left pointing at nothing when the other
  goes (cancel, a cleared queue, a deleted branch);
* the answer reaches the eval table **forward only** and in the **mover's frame**, which is
  two conversions a task shares with nothing else — a run's `best_lines` are in White's;
* an expansion is carried on the row rather than in anybody's memory, because hours and a
  restart may pass between queueing a task and absorbing it, and the marks steer what it
  spends that time on;
* the nearest deadline is worked first, which is a priority and not a hope.

The last test drives the real analysis workers against `fake_uci`, so the whole path is
exercised once: a queued task, a subprocess, a `MoveEval`, and a verdict in the tree.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import chess
import pytest
from fake_uci import STOCKFISH_OPTIONS, fake_engine_command
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from backend.api.app import create_app
from backend.config import Settings
from backend.db.base import Base
from backend.db.enums import Color, EngineKind, RunStatus, SearchKind, SearchStatus, Tier
from backend.db.models import (
    AnalysisRun,
    CorrespondenceEval,
    CorrespondenceNode,
    CorrespondenceSearch,
    Engine,
    MoveEval,
)
from backend.db.session import create_db_engine
from backend.services import analysis as analysis_service
from backend.services import app_settings as app_settings_service
from backend.services import correspondence as correspondence_service
from backend.services import engines as engines_service
from backend.services import games as games_service
from backend.workers import AnalysisWorkers
from tests.conftest import running_app

# Two lines out of one position, which is what an expansion of width two is made of.
LINES = [
    {"multipv": 1, "cp": 30, "mate": None, "pv": ["e2e4", "e7e5"]},
    {"multipv": 2, "cp": 18, "mate": None, "pv": ["d2d4", "d7d5"]},
    {"multipv": 3, "cp": 5, "mate": None, "pv": ["g1f3", "g8f6"]},
]


# White to move and Ra8 is mate; Rb1 is the quiet alternative it has to beat.
MATE_IN_ONE = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"


# --- helpers ---------------------------------------------------------------


def went_quiet(session: Session, run: AnalysisRun) -> None:
    """Age a claimed run's heartbeat: whatever was working on it is gone."""
    run.heartbeat_at = datetime.now(UTC) - timedelta(
        seconds=analysis_service.STALE_AFTER_SECONDS * 2
    )
    session.commit()


def add_engine(session: Session, name: str = "Stockfish", version: str = "17") -> Engine:
    engine = Engine(
        name=name, kind=EngineKind.UCI, path=f"/usr/bin/{name.lower()}", version=version
    )
    session.add(engine)
    session.commit()
    engines_service.assign_default_roles(session, engine)
    return engine


def make_game(session: Session, **changes: Any) -> dict[str, Any]:
    fields: dict[str, Any] = {
        "white": "Baum, Philipp",
        "black": "Gegner, Ein",
        "owner_color": Color.WHITE,
        "iccf_id": "1234567",
    }
    fields.update(changes)
    return correspondence_service.create_game(session, **fields)


def store_eval(
    session: Session,
    epd: str,
    engine: Engine | None,
    *,
    cp: int = 30,
    mate: int | None = None,
    depth: int = 40,
    lines: list[dict[str, Any]] | None = None,
    version: str | None = "17",
) -> CorrespondenceEval:
    """One verdict already in the table, as a search would have left it."""
    row = CorrespondenceEval(
        epd=epd,
        engine_id=engine.id if engine else None,
        engine_name=engine.name if engine else "Stockfish",
        engine_version=version,
        cp=cp,
        mate=mate,
        depth=depth,
        nodes=1_000_000,
        best_lines=lines if lines is not None else LINES,
        history=[],
    )
    session.add(row)
    session.commit()
    return row


def answer(
    session: Session,
    search: dict[str, Any],
    *,
    cp: int | None = 25,
    mate: int | None = None,
    depth: int = 40,
    nodes: int = 1_000_000,
    lines: list[dict[str, Any]] | None = None,
    best: str | None = "e2e4",
) -> AnalysisRun:
    """The task's run finished, exactly as a worker would finish it.

    `lines` are in White's frame, because that is the frame a run's `best_lines` are stored
    in — which is the conversion `absorb_run` has to get right.
    """
    run = session.get(AnalysisRun, search["run_id"])
    assert run is not None
    run.status = RunStatus.RUNNING
    session.commit()
    analysis_service.complete_run(
        session,
        run,
        [
            MoveEval(
                ply=0,
                eval_before_cp=cp,
                eval_before_mate=mate,
                depth=depth,
                nodes=nodes,
                best_move_uci=best,
                best_lines=lines if lines is not None else LINES,
            )
        ],
    )
    return run


def child_sans(session: Session, node_id: int) -> list[str]:
    return [
        node.move_san
        for node in session.scalars(
            select(CorrespondenceNode)
            .where(CorrespondenceNode.parent_id == node_id)
            .order_by(CorrespondenceNode.rank)
        )
    ]


def child_named(session: Session, node_id: int, san: str) -> CorrespondenceNode:
    return session.scalars(
        select(CorrespondenceNode).where(
            CorrespondenceNode.parent_id == node_id, CorrespondenceNode.move_san == san
        )
    ).one()


def tasks_on(session: Session, node_id: int) -> list[CorrespondenceSearch]:
    return list(
        session.scalars(
            select(CorrespondenceSearch).where(
                CorrespondenceSearch.node_id == node_id,
                CorrespondenceSearch.kind == SearchKind.TASK,
            )
        )
    )


def node_in(tree: dict[str, Any], *sans: str) -> dict[str, Any]:
    node = tree
    for san in sans:
        node = next(child for child in node["children"] if child["san"] == san)
    return node


# --- queueing --------------------------------------------------------------


def test_a_task_is_a_search_row_and_a_run_pointing_at_each_other(session: Session) -> None:
    engine = add_engine(session)
    game = make_game(session)
    root = game["tree"]["id"]

    search = correspondence_service.queue_task(session, node_id=root)

    row = session.get(CorrespondenceSearch, search["id"])
    run = session.get(AnalysisRun, search["run_id"])
    assert row is not None and run is not None
    assert row.kind is SearchKind.TASK
    assert row.status is SearchStatus.QUEUED
    assert run.correspondence_search_id == row.id
    assert row.run_id == run.id
    # A run over a bare position, exactly as `POST /analysis/position` writes one.
    assert run.game_id is None
    assert run.fen == chess.Board().epd()
    assert run.engine_id == engine.id
    assert run.maia is False


def test_a_task_carries_the_deployments_budget_and_line_count(session: Session) -> None:
    add_engine(session)
    app_settings_service.set_value(
        session, app_settings_service.CORRESPONDENCE_TASK_NODES, 7_000_000
    )
    app_settings_service.set_value(session, app_settings_service.CORRESPONDENCE_TASK_MULTIPV, 4)
    game = make_game(session)

    search = correspondence_service.queue_task(session, node_id=game["tree"]["id"])

    run = session.get(AnalysisRun, search["run_id"])
    assert run is not None
    assert (run.nodes, run.multipv) == (7_000_000, 4)
    assert search["limit_nodes"] == 7_000_000


def test_a_task_sits_between_the_quick_and_the_deep_tier(session: Session) -> None:
    """Ahead of the import backlog, behind the pass somebody is sitting and waiting for."""
    add_engine(session)
    game = make_game(session, reply_due=datetime.now(UTC) + timedelta(days=3))

    search = correspondence_service.queue_task(session, node_id=game["tree"]["id"])

    run = session.get(AnalysisRun, search["run_id"])
    assert run is not None
    assert analysis_service.QUICK_PRIORITY < run.priority < analysis_service.DEEP_PRIORITY


def test_the_nearest_deadline_is_claimed_first(session: Session) -> None:
    """The due date is the priority, so one queue serves games due on different days.

    Queued in the wrong order on purpose: FIFO alone would work the far game first, and a
    correspondence player's whole problem is that one of these is due tomorrow.
    """
    add_engine(session)
    far = make_game(session, iccf_id="1", reply_due=datetime.now(UTC) + timedelta(days=6))
    near = make_game(session, iccf_id="2", reply_due=datetime.now(UTC) + timedelta(hours=6))

    correspondence_service.queue_task(session, node_id=far["tree"]["id"])
    correspondence_service.queue_task(session, node_id=near["tree"]["id"])

    first = analysis_service.claim_next_run(session)
    second = analysis_service.claim_next_run(session)
    assert first is not None and second is not None
    assert first.priority > second.priority
    assert first.fen == chess.Board().epd()  # both are the starting position
    near_search = session.get(CorrespondenceSearch, first.correspondence_search_id or 0)
    assert near_search is not None
    assert session.get(CorrespondenceNode, near_search.node_id).game_id == near["game"]["game_id"]


def test_a_game_with_no_deadline_goes_to_the_bottom_of_the_task_band(session: Session) -> None:
    add_engine(session)
    undated = make_game(session, iccf_id="1")
    due = make_game(session, iccf_id="2", reply_due=datetime.now(UTC) + timedelta(days=2))

    loose = correspondence_service.queue_task(session, node_id=undated["tree"]["id"])
    soon = correspondence_service.queue_task(session, node_id=due["tree"]["id"])

    assert session.get(AnalysisRun, loose["run_id"]).priority == (
        correspondence_service.TASK_PRIORITY_LOW
    )
    assert session.get(AnalysisRun, soon["run_id"]).priority > (
        correspondence_service.TASK_PRIORITY_LOW
    )


def test_one_engine_is_on_one_node_at_a_time(session: Session) -> None:
    add_engine(session)
    game = make_game(session)
    correspondence_service.queue_task(session, node_id=game["tree"]["id"])

    with pytest.raises(correspondence_service.SearchBusyError):
        correspondence_service.queue_task(session, node_id=game["tree"]["id"])


def test_an_excluded_move_never_gets_a_task(session: Session) -> None:
    add_engine(session)
    game = make_game(session)
    added = correspondence_service.add_node(session, parent_id=game["tree"]["id"], ucis="e2e4")
    correspondence_service.update_node(session, added["tip"]["id"], mark="excluded")

    with pytest.raises(correspondence_service.CorrespondenceError):
        correspondence_service.queue_task(session, node_id=added["tip"]["id"])


def test_the_task_engine_setting_wins_over_the_deep_role(session: Session) -> None:
    add_engine(session, name="Stockfish")
    other = add_engine(session, name="Leela")
    app_settings_service.set_correspondence_task_engine_id(session, other.id)
    game = make_game(session)

    search = correspondence_service.queue_task(session, node_id=game["tree"]["id"])

    assert search["engine_id"] == other.id
    assert session.get(AnalysisRun, search["run_id"]).engine_id == other.id


# --- absorbing the answer --------------------------------------------------


def test_a_finished_task_becomes_a_verdict_and_the_search_is_done(session: Session) -> None:
    engine = add_engine(session)
    game = make_game(session)
    search = correspondence_service.queue_task(session, node_id=game["tree"]["id"])

    answer(session, search, cp=25, depth=41, nodes=42_000_000)

    stored = session.scalars(select(CorrespondenceEval)).one()
    assert (stored.epd, stored.engine_id) == (chess.Board().epd(), engine.id)
    assert (stored.cp, stored.depth, stored.nodes) == (25, 41, 42_000_000)
    assert stored.best_lines == LINES
    assert stored.engine_version == "17"
    # And one point of trajectory, so the sparkline has something to draw from.
    assert [entry["depth"] for entry in stored.history] == [41]
    row = session.get(CorrespondenceSearch, search["id"])
    assert row is not None and row.status is SearchStatus.DONE
    assert row.finished_at is not None


def test_a_shallower_task_never_overwrites_a_deeper_verdict(session: Session) -> None:
    """The rule that makes a three-day search worth anything, from the other queue's side."""
    engine = add_engine(session)
    game = make_game(session)
    settled = store_eval(session, chess.Board().epd(), engine, cp=30, depth=52)
    search = correspondence_service.queue_task(session, node_id=game["tree"]["id"])

    answer(session, search, cp=-400, depth=30)

    session.refresh(settled)
    assert (settled.cp, settled.depth) == (30, 52)
    # Forward only means the numbers, not the clock: the seconds were really spent.
    assert session.get(CorrespondenceSearch, search["id"]).status is SearchStatus.DONE


def test_a_deeper_task_moves_the_verdict_forward(session: Session) -> None:
    engine = add_engine(session)
    game = make_game(session)
    settled = store_eval(session, chess.Board().epd(), engine, cp=30, depth=20)
    search = correspondence_service.queue_task(session, node_id=game["tree"]["id"])

    answer(session, search, cp=-12, depth=44)

    session.refresh(settled)
    assert (settled.cp, settled.depth) == (-12, 44)


def test_a_verdict_on_a_black_to_move_position_is_stored_in_the_movers_frame(
    session: Session,
) -> None:
    """A run's lines are White's and the eval table's are the mover's — one negation, and
    invisible until a player trusts a number that says the opposite of what it means."""
    add_engine(session)
    game = make_game(session)
    added = correspondence_service.add_node(session, parent_id=game["tree"]["id"], ucis="e2e4")
    search = correspondence_service.queue_task(session, node_id=added["tip"]["id"])

    # White is a third of a pawn better, which for Black to move is -34 in the mover's frame.
    answer(
        session,
        search,
        cp=-34,
        depth=30,
        lines=[{"multipv": 1, "cp": 34, "mate": None, "pv": ["e7e5"]}],
        best="e7e5",
    )

    stored = session.scalars(select(CorrespondenceEval)).one()
    assert stored.cp == -34
    assert stored.best_lines == [{"multipv": 1, "cp": -34, "mate": None, "pv": ["e7e5"]}]


def test_a_task_over_a_position_the_engine_could_not_judge_writes_nothing(
    session: Session,
) -> None:
    add_engine(session)
    game = make_game(session)
    search = correspondence_service.queue_task(session, node_id=game["tree"]["id"])

    answer(session, search, cp=None, mate=None, lines=[], best=None)

    assert session.scalars(select(CorrespondenceEval)).all() == []
    assert session.get(CorrespondenceSearch, search["id"]).status is SearchStatus.DONE


def test_a_run_whose_node_went_away_absorbs_nothing(session: Session) -> None:
    add_engine(session)
    game = make_game(session)
    added = correspondence_service.add_node(session, parent_id=game["tree"]["id"], ucis="e2e4")
    search = correspondence_service.queue_task(session, node_id=added["tip"]["id"])
    run = session.get(AnalysisRun, search["run_id"])
    assert run is not None
    session.delete(session.get(CorrespondenceNode, added["tip"]["id"]))
    session.commit()

    run.status = RunStatus.RUNNING
    session.commit()
    analysis_service.complete_run(
        session, run, [MoveEval(ply=0, eval_before_cp=10, depth=30, best_lines=LINES)]
    )

    assert session.scalars(select(CorrespondenceEval)).all() == []
    assert session.get(AnalysisRun, run.id).status is RunStatus.DONE


def test_a_failed_run_fails_the_task_once_its_retry_is_spent(session: Session) -> None:
    add_engine(session)
    game = make_game(session)
    search = correspondence_service.queue_task(session, node_id=game["tree"]["id"])
    run = session.get(AnalysisRun, search["run_id"])
    assert run is not None

    run.status, run.attempts = RunStatus.RUNNING, 1
    session.commit()
    analysis_service.fail_run(session, run, "the engine died")
    assert session.get(CorrespondenceSearch, search["id"]).status is SearchStatus.QUEUED

    run.status, run.attempts = RunStatus.RUNNING, 2
    session.commit()
    analysis_service.fail_run(session, run, "the engine died again")

    row = session.get(CorrespondenceSearch, search["id"])
    assert row is not None and row.status is SearchStatus.FAILED
    assert row.error == "the engine died again"


def test_a_claimed_task_says_it_is_running(session: Session) -> None:
    add_engine(session)
    game = make_game(session)
    search = correspondence_service.queue_task(session, node_id=game["tree"]["id"])

    analysis_service.claim_next_run(session)

    assert session.get(CorrespondenceSearch, search["id"]).status is SearchStatus.RUNNING


def test_a_task_a_dead_worker_left_running_goes_back_to_queued(session: Session) -> None:
    """The stale sweep moves the search row with the run, as every other transition does."""
    add_engine(session)
    game = make_game(session)
    search = correspondence_service.queue_task(session, node_id=game["tree"]["id"])
    run = analysis_service.claim_next_run(session)
    assert run is not None
    went_quiet(session, run)

    analysis_service.requeue_stale_runs(session)

    assert session.get(AnalysisRun, run.id).status is RunStatus.QUEUED
    assert session.get(CorrespondenceSearch, search["id"]).status is SearchStatus.QUEUED


def test_a_task_whose_retry_the_sweep_spends_fails_rather_than_wedging_the_node(
    session: Session,
) -> None:
    """A search row left `running` under a failed run is a node with no way out.

    `running` refuses cancel, refuses stop, refuses a second task on the node and refuses
    deleting the branch — so a crash whose retry was already spent would strand it for good,
    and the capacity strip would count a task that no longer exists for ever.
    """
    add_engine(session)
    game = make_game(session)
    search = correspondence_service.queue_task(session, node_id=game["tree"]["id"])

    for _ in range(analysis_service.MAX_ATTEMPTS):
        run = analysis_service.claim_next_run(session)
        assert run is not None
        went_quiet(session, run)
        analysis_service.requeue_stale_runs(session)

    assert session.get(AnalysisRun, run.id).status is RunStatus.FAILED
    row = session.get(CorrespondenceSearch, search["id"])
    assert row is not None and row.status is SearchStatus.FAILED
    assert row.error == analysis_service.STALE_RUN_MESSAGE
    # And the node is free again: a second task on it is not a "busy" refusal.
    again = correspondence_service.queue_task(session, node_id=game["tree"]["id"])
    assert again["status"] == "queued"


def test_a_task_over_a_mated_position_writes_no_verdict(session: Session) -> None:
    """A terminal position is not something an engine judged, so nothing is stored.

    `terminal_score` writes a `mate = 0` whose sign lives in `cp` — the pair the eval
    table's `{cp, mate}` cannot carry — and a checkmate stored as a mate of unknown side
    would be minimaxed as a *loss*, which is how the parent would come to prefer a quiet
    move over a forced mate.
    """
    add_engine(session)
    game = make_game(session, start_fen=MATE_IN_ONE)
    mate = correspondence_service.add_node(session, parent_id=game["tree"]["id"], ucis="a1a8")
    search = correspondence_service.queue_task(session, node_id=mate["tip"]["id"])

    # Exactly what a run over a mated position produces: the mover's folded score, no line.
    answer(session, search, cp=-10_000, mate=0, depth=0, lines=[], best=None)

    assert session.scalars(select(CorrespondenceEval)).all() == []
    assert session.get(CorrespondenceSearch, search["id"]).status is SearchStatus.DONE
    tree = correspondence_service.get_game(session, game["game"]["game_id"])["tree"]
    assert node_in(tree, "Ra8#")["own"] is None


def test_a_delivered_mate_in_the_table_is_backed_up_as_the_win_it_is(session: Session) -> None:
    """A `mate = 0` verdict, however it got there, is read by the sign of its `cp`."""
    engine = add_engine(session)
    game = make_game(session, start_fen=MATE_IN_ONE)
    mate = correspondence_service.add_node(session, parent_id=game["tree"]["id"], ucis="a1a8")
    quiet = correspondence_service.add_node(session, parent_id=game["tree"]["id"], ucis="a1b1")
    # Both stored in the side-to-move's frame, which after White's move is Black's: Black is
    # mated in the first, and half a pawn down in the second.
    store_eval(session, mate["tip"]["epd"], engine, cp=-10_000, mate=0, lines=[])
    store_eval(session, quiet["tip"]["epd"], engine, cp=-50)

    tree = correspondence_service.get_game(session, game["game"]["game_id"])["tree"]

    # The root reads in White's frame, and the mate beats the half pawn rather than being
    # ordered below every losing move there is.
    assert tree["backed"] == {"cp": 10_000, "mate": 0}


# --- expansion -------------------------------------------------------------


def test_expanding_makes_children_from_the_best_lines_and_a_task_on_each(
    session: Session,
) -> None:
    engine = add_engine(session)
    game = make_game(session)
    root = game["tree"]["id"]
    store_eval(session, chess.Board().epd(), engine)

    result = correspondence_service.expand_node(session, root, width=2, stages=1)

    assert child_sans(session, root) == ["e4", "d4"]
    assert (result["created"], result["queued"]) == (2, 2)
    for san in ("e4", "d4"):
        child = child_named(session, root, san)
        queued = tasks_on(session, child.id)
        assert len(queued) == 1
        assert queued[0].expand_stages == 0
        assert session.get(AnalysisRun, queued[0].run_id).engine_id == engine.id


def test_expanding_again_widens_rather_than_duplicating(session: Session) -> None:
    engine = add_engine(session)
    game = make_game(session)
    root = game["tree"]["id"]
    store_eval(session, chess.Board().epd(), engine)
    correspondence_service.expand_node(session, root, width=1, stages=1)

    result = correspondence_service.expand_node(session, root, width=3, stages=1)

    assert child_sans(session, root) == ["e4", "d4", "Nf3"]
    # The move that was already there kept the task it already had rather than gaining a
    # second one: one engine on one node is the rule, whichever call asked for it.
    assert result["created"] == 2
    assert len(tasks_on(session, child_named(session, root, "e4").id)) == 1


def test_expanding_without_tasks_only_puts_the_moves_in_the_tree(session: Session) -> None:
    engine = add_engine(session)
    game = make_game(session)
    root = game["tree"]["id"]
    store_eval(session, chess.Board().epd(), engine)

    result = correspondence_service.expand_node(session, root, width=2, tasks=False)

    assert result["queued"] == 0
    assert session.scalars(select(CorrespondenceSearch)).all() == []
    assert child_sans(session, root) == ["e4", "d4"]


def test_expanding_a_position_nobody_has_looked_at_queues_the_expansion_itself(
    session: Session,
) -> None:
    """No lines to expand from yet, so the task carries the whole thing and unwinds later."""
    add_engine(session)
    game = make_game(session)
    root = game["tree"]["id"]

    result = correspondence_service.expand_node(session, root, width=2, stages=2)

    assert (result["created"], result["queued"]) == (0, 1)
    carried = tasks_on(session, root)[0]
    assert (carried.expand_width, carried.expand_stages) == (2, 2)


def test_absorbing_an_expansions_task_makes_the_next_stage(session: Session) -> None:
    add_engine(session)
    game = make_game(session)
    root = game["tree"]["id"]
    correspondence_service.expand_node(session, root, width=2, stages=2)
    carried = tasks_on(session, root)[0]

    answer(session, {"run_id": carried.run_id}, cp=20, depth=35)

    assert child_sans(session, root) == ["e4", "d4"]
    for san in ("e4", "d4"):
        child = child_named(session, root, san)
        # One of the two stages was spent making these, so their own tasks owe the other —
        # which is what makes `stages=2` the same depth of tree whether the node had a
        # verdict when it was asked for or had to be looked at first.
        assert [row.expand_stages for row in tasks_on(session, child.id)] == [1]


def test_the_last_stage_creates_nothing(session: Session) -> None:
    add_engine(session)
    game = make_game(session)
    root = game["tree"]["id"]
    correspondence_service.expand_node(session, root, width=2, stages=1)
    carried = tasks_on(session, root)[0]

    answer(session, {"run_id": carried.run_id}, cp=20, depth=35)
    leaf = tasks_on(session, child_named(session, root, "e4").id)[0]
    answer(session, {"run_id": leaf.run_id}, cp=20, depth=35)

    assert child_sans(session, child_named(session, root, "e4").id) == []


# --- the marks steering it -------------------------------------------------


def test_an_excluded_child_is_skipped_by_an_expansion(session: Session) -> None:
    engine = add_engine(session)
    game = make_game(session)
    root = game["tree"]["id"]
    store_eval(session, chess.Board().epd(), engine)
    added = correspondence_service.add_node(session, parent_id=root, ucis="e2e4")
    correspondence_service.update_node(session, added["tip"]["id"], mark="excluded")

    result = correspondence_service.expand_node(session, root, width=2, stages=1)

    assert result["queued"] == 1
    assert tasks_on(session, added["tip"]["id"]) == []
    assert len(tasks_on(session, child_named(session, root, "d4").id)) == 1


def test_a_bad_child_is_expanded_one_stage_at_most(session: Session) -> None:
    engine = add_engine(session)
    game = make_game(session)
    root = game["tree"]["id"]
    store_eval(session, chess.Board().epd(), engine)
    added = correspondence_service.add_node(session, parent_id=root, ucis="e2e4")
    correspondence_service.update_node(session, added["tip"]["id"], mark="bad")

    correspondence_service.expand_node(session, root, width=2, stages=3)

    bad = tasks_on(session, added["tip"]["id"])[0]
    plain = tasks_on(session, child_named(session, root, "d4").id)[0]
    assert bad.expand_stages == correspondence_service.BAD_MARK_STAGES
    assert plain.expand_stages == 2


def test_a_good_child_gets_an_extra_stage_and_an_extra_sibling(session: Session) -> None:
    engine = add_engine(session)
    game = make_game(session)
    root = game["tree"]["id"]
    store_eval(session, chess.Board().epd(), engine)
    added = correspondence_service.add_node(session, parent_id=root, ucis="e2e4")
    correspondence_service.update_node(session, added["tip"]["id"], mark="good")

    correspondence_service.expand_node(session, root, width=2, stages=1)

    good = tasks_on(session, added["tip"]["id"])[0]
    plain = tasks_on(session, child_named(session, root, "d4").id)[0]
    assert (good.expand_stages, good.expand_width) == (1, 3)
    assert (plain.expand_stages, plain.expand_width) == (0, 2)


def test_an_interesting_child_is_steered_like_a_good_one(session: Session) -> None:
    engine = add_engine(session)
    game = make_game(session)
    root = game["tree"]["id"]
    store_eval(session, chess.Board().epd(), engine)
    added = correspondence_service.add_node(session, parent_id=root, ucis="e2e4")
    correspondence_service.update_node(session, added["tip"]["id"], mark="interesting")

    correspondence_service.expand_node(session, root, width=2, stages=1)

    assert tasks_on(session, added["tip"]["id"])[0].expand_stages == 1


# --- stale verdicts and refreshing -----------------------------------------


def test_a_verdict_below_the_stale_depth_is_stale(session: Session) -> None:
    engine = add_engine(session)
    shallow = store_eval(session, chess.Board().epd(), engine, depth=12)
    deep = CorrespondenceEval(
        epd="x", engine_id=engine.id, engine_name=engine.name, engine_version="17", depth=40
    )

    assert correspondence_service.is_stale(shallow, version="17", stale_depth=30) is True
    assert correspondence_service.is_stale(deep, version="17", stale_depth=30) is False


def test_a_verdict_from_an_older_build_is_stale_however_deep_it_went(session: Session) -> None:
    engine = add_engine(session, version="17.1")
    old = store_eval(session, chess.Board().epd(), engine, depth=60, version="16")

    assert correspondence_service.is_stale(old, version="17.1", stale_depth=30) is True
    # And an engine that is gone from the table has no version to disagree with.
    assert correspondence_service.is_stale(old, version=None, stale_depth=30) is False


def test_the_tree_says_which_verdicts_are_stale_and_what_is_queued(session: Session) -> None:
    engine = add_engine(session, version="17.1")
    game = make_game(session)
    added = correspondence_service.add_node(session, parent_id=game["tree"]["id"], ucis="e2e4")
    node = session.get(CorrespondenceNode, added["tip"]["id"])
    assert node is not None
    store_eval(session, node.epd, engine, depth=60, version="16")
    correspondence_service.queue_task(session, node_id=node.id)

    payload = correspondence_service.get_game(session, game["game"]["game_id"])

    drawn = node_in(payload["tree"], "e4")
    assert drawn["stale"] is True
    assert drawn["evals"][0]["stale"] is True
    assert drawn["task"]["status"] == "queued"
    assert drawn["task"]["engine_name"] == "Stockfish"


def test_refreshing_a_subtree_queues_a_task_on_every_stale_node(session: Session) -> None:
    engine = add_engine(session)
    game = make_game(session)
    root = game["tree"]["id"]
    first = correspondence_service.add_node(session, parent_id=root, ucis="e2e4")
    second = correspondence_service.add_node(session, parent_id=first["tip"]["id"], ucis="e7e5")
    current = session.get(CorrespondenceNode, first["tip"]["id"])
    assert current is not None
    # One node is current and the other two have never been looked at.
    store_eval(session, current.epd, engine, depth=55)

    result = correspondence_service.refresh_subtree(session, root)

    assert result["stale"] == 2
    assert result["queued"] == 2
    assert tasks_on(session, current.id) == []
    assert len(tasks_on(session, second["tip"]["id"])) == 1
    assert len(tasks_on(session, root)) == 1


def test_a_refresh_skips_what_is_already_being_worked_on(session: Session) -> None:
    add_engine(session)
    game = make_game(session)
    root = game["tree"]["id"]
    correspondence_service.queue_task(session, node_id=root)

    result = correspondence_service.refresh_subtree(session, root)

    assert result["queued"] == 0
    assert len(tasks_on(session, root)) == 1


def test_a_refresh_bigger_than_the_bound_is_refused_with_the_number(session: Session) -> None:
    add_engine(session)
    game = make_game(session)
    root = game["tree"]["id"]
    parent = root
    board = chess.Board()
    for uci in ("e2e4", "e7e5", "g1f3", "b8c6"):
        added = correspondence_service.add_node(session, parent_id=parent, ucis=uci)
        parent = added["tip"]["id"]
        board.push(board.parse_uci(uci))

    with pytest.raises(correspondence_service.TooMuchToRefreshError) as raised:
        correspondence_service.refresh_subtree(session, root, limit=3)

    assert "5" in str(raised.value)
    assert session.scalars(select(CorrespondenceSearch)).all() == []


def test_a_refresh_leaves_excluded_branches_alone(session: Session) -> None:
    add_engine(session)
    game = make_game(session)
    root = game["tree"]["id"]
    added = correspondence_service.add_node(session, parent_id=root, ucis="e2e4")
    deeper = correspondence_service.add_node(session, parent_id=added["tip"]["id"], ucis="e7e5")
    correspondence_service.update_node(session, added["tip"]["id"], mark="excluded")

    result = correspondence_service.refresh_subtree(session, root)

    assert result["queued"] == 1
    assert tasks_on(session, added["tip"]["id"]) == []
    assert tasks_on(session, deeper["tip"]["id"]) == []


# --- cancelling, and the rows nobody may orphan ----------------------------


def test_cancelling_a_queued_task_takes_its_run_out_of_the_queue(session: Session) -> None:
    add_engine(session)
    game = make_game(session)
    search = correspondence_service.queue_task(session, node_id=game["tree"]["id"])
    run_id = search["run_id"]

    cancelled = correspondence_service.cancel_task(session, search["id"])

    assert cancelled["status"] == "stopped"
    assert session.get(AnalysisRun, run_id) is None
    row = session.get(CorrespondenceSearch, search["id"])
    assert row is not None and row.run_id is None
    # And the node is free for another look.
    correspondence_service.queue_task(session, node_id=game["tree"]["id"])


def test_stopping_a_task_is_cancelling_it(session: Session) -> None:
    """**Stop** on a task's row must take its run with it, or the engine spends the budget
    on a position with nowhere to put the answer."""
    add_engine(session)
    game = make_game(session)
    search = correspondence_service.queue_task(session, node_id=game["tree"]["id"])

    stopped = correspondence_service.stop_search(session, search["id"])

    assert stopped["status"] == "stopped"
    assert session.get(AnalysisRun, search["run_id"]) is None


def test_a_cancelled_tasks_late_answer_is_kept_but_expands_nothing(session: Session) -> None:
    add_engine(session)
    game = make_game(session)
    root = game["tree"]["id"]
    correspondence_service.expand_node(session, root, width=2, stages=1)
    carried = tasks_on(session, root)[0]
    run_id = carried.run_id
    # The task was called off while a worker already had it, and it answers anyway.
    correspondence_service.release_tasks(session, [carried.id])

    answer(session, {"run_id": run_id}, cp=20, depth=35)

    assert session.scalars(select(CorrespondenceEval)).one().cp == 20
    assert child_sans(session, root) == []
    assert session.get(CorrespondenceSearch, carried.id).status is SearchStatus.STOPPED


def test_a_task_cannot_be_paused_or_resumed(session: Session) -> None:
    """Pause and resume are the infinite mode's; a task's place is the analysis queue's.

    A row moved to `paused` under a run a worker then claims would have the tree drawing a
    parked node while an engine works it, and `paused` is not a state a task's payload can
    even carry.
    """
    add_engine(session)
    game = make_game(session)
    search = correspondence_service.queue_task(session, node_id=game["tree"]["id"])

    for verb in (correspondence_service.pause_search, correspondence_service.resume_search):
        with pytest.raises(correspondence_service.CorrespondenceError):
            verb(session, search["id"])

    assert session.get(CorrespondenceSearch, search["id"]).status is SearchStatus.QUEUED


def test_cancelling_a_task_a_worker_has_claimed_is_refused(session: Session) -> None:
    add_engine(session)
    game = make_game(session)
    search = correspondence_service.queue_task(session, node_id=game["tree"]["id"])
    analysis_service.claim_next_run(session)

    with pytest.raises(correspondence_service.TaskRunningError):
        correspondence_service.cancel_task(session, search["id"])

    assert session.get(AnalysisRun, search["run_id"]) is not None


def test_clearing_the_queue_leaves_no_task_claiming_to_be_queued(session: Session) -> None:
    """The other direction: the Analysis page's stop button knows nothing about trees."""
    add_engine(session)
    game = make_game(session)
    search = correspondence_service.queue_task(session, node_id=game["tree"]["id"])

    dropped = analysis_service.clear_queue(session)

    assert dropped == 1
    assert session.get(AnalysisRun, search["run_id"]) is None
    row = session.get(CorrespondenceSearch, search["id"])
    assert row is not None
    assert row.status is SearchStatus.STOPPED
    assert row.run_id is None
    assert row.error


def test_deleting_the_engine_leaves_no_task_claiming_to_be_queued(session: Session) -> None:
    """The Engines page drops the runs queued on a deleted engine, tasks included."""
    engine = add_engine(session)
    game = make_game(session)
    search = correspondence_service.queue_task(session, node_id=game["tree"]["id"])

    _, unqueued = engines_service.delete_engine(session, engine.id)

    assert unqueued == 1
    assert session.get(AnalysisRun, search["run_id"]) is None
    row = session.get(CorrespondenceSearch, search["id"])
    assert row is not None
    assert row.status is SearchStatus.STOPPED
    assert row.run_id is None
    assert row.error


def test_deleting_a_runners_engine_leaves_its_queued_task_alone(session: Session) -> None:
    """`unqueue=False` is the runner's own advertisement going away, not a dropped run."""
    engine = add_engine(session)
    game = make_game(session)
    search = correspondence_service.queue_task(session, node_id=game["tree"]["id"])

    engines_service.delete_engine(session, engine.id, unqueue=False)

    assert session.get(AnalysisRun, search["run_id"]) is not None
    assert session.get(CorrespondenceSearch, search["id"]).status is SearchStatus.QUEUED


def test_deleting_the_task_engine_unchooses_it_rather_than_leaving_a_dead_id(
    session: Session,
) -> None:
    """A setting pointing at a row that is gone would refuse every task, expansion and
    refresh with "no engine with id 2" until the owner thought to look at the settings."""
    deep = add_engine(session, name="Stockfish")
    chosen = add_engine(session, name="Leela")
    app_settings_service.set_correspondence_task_engine_id(session, chosen.id)

    engines_service.delete_engine(session, chosen.id)

    assert app_settings_service.get_correspondence_task_engine_id(session) is None
    assert correspondence_service.task_engine(session).id == deep.id


def test_deleting_a_correspondence_game_takes_its_queued_tasks_runs(session: Session) -> None:
    """A task's run carries a FEN and no `game_id`, so the library's delete cannot find it
    by the game — and left behind it would still be claimed and still spend its budget."""
    add_engine(session)
    game = make_game(session)
    search = correspondence_service.queue_task(session, node_id=game["tree"]["id"])

    games_service.delete_games(session, [game["game"]["game_id"]])

    assert session.get(AnalysisRun, search["run_id"]) is None
    assert session.get(CorrespondenceSearch, search["id"]) is None


def test_wiping_the_library_takes_the_queued_tasks_runs_too(session: Session) -> None:
    """Every search row belongs to a game, and the wipe takes every game."""
    add_engine(session)
    game = make_game(session)
    search = correspondence_service.queue_task(session, node_id=game["tree"]["id"])

    games_service.delete_all_games(session)

    assert session.get(AnalysisRun, search["run_id"]) is None
    assert session.scalars(select(CorrespondenceSearch)).all() == []


def test_cancelling_a_backfill_leaves_correspondence_tasks_alone(session: Session) -> None:
    add_engine(session)
    game = make_game(session)
    search = correspondence_service.queue_task(session, node_id=game["tree"]["id"])

    analysis_service.cancel_queued(session, Tier.DEEP)

    assert session.get(AnalysisRun, search["run_id"]) is not None
    assert session.get(CorrespondenceSearch, search["id"]).status is SearchStatus.QUEUED


def test_deleting_a_branch_cancels_the_tasks_queued_inside_it(session: Session) -> None:
    engine = add_engine(session)
    game = make_game(session)
    root = game["tree"]["id"]
    store_eval(session, chess.Board().epd(), engine)
    correspondence_service.expand_node(session, root, width=2, stages=1)
    branch = child_named(session, root, "e4")
    run_ids = [row.run_id for row in tasks_on(session, branch.id)]

    correspondence_service.delete_node(session, branch.id)

    assert session.get(CorrespondenceNode, branch.id) is None
    assert [session.get(AnalysisRun, run_id) for run_id in run_ids] == [None]
    # And the sibling's task is untouched.
    assert len(tasks_on(session, child_named(session, root, "d4").id)) == 1


def test_a_branch_with_a_running_search_is_still_refused(session: Session) -> None:
    engine = add_engine(session)
    game = make_game(session)
    added = correspondence_service.add_node(session, parent_id=game["tree"]["id"], ucis="e2e4")
    session.add(
        CorrespondenceSearch(
            node_id=added["tip"]["id"],
            engine_id=engine.id,
            kind=SearchKind.SEARCH,
            status=SearchStatus.RUNNING,
        )
    )
    session.commit()

    with pytest.raises(correspondence_service.NodeBusyError):
        correspondence_service.delete_node(session, added["tip"]["id"])


# --- the API ---------------------------------------------------------------


@pytest.fixture()
def api(settings: Settings) -> Any:
    with running_app(create_app(settings=settings)) as client:
        yield client


def seed(client: TestClient) -> dict[str, Any]:
    """One engine and one correspondence game, through the app's own session."""
    from backend.db.session import get_sessionmaker

    sessions = get_sessionmaker(client.app.state.settings)  # type: ignore[attr-defined]
    with sessions() as session:
        add_engine(session)
        return make_game(session)


def test_the_routes_expand_refresh_and_cancel(api: TestClient) -> None:
    game = seed(api)
    root = game["tree"]["id"]

    expanded = api.post(f"/api/correspondence/nodes/{root}/expand", json={"stages": 1})
    assert expanded.status_code == 201, expanded.text
    assert expanded.json()["queued"] == 1

    search_id = expanded.json()["searches"][0]["id"]
    cancelled = api.post(f"/api/correspondence/searches/{search_id}/cancel")
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "stopped"

    refreshed = api.post(f"/api/correspondence/nodes/{root}/refresh", json={})
    assert refreshed.status_code == 201, refreshed.text
    assert refreshed.json()["queued"] == 1


def test_a_task_can_be_asked_for_through_the_searches_route(api: TestClient) -> None:
    game = seed(api)
    created = api.post(
        "/api/correspondence/searches",
        json={"node_id": game["tree"]["id"], "kind": "task"},
    )

    assert created.status_code == 201, created.text
    assert created.json()["kind"] == "task"
    assert created.json()["run_id"]

    status = api.get("/api/correspondence/status").json()
    assert status["tasks"] == {"queued": 1, "running": 0}


# --- the whole path, against a real subprocess -----------------------------


@pytest.fixture()
def db(tmp_path: Path) -> Any:
    """A file database of its own, so the worker threads never share a connection."""
    engine = create_db_engine(f"sqlite+pysqlite:///{tmp_path / 'blunderbase.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    yield factory
    engine.dispose()


@pytest.fixture()
def worker_settings(tmp_path: Path) -> Settings:
    return Settings(root=tmp_path, analysis_concurrency=1, analysis_poll_seconds=0.01)


async def test_a_task_is_worked_by_the_ordinary_analysis_workers(
    db: sessionmaker[Session], worker_settings: Settings, tmp_path: Path
) -> None:
    """The whole seam once, for real: a queued task, a subprocess, and a verdict in the tree.

    Nothing here knows it is correspondence work. The task goes into the queue the import
    backlog uses, a worker claims it, `fake_uci` answers, `complete_run` writes the
    `MoveEval` — and the tree ends up with the number, the depth, the lines and two new
    children, which is what makes "tasks run on runners for free" true.
    """
    reply = {
        "info": [
            "depth 33 multipv 1 score cp 26 nodes 4000000 pv e2e4 e7e5",
            "depth 33 multipv 2 score cp 14 nodes 4000000 pv d2d4 d7d5",
        ],
        "bestmove": "e2e4",
    }
    # The first `go` is the root's task; the two children's tasks get an answer that is
    # legal in any position, because a scripted `pv` is only legal in the position it was
    # written for and this run really does walk three of them.
    neutral = {"info": ["depth 20 score cp 8 nodes 900"], "bestmove": "(none)"}
    engine = Engine(
        name="FakeFish",
        kind=EngineKind.UCI,
        path=fake_engine_command(
            tmp_path,
            options=STOCKFISH_OPTIONS,
            name="FakeFish",
            go=[reply],
            go_default=neutral,
        ),
        enabled=True,
        version="17",
    )
    with db() as session:
        session.add(engine)
        session.commit()
        engines_service.assign_default_roles(session, engine)
        game = make_game(session)
        root = game["tree"]["id"]
        correspondence_service.expand_node(session, root, width=2, stages=1)

    workers = AnalysisWorkers(settings=worker_settings, sessions=db)
    await workers.start()
    try:
        assert await workers.wait_idle(30.0), "the queue never emptied"
    finally:
        await workers.stop()

    with db() as session:
        stored = session.scalars(
            select(CorrespondenceEval).where(CorrespondenceEval.epd == chess.Board().epd())
        ).one()
        assert (stored.cp, stored.depth, stored.nodes) == (26, 33, 4_000_000)
        assert stored.engine_name == "FakeFish"
        assert [line["pv"][0] for line in stored.best_lines or []] == ["e2e4", "d2d4"]
        carried = session.scalars(
            select(CorrespondenceSearch).where(CorrespondenceSearch.node_id == root)
        ).one()
        assert carried.status is SearchStatus.DONE
        assert child_sans(session, root) == ["e4", "d4"]

"""Correspondence play: the one game the library lets somebody change, and its tree.

Two things make this mode different from everything else here, and both are what these
tests are about. A correspondence `Game` is *mutated* after import, which every other part
of the app is allowed to assume never happens — so the tests watch the move list, the PGN,
the stored positions, the identity hash and the card move together. And the tree carries
numbers nobody stores: the chosen verdict per node and the minimax over its children, in
the frame of the side that made the move, which is where an off-by-one-negation would be
invisible until a player trusted it.
"""

from __future__ import annotations

import io
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import chess
import chess.pgn
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from backend.api.app import create_app
from backend.config import Settings
from backend.db.enums import Color, EngineKind, Result, SearchKind, SearchStatus, Source, Speed
from backend.db.migrate import upgrade_to_head
from backend.db.models import (
    AnalysisRun,
    CorrespondenceEval,
    CorrespondenceGame,
    CorrespondenceNode,
    CorrespondenceSearch,
    Engine,
    Game,
    GamePosition,
)
from backend.db.session import get_engine
from backend.services import app_settings as app_settings_service
from backend.services import correspondence as correspondence_service
from backend.services import engines as engines_service
from backend.services import events as events_service
from backend.services import games as games_service
from tests.conftest import running_app

ICCF_PGN = """[Event "WS/O/123"]
[Site "https://www.iccf.com/game?id=1234567"]
[Date "2026.01.04"]
[White "Baum, Philipp"]
[Black "Gegner, Ein"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 *
"""

# A rook and a back rank: White to move mates in one with Ra8. Used wherever a test needs a
# position that is not the initial array, or a real checkmate.
BACK_RANK = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1"
# White to move, and taking the queen leaves two bare kings — a dead position.
BARE_KINGS = "7k/8/8/8/8/8/6q1/6K1 w - - 0 1"
# The ordinary array after 1.e4, handed over as a *starting* position: Black moves first
# here, and every parity in the mode has to be counted from that rather than from the ply.
BLACK_FIRST = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"


# --- helpers ---------------------------------------------------------------


def make_game(session: Session, **changes: Any) -> dict[str, Any]:
    """One correspondence game with the fields a test does not care about filled in."""
    fields: dict[str, Any] = {
        "white": "Baum, Philipp",
        "black": "Gegner, Ein",
        "owner_color": Color.WHITE,
        "event": "WS/O/123",
        "url": "https://www.iccf.com/game?id=1234567",
        "iccf_id": "1234567",
    }
    fields.update(changes)
    return correspondence_service.create_game(session, **fields)


def add_engine(session: Session, name: str = "Stockfish") -> Engine:
    engine = Engine(name=name, kind=EngineKind.UCI, path=f"/usr/bin/{name.lower()}")
    session.add(engine)
    session.commit()
    engines_service.assign_default_roles(session, engine)
    return engine


def add_eval(
    session: Session,
    epd: str,
    *,
    engine: Engine | None = None,
    cp: int | None = None,
    mate: int | None = None,
    depth: int = 30,
    name: str = "Stockfish",
) -> CorrespondenceEval:
    row = CorrespondenceEval(
        epd=epd,
        engine_id=engine.id if engine else None,
        engine_name=engine.name if engine else name,
        cp=cp,
        mate=mate,
        depth=depth,
        history=[],
    )
    session.add(row)
    session.commit()
    return row


def node_at(payload: dict[str, Any], *sans: str) -> dict[str, Any]:
    """Walk a tree payload by SAN, which is how the tests spell a path."""
    node = payload["tree"]
    for san in sans:
        node = next(child for child in node["children"] if child["san"] == san)
    return node


def epd_after(*ucis: str) -> str:
    board = chess.Board()
    for uci in ucis:
        board.push(board.parse_uci(uci))
    return board.epd()


# --- creating and importing ------------------------------------------------


def test_a_new_game_is_an_iccf_game_with_a_tree_of_one_node(session: Session) -> None:
    payload = make_game(session)
    game = session.get(Game, payload["game"]["game_id"])

    assert game is not None
    assert game.source is Source.ICCF
    assert game.source_id == "1234567"
    assert game.speed is Speed.CORRESPONDENCE
    assert game.result is Result.UNKNOWN
    assert game.owner_color is Color.WHITE
    assert game.ply_count == 0
    # The tree's root stands on the game's first position and is played, so the invariant
    # holds over a game with no moves at all.
    root = payload["tree"]
    assert root["parent_id"] is None and root["played"] and root["ply"] == 0
    assert root["fen"] == chess.STARTING_FEN
    assert payload["game"]["your_move"] is True
    assert payload["game"]["state"] == "ongoing"


def test_a_new_game_is_not_queued_for_analysis(session: Session) -> None:
    """The tree is its analysis while it runs; a pass would be redone after every move."""
    make_game(session)
    assert session.scalars(select(AnalysisRun)).all() == []


def test_a_game_with_no_iccf_number_is_a_manual_game(session: Session) -> None:
    payload = make_game(session, iccf_id=None, url=None)
    game = session.get(Game, payload["game"]["game_id"])
    assert game is not None
    assert game.source is Source.MANUAL
    assert game.source_id is None


def test_the_same_iccf_number_twice_is_a_conflict(session: Session) -> None:
    make_game(session)
    with pytest.raises(correspondence_service.GameAlreadyStoredError):
        make_game(session)


def test_a_game_needs_a_colour_of_its_own(session: Session) -> None:
    with pytest.raises(correspondence_service.CorrespondenceError):
        make_game(session, owner_color="green")


def test_a_game_can_start_from_a_position(session: Session) -> None:
    payload = make_game(session, start_fen=BACK_RANK, iccf_id=None)
    assert payload["tree"]["fen"] == BACK_RANK
    assert payload["game"]["start_fen"] == BACK_RANK
    # And the move played from it is legal against *that* board, not the initial array.
    played = correspondence_service.play_move(session, payload["game"]["game_id"], "a1a8")
    assert played["game"]["moves_san"] == ["Ra8#"]


def test_a_game_that_starts_with_black_to_move_is_counted_from_there(session: Session) -> None:
    """Everything derived from the ply count is counted from the game's *own* first position.

    Ply parity is only whose-move-it-is in a game that started from the ordinary array. A
    thematic position with Black to move — which the New game dialog takes, and a PGN with a
    `SetUp` header brings — would otherwise invert the turn, the deadline, the move numbers
    and the frame every score is read in, for the game's whole length.
    """
    payload = make_game(
        session,
        owner_color=Color.BLACK,
        iccf_id=None,
        start_fen=BLACK_FIRST,
    )
    game_id = payload["game"]["game_id"]
    assert payload["game"]["to_move"] == "black"
    assert payload["game"]["your_move"] is True
    assert payload["game"]["move_number"] == 1
    assert payload["game"]["reply_due"] is not None

    answered = correspondence_service.play_move(session, game_id, "e7e5")
    assert answered["game"]["to_move"] == "white"
    assert answered["game"]["your_move"] is False
    assert answered["game"]["move_number"] == 2
    # Nothing is due while the opponent is thinking, and the clock starts again on the move
    # that hands the turn back.
    assert answered["game"]["reply_due"] is None
    back = correspondence_service.play_move(session, game_id, "g1f3")
    assert back["game"]["your_move"] is True
    assert back["game"]["reply_due"] is not None
    # 1…e5 is Black's move and is written with White's number, and its numbers read in
    # Black's frame — the side that played it.
    node = node_at(answered, "e5")
    assert (node["frame"], node["move_number"], node["turn"]) == ("black", 1, "white")


def test_a_pgn_arrives_as_the_played_path(session: Session) -> None:
    payload = correspondence_service.import_game(
        session, ICCF_PGN, owner_color=Color.WHITE, iccf_id="1234567"
    )
    game_id = payload["game"]["game_id"]

    assert payload["game"]["moves_san"] == ["e4", "e5", "Nf3", "Nc6"]
    assert payload["game"]["event"] == "WS/O/123"
    assert payload["game"]["url"] == "https://www.iccf.com/game?id=1234567"
    assert payload["game"]["your_move"] is True
    # Five nodes, all played, one path.
    walked = correspondence_service.verify_played_path(session, game_id)
    assert [node.move_san for node in walked] == [None, "e4", "e5", "Nf3", "Nc6"]
    # It is the owner's move, so a deadline was computed from the reply window.
    assert payload["game"]["reply_due"] is not None
    assert 9 < (payload["game"]["days_left"] or 0) <= 10


def test_a_pgn_that_is_not_a_game_is_refused(session: Session) -> None:
    with pytest.raises(correspondence_service.CorrespondenceError):
        correspondence_service.import_game(session, "not a pgn", owner_color=Color.WHITE)


# --- playing, taking back, finishing ---------------------------------------


def test_a_move_moves_the_game_and_the_tree_together(session: Session) -> None:
    payload = make_game(session)
    game_id = payload["game"]["game_id"]

    after = correspondence_service.play_move(session, game_id, "e2e4")
    game = session.get(Game, game_id)
    assert game is not None
    assert game.moves_uci == ["e2e4"]
    assert game.moves_san == ["e4"]
    assert game.ply_count == 1
    assert "1. e4" in game.pgn
    # One stored position per ply, the last one with no move out of it yet.
    rows = session.scalars(
        select(GamePosition).where(GamePosition.game_id == game_id).order_by(GamePosition.ply)
    ).all()
    assert [(row.ply, row.move_san) for row in rows] == [(0, "e4"), (1, None)]
    assert after["game"]["your_move"] is False
    assert after["game"]["reply_due"] is None
    correspondence_service.verify_played_path(session, game_id)


def test_the_opponents_move_starts_the_clock(session: Session) -> None:
    payload = make_game(session, days_per_move=3)
    game_id = payload["game"]["game_id"]
    correspondence_service.play_move(session, game_id, "e2e4")
    after = correspondence_service.play_move(session, game_id, "e7e5")

    assert after["game"]["your_move"] is True
    assert 2 < (after["game"]["days_left"] or 0) <= 3


def test_a_move_already_in_the_tree_is_reused_and_promoted(session: Session) -> None:
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    root_id = payload["tree"]["id"]
    correspondence_service.add_node(session, parent_id=root_id, ucis=["d2d4", "d7d5"])
    correspondence_service.add_node(session, parent_id=root_id, ucis=["e2e4"])

    after = correspondence_service.play_move(session, game_id, "e2e4")
    children = after["tree"]["children"]
    # The played move is the first of its siblings, and the analysis under d4 is untouched.
    assert [child["san"] for child in children] == ["e4", "d4"]
    assert children[0]["played"] is True
    assert children[1]["children"][0]["san"] == "d5"
    assert len(session.scalars(select(CorrespondenceNode)).all()) == 4


def test_an_illegal_move_changes_nothing(session: Session) -> None:
    payload = make_game(session)
    game_id = payload["game"]["game_id"]

    with pytest.raises(games_service.IllegalMoveError):
        correspondence_service.play_move(session, game_id, "e2e5")
    session.rollback()
    game = session.get(Game, game_id)
    assert game is not None and game.moves_uci == []
    assert session.scalars(select(CorrespondenceNode)).all() != []


def test_taking_a_move_back_leaves_the_node_and_its_analysis(session: Session) -> None:
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    correspondence_service.play_move(session, game_id, "e2e4")
    played = node_at(correspondence_service.get_game(session, game_id), "e4")
    correspondence_service.add_node(session, parent_id=played["id"], ucis=["c7c5"])

    after = correspondence_service.undo_move(session, game_id)
    game = session.get(Game, game_id)
    assert game is not None
    assert game.moves_uci == [] and game.ply_count == 0
    assert "1. e4" not in game.pgn
    kept = after["tree"]["children"][0]
    assert kept["san"] == "e4" and kept["played"] is False
    assert kept["children"][0]["san"] == "c5"
    correspondence_service.verify_played_path(session, game_id)


def test_taking_back_the_only_position_is_refused(session: Session) -> None:
    payload = make_game(session)
    with pytest.raises(games_service.GameMutationError):
        correspondence_service.undo_move(session, payload["game"]["game_id"])


def test_finishing_queues_both_passes_and_freezes_the_tree(session: Session) -> None:
    add_engine(session)
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    correspondence_service.play_move(session, game_id, "e2e4")

    finished = correspondence_service.finish_game(
        session, game_id, result=Result.WHITE_WIN, termination="resignation"
    )
    game = session.get(Game, game_id)
    assert game is not None
    assert game.result is Result.WHITE_WIN
    assert game.termination == "resignation"
    assert '[Result "1-0"]' in game.pgn
    assert finished["game"]["state"] == "finished"
    assert finished["game"]["reply_due"] is None
    tiers = sorted(str(run.tier) for run in session.scalars(select(AnalysisRun)))
    assert tiers == ["deep", "quick"]

    with pytest.raises(correspondence_service.TreeLockedError):
        correspondence_service.play_move(session, game_id, "e7e5")
    with pytest.raises(correspondence_service.TreeLockedError):
        correspondence_service.add_node(session, parent_id=payload["tree"]["id"], ucis=["d2d4"])


def test_finishing_without_an_engine_still_finishes(session: Session) -> None:
    payload = make_game(session)
    finished = correspondence_service.finish_game(
        session, payload["game"]["game_id"], result=Result.DRAW
    )
    assert finished["game"]["result"] == "1/2-1/2"
    assert finished["queued_runs"] == []


def test_a_game_does_not_finish_as_a_star(session: Session) -> None:
    payload = make_game(session)
    with pytest.raises(correspondence_service.CorrespondenceError):
        correspondence_service.finish_game(
            session, payload["game"]["game_id"], result=Result.UNKNOWN
        )


def test_deleting_the_game_takes_the_tree_with_it(session: Session) -> None:
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    correspondence_service.play_move(session, game_id, "e2e4")
    node = node_at(correspondence_service.get_game(session, game_id), "e4")
    session.add(
        CorrespondenceSearch(node_id=node["id"], kind=SearchKind.SEARCH, status=SearchStatus.DONE)
    )
    session.commit()

    games_service.delete_games(session, [game_id])

    assert session.scalars(select(CorrespondenceGame)).all() == []
    assert session.scalars(select(CorrespondenceNode)).all() == []
    assert session.scalars(select(CorrespondenceSearch)).all() == []


# --- the tree --------------------------------------------------------------


def test_a_line_is_added_move_by_move_and_re_adding_it_creates_nothing(
    session: Session,
) -> None:
    payload = make_game(session)
    root_id = payload["tree"]["id"]

    added = correspondence_service.add_node(
        session, parent_id=root_id, ucis=["e2e4", "c7c5", "g1f3"]
    )
    assert added["created"] == 3
    assert added["tip"]["san"] == "Nf3"

    again = correspondence_service.add_node(
        session, parent_id=root_id, ucis=["e2e4", "c7c5", "g1f3"]
    )
    assert again["created"] == 0
    assert again["tip"]["id"] == added["tip"]["id"]


def test_a_line_that_cannot_be_played_writes_none_of_itself(session: Session) -> None:
    payload = make_game(session)
    root_id = payload["tree"]["id"]

    with pytest.raises(correspondence_service.CorrespondenceError):
        correspondence_service.add_node(session, parent_id=root_id, ucis=["e2e4", "e2e4"])
    assert len(session.scalars(select(CorrespondenceNode)).all()) == 1


def test_the_san_comes_from_the_board_the_move_was_made_on(session: Session) -> None:
    payload = make_game(session)
    added = correspondence_service.add_node(
        session,
        parent_id=payload["tree"]["id"],
        ucis=["g1f3", "g8f6", "b1c3", "b8c6"],
    )
    assert added["tip"]["san"] == "Nc6"


def test_a_comment_a_mark_and_a_promotion(session: Session) -> None:
    payload = make_game(session)
    root_id = payload["tree"]["id"]
    correspondence_service.add_node(session, parent_id=root_id, ucis=["e2e4"])
    second = correspondence_service.add_node(session, parent_id=root_id, ucis=["d2d4"])

    edited = correspondence_service.update_node(
        session, second["tip"]["id"], comment="  the main try  ", mark="good", promote=True
    )
    assert edited["comment"] == "the main try"
    assert edited["mark"] == "good"
    assert edited["glyph"] == "!"
    assert edited["rank"] == 0

    tree = correspondence_service.get_game(session, payload["game"]["game_id"])
    assert [child["san"] for child in tree["tree"]["children"]] == ["d4", "e4"]
    # Left out is left alone, null clears.
    kept = correspondence_service.update_node(session, second["tip"]["id"], mark=None)
    assert kept["comment"] == "the main try" and kept["mark"] is None


def test_folding_a_line_is_kept_on_the_node_and_survives_the_game_finishing(
    session: Session,
) -> None:
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    root_id = payload["tree"]["id"]
    e4 = correspondence_service.add_node(session, parent_id=root_id, ucis=["e2e4"])["tip"]
    correspondence_service.add_node(session, parent_id=e4["id"], ucis=["c7c5"])
    assert e4["san"] == "e4" and e4["collapsed"] is False

    folded = correspondence_service.update_node(session, e4["id"], collapsed=True)
    assert folded["collapsed"] is True
    tree = correspondence_service.get_game(session, game_id)
    assert tree["tree"]["children"][0]["collapsed"] is True

    # The fold is a view preference, so it is the one edit a finished game's tree still
    # takes; a comment on the same node is refused like any other write.
    correspondence_service.finish_game(session, game_id, result=Result.DRAW)
    unfolded = correspondence_service.update_node(session, e4["id"], collapsed=False)
    assert unfolded["collapsed"] is False
    with pytest.raises(correspondence_service.TreeLockedError):
        correspondence_service.update_node(session, e4["id"], collapsed=True, comment="late")


def test_a_mark_nobody_has_is_refused(session: Session) -> None:
    payload = make_game(session)
    added = correspondence_service.add_node(session, parent_id=payload["tree"]["id"], ucis=["e2e4"])
    with pytest.raises(correspondence_service.CorrespondenceError):
        correspondence_service.update_node(session, added["tip"]["id"], mark="brilliant")


def test_deleting_a_node_takes_its_subtree_and_closes_the_ranks(session: Session) -> None:
    payload = make_game(session)
    root_id = payload["tree"]["id"]
    first = correspondence_service.add_node(session, parent_id=root_id, ucis=["e2e4", "c7c5"])
    correspondence_service.add_node(session, parent_id=root_id, ucis=["d2d4"])
    correspondence_service.add_node(session, parent_id=root_id, ucis=["c2c4"])
    doomed = session.scalars(
        select(CorrespondenceNode).where(CorrespondenceNode.move_uci == "e2e4")
    ).one()

    correspondence_service.delete_node(session, doomed.id)

    left = correspondence_service.get_game(session, payload["game"]["game_id"])["tree"]
    assert [child["san"] for child in left["children"]] == ["d4", "c4"]
    assert [child["rank"] for child in left["children"]] == [0, 1]
    assert session.get(CorrespondenceNode, first["tip"]["id"]) is None


def test_a_sibling_set_is_one_games_own(session: Session) -> None:
    """Ranking is per game, which only the root makes visible.

    Every other node's siblings are found through a parent that belongs to one game; a root
    has no parent, so "the nodes with no parent" would be every game's root at once and a
    promote on one game's first position would renumber and restamp the others'.
    """
    first = make_game(session, iccf_id="1")
    second = make_game(session, iccf_id="2")
    third = make_game(session, iccf_id="3")

    correspondence_service.update_node(session, third["tree"]["id"], promote=True)

    roots = {
        row.game_id: row.rank
        for row in session.scalars(
            select(CorrespondenceNode).where(CorrespondenceNode.parent_id.is_(None))
        )
    }
    assert roots == {
        first["game"]["game_id"]: 0,
        second["game"]["game_id"]: 0,
        third["game"]["game_id"]: 0,
    }


def test_the_root_and_a_played_move_are_not_deletable(session: Session) -> None:
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    correspondence_service.play_move(session, game_id, "e2e4")
    played = node_at(correspondence_service.get_game(session, game_id), "e4")

    with pytest.raises(correspondence_service.CorrespondenceError):
        correspondence_service.delete_node(session, payload["tree"]["id"])
    with pytest.raises(correspondence_service.CorrespondenceError):
        correspondence_service.delete_node(session, played["id"])


def test_a_search_inside_a_subtree_refuses_the_delete(session: Session) -> None:
    payload = make_game(session)
    added = correspondence_service.add_node(
        session, parent_id=payload["tree"]["id"], ucis=["e2e4", "c7c5"]
    )
    session.add(
        CorrespondenceSearch(
            node_id=added["tip"]["id"], kind=SearchKind.SEARCH, status=SearchStatus.PAUSED
        )
    )
    session.commit()
    branch = session.scalars(
        select(CorrespondenceNode).where(CorrespondenceNode.move_uci == "e2e4")
    ).one()

    with pytest.raises(correspondence_service.NodeBusyError):
        correspondence_service.delete_node(session, branch.id)

    # A search that has finished holds nothing, so the same delete goes through.
    session.query(CorrespondenceSearch).update({"status": SearchStatus.DONE})
    session.commit()
    correspondence_service.delete_node(session, branch.id)
    assert len(session.scalars(select(CorrespondenceNode)).all()) == 1


def test_a_played_path_that_has_been_tampered_with_is_caught(session: Session) -> None:
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    correspondence_service.play_move(session, game_id, "e2e4")
    added = correspondence_service.add_node(session, parent_id=payload["tree"]["id"], ucis=["d2d4"])
    stray = session.get(CorrespondenceNode, added["tip"]["id"])
    assert stray is not None
    stray.played = True
    session.commit()

    with pytest.raises(correspondence_service.CorrespondenceError):
        correspondence_service.verify_played_path(session, game_id)


# --- the read model --------------------------------------------------------


def test_a_nodes_own_eval_is_read_in_the_movers_frame(session: Session) -> None:
    """A stored score is the side to move's; `15.Bd3 +0.41` is the mover's."""
    payload = make_game(session)
    correspondence_service.add_node(session, parent_id=payload["tree"]["id"], ucis=["e2e4"])
    # After 1.e4 it is Black to move, and the engine says Black is 30 centipawns worse.
    add_eval(session, epd_after("e2e4"), cp=-30, depth=40)

    node = node_at(correspondence_service.get_game(session, payload["game"]["game_id"]), "e4")
    assert node["frame"] == "white"
    assert node["own"] == {
        "cp": 30,
        "mate": None,
        "depth": 40,
        "nodes": None,
        "engine_id": None,
        "engine_name": "Stockfish",
        "updated_at": node["own"]["updated_at"],
    }
    # The raw row is still there for an engine pane, in the frame it was stored in.
    assert node["evals"][0]["cp"] == -30


def test_the_backed_eval_is_a_minimax_over_the_children(session: Session) -> None:
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    root_id = payload["tree"]["id"]
    correspondence_service.add_node(session, parent_id=root_id, ucis=["e2e4", "c7c5"])
    correspondence_service.add_node(session, parent_id=root_id, ucis=["e2e4", "e7e5"])
    # 1.e4 looks like +0.30 for White on its own.
    add_eval(session, epd_after("e2e4"), cp=-30, depth=40)
    # Black to choose: 1...c5 leaves White +0.10, 1...e5 leaves White +0.50. Black takes
    # the first, so 1.e4 is backed at +0.10 rather than at its own +0.30.
    add_eval(session, epd_after("e2e4", "c7c5"), cp=10, depth=40)
    add_eval(session, epd_after("e2e4", "e7e5"), cp=50, depth=40)

    node = node_at(correspondence_service.get_game(session, game_id), "e4")
    assert node["own"]["cp"] == 30
    assert node["backed"] == {"cp": 10, "mate": None}
    # Each child reads in its own mover's frame: Black's numbers are Black's.
    sicilian = node_at(correspondence_service.get_game(session, game_id), "e4", "c5")
    assert sicilian["frame"] == "black"
    assert sicilian["own"]["cp"] == -10
    # A node with no valued child has no backed number at all.
    assert sicilian["backed"] is None


def test_white_takes_the_maximum_and_black_the_minimum(session: Session) -> None:
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    root_id = payload["tree"]["id"]
    # White to move at the root, choosing between two first moves.
    correspondence_service.add_node(session, parent_id=root_id, ucis=["e2e4"])
    correspondence_service.add_node(session, parent_id=root_id, ucis=["d2d4"])
    add_eval(session, epd_after("e2e4"), cp=-20, depth=30)
    add_eval(session, epd_after("d2d4"), cp=-60, depth=30)

    tree = correspondence_service.get_game(session, game_id)["tree"]
    # White picks 1.d4, worth +0.60 to White, and the root reads in White's frame.
    assert tree["frame"] == "white"
    assert tree["backed"] == {"cp": 60, "mate": None}


def test_a_mate_outranks_every_centipawn_score(session: Session) -> None:
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    root_id = payload["tree"]["id"]
    correspondence_service.add_node(session, parent_id=root_id, ucis=["e2e4"])
    correspondence_service.add_node(session, parent_id=root_id, ucis=["d2d4"])
    add_eval(session, epd_after("e2e4"), cp=900, depth=30)
    # Black is mated in three after 1.d4, which no evaluation in pawns can beat.
    add_eval(session, epd_after("d2d4"), mate=-3, depth=30)

    tree = correspondence_service.get_game(session, game_id)["tree"]
    assert tree["backed"] == {"cp": None, "mate": 3}


def test_a_pin_decides_which_engine_a_node_reads(session: Session) -> None:
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    stockfish = add_engine(session, "Stockfish")
    leela = add_engine(session, "Leela")
    correspondence_service.add_node(session, parent_id=payload["tree"]["id"], ucis=["e2e4"])
    add_eval(session, epd_after("e2e4"), engine=stockfish, cp=-30, depth=50)
    add_eval(session, epd_after("e2e4"), engine=leela, cp=-10, depth=12)

    node = node_at(correspondence_service.get_game(session, game_id), "e4")
    # The deepest verdict, with nobody pinned; and the two are far enough apart to be
    # marked as a disagreement.
    assert node["own"]["engine_name"] == "Stockfish"
    assert node["disagree"] is False

    correspondence_service.update_node(session, node["id"], pinned_engine_id=leela.id)
    pinned = node_at(correspondence_service.get_game(session, game_id), "e4")
    assert pinned["own"]["engine_name"] == "Leela"
    assert pinned["own"]["cp"] == 10


def test_engines_that_are_far_apart_are_marked(session: Session) -> None:
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    stockfish = add_engine(session, "Stockfish")
    leela = add_engine(session, "Leela")
    correspondence_service.add_node(session, parent_id=payload["tree"]["id"], ucis=["e2e4"])
    add_eval(session, epd_after("e2e4"), engine=stockfish, cp=-30, depth=50)
    add_eval(session, epd_after("e2e4"), engine=leela, cp=-120, depth=40)

    node = node_at(correspondence_service.get_game(session, game_id), "e4")
    assert node["disagree"] is True


def test_a_pin_on_an_engine_that_is_not_there_is_refused(session: Session) -> None:
    payload = make_game(session)
    added = correspondence_service.add_node(session, parent_id=payload["tree"]["id"], ucis=["e2e4"])
    with pytest.raises(correspondence_service.CorrespondenceError):
        correspondence_service.update_node(session, added["tip"]["id"], pinned_engine_id=404)


def test_the_draw_flags_are_computed_from_the_path(session: Session) -> None:
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    shuffle = ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"]
    correspondence_service.add_node(session, parent_id=payload["tree"]["id"], ucis=shuffle)

    tree = correspondence_service.get_game(session, game_id)
    node = node_at(tree, "Nf3")
    assert node["flags"]["repetition"] == 1
    assert node["flags"]["halfmove_clock"] == 1

    last = node_at(tree, "Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8")
    assert last["flags"]["repetition"] == 3
    assert last["flags"]["threefold"] is True
    assert last["flags"]["halfmove_clock"] == 8
    assert last["flags"]["fifty_move"] is False


def test_a_dead_position_and_a_mate_are_flagged(session: Session) -> None:
    payload = make_game(session, start_fen=BACK_RANK, iccf_id=None)
    game_id = payload["game"]["game_id"]
    correspondence_service.add_node(session, parent_id=payload["tree"]["id"], ucis=["a1a8"])
    node = node_at(correspondence_service.get_game(session, game_id), "Ra8#")
    assert node["flags"]["checkmate"] is True

    bare = make_game(session, start_fen=BARE_KINGS, iccf_id=None, black="Zweiter, Gegner")
    correspondence_service.add_node(session, parent_id=bare["tree"]["id"], ucis=["g1g2"])
    taken = node_at(correspondence_service.get_game(session, bare["game"]["game_id"]), "Kxg2")
    assert taken["flags"]["dead_position"] is True


# --- the export ------------------------------------------------------------


def test_the_export_carries_the_tree_the_comments_and_the_glyphs(session: Session) -> None:
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    correspondence_service.play_move(session, game_id, "e2e4")
    correspondence_service.play_move(session, game_id, "e7e5")
    played = node_at(correspondence_service.get_game(session, game_id), "e4")
    branch = correspondence_service.add_node(session, parent_id=played["id"], ucis=["c7c5"])
    correspondence_service.update_node(
        session, branch["tip"]["id"], comment="the one to watch", mark="interesting"
    )
    add_eval(session, epd_after("e2e4", "c7c5"), cp=25, depth=44)

    exported = correspondence_service.export_pgn(session, game_id)
    read = chess.pgn.read_game(io.StringIO(exported))

    assert read is not None
    assert read.headers["Event"] == "WS/O/123"
    assert read.headers["Site"] == "https://www.iccf.com/game?id=1234567"
    assert [node.san() for node in read.mainline()] == ["e4", "e5"]
    variation = read.variations[0].variations[1]
    assert variation.san() == "c5"
    assert 5 in variation.nags
    assert "the one to watch" in variation.comment
    assert "[%eval 0.25]" in variation.comment


def test_the_export_writes_evals_in_whites_frame(session: Session) -> None:
    """`[%eval]` is White's point of view wherever it is read — Lichess, ChessBase, SCID.

    The rows store the mover's, so a verdict on a position with Black to move has to be
    negated on the way out. A file that shipped the stored sign would read as the opposite
    verdict on every second move.
    """
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    correspondence_service.play_move(session, game_id, "e2e4")
    # Black to move after 1.e4, and Black is 30 centipawns worse: White +0.30.
    add_eval(session, epd_after("e2e4"), cp=-30, depth=40)

    exported = correspondence_service.export_pgn(session, game_id)
    read = chess.pgn.read_game(io.StringIO(exported))
    assert read is not None
    assert "[%eval 0.30]" in read.variations[0].comment


def test_the_export_keeps_a_starting_position(session: Session) -> None:
    payload = make_game(session, start_fen=BACK_RANK, iccf_id=None)
    correspondence_service.play_move(session, payload["game"]["game_id"], "a1a8")

    exported = correspondence_service.export_pgn(session, payload["game"]["game_id"])
    read = chess.pgn.read_game(io.StringIO(exported))
    assert read is not None
    assert read.headers["FEN"] == BACK_RANK
    assert [node.san() for node in read.mainline()] == ["Ra8#"]


# --- the game the library sees ---------------------------------------------


def test_the_stored_game_keeps_up_with_every_move(session: Session) -> None:
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    game = session.get(Game, game_id)
    assert game is not None
    before = game.dedup_hash
    game.card = {"stale": True}
    session.commit()

    correspondence_service.play_move(session, game_id, "e2e4")
    session.refresh(game)
    assert game.dedup_hash != before
    assert game.card is None
    # The PGN is rebuilt rather than appended to, so the headers survive intact.
    assert '[White "Baum, Philipp"]' in game.pgn
    assert '[Event "WS/O/123"]' in game.pgn
    assert game.pgn.strip().endswith("1. e4 *")


def test_a_game_played_move_by_move_is_named_by_the_book(session: Session) -> None:
    """The opening is re-asked on every change, so a game grown a move at a time has one.

    Every other game is named once, on the way in. This one has no moves when it is created,
    so a name written then would be no name at all — and it would reach the library missing
    from the Opening filter, from the openings dimension in stats and from its own header.
    """
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    game = session.get(Game, game_id)
    assert game is not None
    assert (game.eco, game.opening_name) == (None, None)

    for uci in ("e2e4", "c7c5", "g1f3", "d7d6"):
        correspondence_service.play_move(session, game_id, uci)
    session.refresh(game)
    assert game.eco == "B50"
    assert game.opening_name is not None
    assert "Sicilian" in game.opening_name
    assert f'[ECO "{game.eco}"]' in game.pgn

    # And a move taken back takes the name it brought with it.
    correspondence_service.undo_move(session, game_id)
    correspondence_service.undo_move(session, game_id)
    session.refresh(game)
    assert game.eco == "B20"


def test_a_finished_game_takes_no_more_moves(session: Session) -> None:
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    game = session.get(Game, game_id)
    assert game is not None
    game.result = Result.WHITE_WIN
    session.commit()

    with pytest.raises(games_service.GameFinishedError):
        games_service.append_move(session, game, "e2e4")
    with pytest.raises(games_service.GameFinishedError):
        games_service.pop_move(session, game)


def test_listing_puts_your_move_first_and_soonest_first(session: Session) -> None:
    waiting = make_game(session, iccf_id="1", url=None)
    correspondence_service.play_move(session, waiting["game"]["game_id"], "e2e4")
    urgent = make_game(session, iccf_id="2", url=None, days_per_move=1)
    correspondence_service.play_move(session, urgent["game"]["game_id"], "e2e4")
    correspondence_service.play_move(session, urgent["game"]["game_id"], "e7e5")
    later = make_game(session, iccf_id="3", url=None, days_per_move=20)
    correspondence_service.play_move(session, later["game"]["game_id"], "e2e4")
    correspondence_service.play_move(session, later["game"]["game_id"], "e7e5")
    done = make_game(session, iccf_id="4", url=None)
    correspondence_service.finish_game(session, done["game"]["game_id"], result=Result.DRAW)

    listed = correspondence_service.list_games(session)
    assert [row["game_id"] for row in listed["games"]] == [
        urgent["game"]["game_id"],
        later["game"]["game_id"],
        waiting["game"]["game_id"],
        done["game"]["game_id"],
    ]
    assert listed["counts"] == {"ongoing": 3, "finished": 1, "your_move": 2}
    only_finished = correspondence_service.list_games(session, state="finished")
    assert [row["game_id"] for row in only_finished["games"]] == [done["game"]["game_id"]]


def test_a_list_row_carries_the_verdict_on_the_current_position(session: Session) -> None:
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    correspondence_service.play_move(session, game_id, "e2e4")
    add_eval(session, epd_after("e2e4"), cp=-35, depth=42)

    row = correspondence_service.list_games(session)["games"][0]
    assert row["root_eval"]["cp"] == 35
    assert row["last_move_san"] == "e4"
    assert row["move_number"] == 1


def test_the_list_prints_the_verdict_in_whites_frame_whoever_moved_last(
    session: Session,
) -> None:
    """One unlabelled number under one heading cannot change sides with the last mover."""
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    correspondence_service.play_move(session, game_id, "e2e4")
    correspondence_service.play_move(session, game_id, "e7e5")
    # White to move, and White is 0.40 better: the node's own frame is Black's, because
    # Black played the move into it, but the list column is always read as White's.
    add_eval(session, epd_after("e2e4", "e7e5"), cp=40, depth=42)

    row = correspondence_service.list_games(session)["games"][0]
    assert row["root_eval"]["cp"] == 40
    detail = correspondence_service.get_game(session, game_id)
    assert detail["game"]["root_eval"]["cp"] == 40
    # The tree itself keeps the mover's frame, which is how a variation is read.
    assert node_at(detail, "e4", "e5")["frame"] == "black"
    assert node_at(detail, "e4", "e5")["own"]["cp"] == -40


def test_the_event_and_the_link_are_editable_and_reach_the_pgn(session: Session) -> None:
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    updated = correspondence_service.update_game(
        session,
        game_id,
        event="WS/O/999",
        url="https://example.invalid/game/2",
        days_per_move=4,
    )
    assert updated["game"]["event"] == "WS/O/999"
    assert updated["game"]["days_per_move"] == 4
    game = session.get(Game, game_id)
    assert game is not None
    assert '[Event "WS/O/999"]' in game.pgn
    assert '[Site "https://example.invalid/game/2"]' in game.pgn


def test_clearing_the_event_and_the_link_clears_them_out_of_the_pgn(session: Session) -> None:
    """The row is the authority, so a deleted tournament name leaves the export as well."""
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    correspondence_service.update_game(
        session, game_id, event="WS/O/999", url="https://example.invalid/game/2"
    )

    cleared = correspondence_service.update_game(session, game_id, event=None, url=None)
    assert cleared["game"]["event"] is None
    assert cleared["game"]["url"] is None
    game = session.get(Game, game_id)
    assert game is not None
    assert "WS/O/999" not in game.pgn
    assert "example.invalid" not in game.pgn
    exported = correspondence_service.export_pgn(session, game_id)
    assert "WS/O/999" not in exported
    assert "example.invalid" not in exported


def test_a_reply_date_can_be_set_by_hand_and_cleared(session: Session) -> None:
    payload = make_game(session)
    game_id = payload["game"]["game_id"]
    when = datetime.now(UTC) + timedelta(days=2)
    set_by_hand = correspondence_service.update_game(session, game_id, reply_due=when)
    assert set_by_hand["game"]["reply_due"] is not None
    cleared = correspondence_service.update_game(session, game_id, reply_due=None)
    assert cleared["game"]["reply_due"] is None


def test_every_change_says_so_on_the_event_hub(session: Session) -> None:
    """One event for every change: the tree, the moves and the deadlines are one document."""
    seen: list[dict[str, Any]] = []
    cancel = events_service.subscribe(seen.append)
    try:
        payload = make_game(session)
        game_id = payload["game"]["game_id"]
        correspondence_service.play_move(session, game_id, "e2e4")
        added = correspondence_service.add_node(
            session, parent_id=payload["tree"]["id"], ucis=["d2d4"]
        )
        correspondence_service.update_node(session, added["tip"]["id"], comment="later")
        correspondence_service.delete_node(session, added["tip"]["id"])
        correspondence_service.undo_move(session, game_id)
        correspondence_service.finish_game(session, game_id, result=Result.DRAW)
    finally:
        cancel()

    ours = [event for event in seen if event["event"] == "correspondence.updated"]
    assert len(ours) == 7
    assert {event["game_id"] for event in ours} == {game_id}


def test_an_unknown_game_is_a_lookup_failure(session: Session) -> None:
    with pytest.raises(correspondence_service.UnknownCorrespondenceGameError):
        correspondence_service.get_game(session, 404)


# --- the settings ----------------------------------------------------------


def test_the_three_settings_have_defaults_and_clamp(session: Session) -> None:
    assert app_settings_service.get_correspondence_enabled(session) is False
    assert app_settings_service.get_correspondence_days_per_move(session) == 10
    assert app_settings_service.get_correspondence_multipv(session) == 3

    app_settings_service.set_value(session, app_settings_service.CORRESPONDENCE_ENABLED, 1)
    app_settings_service.set_value(session, app_settings_service.CORRESPONDENCE_DAYS_PER_MOVE, 900)
    app_settings_service.set_value(session, app_settings_service.CORRESPONDENCE_MULTIPV, 9)

    assert app_settings_service.get_correspondence_enabled(session) is True
    assert app_settings_service.get_correspondence_days_per_move(session) == 365
    assert app_settings_service.get_correspondence_multipv(session) == 5


def test_a_new_game_takes_the_deployments_reply_window(session: Session) -> None:
    app_settings_service.set_value(session, app_settings_service.CORRESPONDENCE_DAYS_PER_MOVE, 5)
    payload = make_game(session)
    assert payload["game"]["days_per_move"] == 5


# --- the migration ---------------------------------------------------------


def test_the_migration_builds_the_four_tables(settings: Settings) -> None:
    upgrade_to_head(settings)
    inspector = inspect(get_engine(settings))
    tables = set(inspector.get_table_names())

    assert {
        "correspondence_games",
        "correspondence_nodes",
        "correspondence_evals",
        "correspondence_searches",
    } <= tables
    columns = {column["name"] for column in inspector.get_columns("analysis_runs")}
    assert "correspondence_search_id" in columns
    indexed = {
        tuple(index["column_names"]) for index in inspector.get_indexes("correspondence_nodes")
    }
    assert ("game_id", "parent_id") in indexed


# --- the HTTP surface ------------------------------------------------------


@pytest.fixture()
def api(settings: Settings) -> Iterator[TestClient]:
    settings.analysis_workers = False
    with running_app(create_app(settings)) as client:
        yield client


def error_of(response: Any) -> str:
    return response.json()["error"]


def created(api: TestClient, **changes: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "white": "Baum, Philipp",
        "black": "Gegner, Ein",
        "owner_color": "white",
        "event": "WS/O/123",
        "iccf_id": "1234567",
    }
    body.update(changes)
    response = api.post("/correspondence/games", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def test_the_list_is_empty_before_anything_is_played(api: TestClient) -> None:
    body = api.get("/correspondence/games").json()
    assert body == {"games": [], "counts": {"ongoing": 0, "finished": 0, "your_move": 0}}


def test_a_game_is_created_read_and_patched_over_http(api: TestClient) -> None:
    payload = created(api)
    game_id = payload["game"]["game_id"]
    assert payload["game"]["source"] == "iccf"
    assert payload["tree"]["ply"] == 0

    read = api.get(f"/correspondence/games/{game_id}")
    assert read.status_code == 200
    assert read.json()["game"]["white"] == "Baum, Philipp"

    patched = api.patch(f"/correspondence/games/{game_id}", json={"event": "WS/O/456"})
    assert patched.json()["game"]["event"] == "WS/O/456"
    # A patch that says nothing about the link leaves it alone.
    assert patched.json()["game"]["url"] is None


def test_a_pgn_is_imported_over_http(api: TestClient) -> None:
    response = api.post(
        "/correspondence/games/import",
        json={"pgn": ICCF_PGN, "owner_color": "white", "iccf_id": "999"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["game"]["moves_san"] == ["e4", "e5", "Nf3", "Nc6"]


def test_moves_are_played_and_taken_back_over_http(api: TestClient) -> None:
    game_id = created(api)["game"]["game_id"]

    played = api.post(f"/correspondence/games/{game_id}/moves", json={"uci": "e2e4"})
    assert played.status_code == 201
    assert played.json()["game"]["ply_count"] == 1

    undone = api.delete(f"/correspondence/games/{game_id}/moves/last")
    assert undone.status_code == 200
    assert undone.json()["game"]["ply_count"] == 0


def test_an_illegal_move_is_a_typed_422(api: TestClient) -> None:
    game_id = created(api)["game"]["game_id"]
    response = api.post(f"/correspondence/games/{game_id}/moves", json={"uci": "e2e5"})
    assert response.status_code == 422
    assert error_of(response) == "illegal_move"


def test_the_same_game_twice_is_a_typed_409(api: TestClient) -> None:
    created(api)
    response = api.post(
        "/correspondence/games",
        json={
            "white": "Baum, Philipp",
            "black": "Gegner, Ein",
            "owner_color": "white",
            "iccf_id": "1234567",
        },
    )
    assert response.status_code == 409
    assert error_of(response) == "duplicate_correspondence_game"


def test_a_finished_game_refuses_the_next_move_with_a_409(api: TestClient) -> None:
    game_id = created(api)["game"]["game_id"]
    finished = api.post(f"/correspondence/games/{game_id}/finish", json={"result": "1-0"})
    assert finished.status_code == 200
    assert finished.json()["game"]["state"] == "finished"

    response = api.post(f"/correspondence/games/{game_id}/moves", json={"uci": "e2e4"})
    assert response.status_code == 409
    assert error_of(response) == "correspondence_finished"


def test_nodes_are_created_patched_and_deleted_over_http(api: TestClient) -> None:
    payload = created(api)
    root_id = payload["tree"]["id"]

    added = api.post("/correspondence/nodes", json={"parent_id": root_id, "ucis": ["e2e4", "c7c5"]})
    assert added.status_code == 201
    assert added.json()["created"] == 2
    tip_id = added.json()["tip"]["id"]

    patched = api.patch(
        f"/correspondence/nodes/{tip_id}", json={"comment": "Sicilian", "mark": "good"}
    )
    assert patched.status_code == 200
    assert patched.json()["glyph"] == "!"

    branch = api.post("/correspondence/nodes", json={"parent_id": root_id, "uci": "d2d4"})
    assert branch.status_code == 201
    gone = api.delete(f"/correspondence/nodes/{branch.json()['tip']['id']}")
    assert gone.status_code == 204


def test_a_node_body_that_says_both_or_neither_is_refused(api: TestClient) -> None:
    root_id = created(api)["tree"]["id"]
    both = api.post(
        "/correspondence/nodes", json={"parent_id": root_id, "uci": "e2e4", "ucis": ["e2e4"]}
    )
    assert both.status_code == 422
    neither = api.post("/correspondence/nodes", json={"parent_id": root_id})
    assert neither.status_code == 422


def test_an_unknown_game_and_an_unknown_node_are_typed_404s(api: TestClient) -> None:
    game = api.get("/correspondence/games/404")
    assert game.status_code == 404
    assert error_of(game) == "unknown_correspondence_game"
    node = api.patch("/correspondence/nodes/404", json={"comment": "x"})
    assert node.status_code == 404
    assert error_of(node) == "unknown_correspondence_node"


def test_the_pgn_export_is_served_as_a_file(api: TestClient) -> None:
    game_id = created(api)["game"]["game_id"]
    api.post(f"/correspondence/games/{game_id}/moves", json={"uci": "e2e4"})

    response = api.get(f"/correspondence/games/{game_id}/pgn")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-chess-pgn")
    assert "1. e4" in response.text


def test_the_settings_survive_a_save_of_the_form(api: TestClient) -> None:
    """A PUT is the whole of the settings, so a key the form forgets is a key it wipes."""
    saved = api.put(
        "/settings",
        json={
            "correspondence_enabled": 1,
            "correspondence_days_per_move": 7,
            "correspondence_multipv": 4,
            "quick_nodes": 250_000,
        },
    )
    assert saved.status_code == 200
    body = saved.json()
    assert body["correspondence_enabled"] == 1
    assert body["correspondence_days_per_move"] == 7
    assert body["correspondence_multipv"] == 4
    assert api.get("/settings").json()["correspondence_days_per_move"] == 7

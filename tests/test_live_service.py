"""The live session: one board, driven from the coach's side, watched from the browser's.

The state is process-wide by design — there is one owner and one board — so every test
starts from an empty one and takes its subscribers back off on the way out.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.db.enums import Platform, Source
from backend.db.models import Account, Game
from backend.services import events as events_service
from backend.services import live
from backend.services.import_service import run_import

OWNER = "blunderbase"
FRENCH = "rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"
START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


@pytest.fixture(autouse=True)
def empty_board() -> Iterator[None]:
    """No test inherits the board — or the subscribers — of the one before it."""
    events_service.clear_subscribers()
    live.clear()
    yield
    live.clear()
    events_service.clear_subscribers()


@pytest.fixture()
def published() -> list[dict[str, Any]]:
    """Everything the live session announced, in order."""
    seen: list[dict[str, Any]] = []
    events_service.subscribe(seen.append)
    return seen


@pytest.fixture()
def game(session: Session, fixtures_dir: Path) -> Game:
    """One real imported game, so a live board can start from a stored one."""
    session.add(Account(platform=Platform.LICHESS, username=OWNER, is_owner=True))
    session.commit()
    run_import(session, Source.PGN, path=str(fixtures_dir / "query_games.pgn"))
    stored = session.scalars(select(Game).order_by(Game.id)).first()
    assert stored is not None
    return stored


# --- what is on the board --------------------------------------------------


def test_an_untouched_session_is_an_empty_board() -> None:
    state = live.get_state()
    assert state["active"] is False
    assert state["fen"] is None
    assert state["game_id"] is None
    assert state["moves"] == []
    assert state["viewer_count"] == 0


def test_show_position_puts_an_ad_hoc_fen_on_the_board() -> None:
    state = live.show_position(FRENCH)
    assert state["active"] is True
    assert state["fen"] == FRENCH
    assert state["turn"] == "white"
    assert state["game_id"] is None
    assert live.get_state() == state


def test_show_position_accepts_an_epd_without_move_counters() -> None:
    state = live.show_position("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -")
    assert state["fen"] == START


def test_show_game_starts_from_the_game_and_a_ply(session: Session, game: Game) -> None:
    state = live.show_game(session, game.id, ply=4)
    assert state["game_id"] == game.id
    assert state["ply"] == 4
    assert state["moves"] == []
    assert state["last_move"] == game.moves_uci[3]
    assert state["turn"] == "white"
    assert state["active"] is True


def test_show_game_defaults_to_the_starting_position(session: Session, game: Game) -> None:
    state = live.show_game(session, game.id)
    assert state["ply"] == 0
    assert state["fen"] == START
    assert state["last_move"] is None


def test_show_game_reaches_the_final_position(session: Session, game: Game) -> None:
    state = live.show_game(session, game.id, ply=game.ply_count)
    assert state["ply"] == game.ply_count


def test_showing_something_else_replaces_what_was_there(session: Session, game: Game) -> None:
    live.show_game(session, game.id, ply=2)
    live.annotate(text="watch the centre")
    state = live.show_position(FRENCH)
    assert state["game_id"] is None
    assert state["ply"] is None
    assert state["text"] is None
    assert state["arrows"] == []


def test_clear_takes_everything_off_the_board(session: Session, game: Game) -> None:
    live.show_game(session, game.id, ply=2)
    state = live.clear()
    assert state["active"] is False
    assert state["game_id"] is None
    assert state["fen"] is None


# --- moving ----------------------------------------------------------------


def test_make_move_advances_an_ad_hoc_board() -> None:
    live.show_position(START)
    state = live.make_move("e2e4")
    assert state["moves"] == ["e2e4"]
    assert state["last_move"] == "e2e4"
    assert state["turn"] == "black"
    assert state["fen"].startswith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b")


def test_the_games_own_next_move_keeps_the_board_on_the_game(
    session: Session, game: Game
) -> None:
    live.show_game(session, game.id, ply=0)
    state = live.make_move(game.moves_uci[0])
    assert state["ply"] == 1
    assert state["moves"] == [], "following the game is not a departure from it"
    assert state["game_id"] == game.id


def test_any_other_move_is_a_departure_from_the_game(session: Session, game: Game) -> None:
    live.show_game(session, game.id, ply=0)
    played = "a2a3" if game.moves_uci[0] != "a2a3" else "h2h3"
    state = live.make_move(played)
    assert state["ply"] == 0, "the game is still at the ply it was shown at"
    assert state["moves"] == [played]
    assert state["game_id"] == game.id

    # And once the board has left the line, it stays left.
    following = live.make_move(game.moves_uci[1] if len(game.moves_uci) > 1 else "a7a6")
    assert following["ply"] == 0
    assert len(following["moves"]) == 2


def test_an_illegal_move_is_refused_and_changes_nothing() -> None:
    live.show_position(START)
    with pytest.raises(live.IllegalMoveError):
        live.make_move("e2e5")
    assert live.get_state()["fen"] == START


def test_a_move_that_is_not_a_move_at_all_is_refused() -> None:
    live.show_position(START)
    with pytest.raises(live.IllegalMoveError):
        live.make_move("king to e4")


def test_moving_with_no_board_says_so() -> None:
    with pytest.raises(live.NoLivePositionError):
        live.make_move("e2e4")


def test_a_position_that_is_not_one_is_refused() -> None:
    with pytest.raises(live.LiveFenError):
        live.show_position("not a position")
    with pytest.raises(live.LiveFenError):
        live.show_position("   ")
    assert live.get_state()["active"] is False


def test_an_unknown_game_is_a_lookup_failure(session: Session) -> None:
    with pytest.raises(live.UnknownLiveGameError):
        live.show_game(session, 9999)


def test_a_ply_off_the_end_of_the_game_is_refused(session: Session, game: Game) -> None:
    with pytest.raises(live.LiveRequestError):
        live.show_game(session, game.id, ply=game.ply_count + 1)
    with pytest.raises(live.LiveRequestError):
        live.show_game(session, game.id, ply=-1)


def test_the_live_board_never_touches_the_stored_game(session: Session, game: Game) -> None:
    """The whole point of the invariant: driving the board is not editing history."""
    moves = list(game.moves_uci)
    live.show_game(session, game.id, ply=1)
    live.make_move("a7a6" if moves[1] != "a7a6" else "h7h6")
    session.expire_all()
    stored = session.get(Game, game.id)
    assert stored is not None
    assert stored.moves_uci == moves
    assert stored.ply_count == len(moves)


# --- drawing ---------------------------------------------------------------


def test_annotate_draws_arrows_squares_and_a_comment() -> None:
    live.show_position(START)
    state = live.annotate(
        arrows=["e2e4", "g1f3:blue"], squares=["d5", "f7:red"], text="  the two centre pawns  "
    )
    assert state["arrows"] == [
        {"from": "e2", "to": "e4", "color": "green"},
        {"from": "g1", "to": "f3", "color": "blue"},
    ]
    assert state["squares"] == [
        {"square": "d5", "color": "yellow"},
        {"square": "f7", "color": "red"},
    ]
    assert state["text"] == "the two centre pawns"


def test_annotate_also_takes_marks_as_objects() -> None:
    live.show_position(START)
    state = live.annotate(
        arrows=[{"from": "e2", "to": "e4", "color": "red"}],
        squares=[{"square": "e4", "color": "blue"}],
    )
    assert state["arrows"] == [{"from": "e2", "to": "e4", "color": "red"}]
    assert state["squares"] == [{"square": "e4", "color": "blue"}]


def test_annotate_leaves_what_it_was_not_given_alone() -> None:
    live.show_position(START)
    live.annotate(arrows=["e2e4"], text="first")
    state = live.annotate(text="second")
    assert state["arrows"] == [{"from": "e2", "to": "e4", "color": "green"}]
    assert state["text"] == "second"


def test_an_empty_argument_clears_that_one_thing() -> None:
    live.show_position(START)
    live.annotate(arrows=["e2e4"], squares=["e4"], text="something")
    state = live.annotate(arrows=[], text="")
    assert state["arrows"] == []
    assert state["squares"] == [{"square": "e4", "color": "yellow"}]
    assert state["text"] is None


def test_a_move_wipes_the_marks_but_keeps_the_comment() -> None:
    live.show_position(START)
    live.annotate(arrows=["e2e4"], squares=["e4"], text="watch this")
    state = live.make_move("e2e4")
    assert state["arrows"] == []
    assert state["squares"] == []
    assert state["text"] == "watch this"


def test_a_square_that_is_not_on_the_board_is_refused() -> None:
    live.show_position(START)
    with pytest.raises(live.LiveRequestError):
        live.annotate(squares=["j9"])
    with pytest.raises(live.LiveRequestError):
        live.annotate(arrows=["e2"])
    with pytest.raises(live.LiveRequestError):
        live.annotate(arrows=["e2e4:puce"])


def test_annotate_needs_something_to_do() -> None:
    live.show_position(START)
    with pytest.raises(live.LiveRequestError):
        live.annotate()


def test_a_comment_has_a_ceiling() -> None:
    live.show_position(START)
    with pytest.raises(live.LiveRequestError):
        live.annotate(text="x" * (live.MAX_TEXT + 1))


# --- the event stream ------------------------------------------------------


def test_every_mutation_publishes_the_whole_new_state(
    session: Session, game: Game, published: list[dict[str, Any]]
) -> None:
    live.show_game(session, game.id, ply=2)
    live.make_move(game.moves_uci[2])
    live.annotate(text="here")
    live.clear()

    assert [event["event"] for event in published] == [live.EVENT_LIVE_UPDATED] * 4
    assert published[0]["game_id"] == game.id and published[0]["ply"] == 2
    assert published[1]["ply"] == 3
    assert published[2]["text"] == "here"
    assert published[3]["active"] is False
    # Whole state, not a diff: the last event alone rebuilds the board.
    assert set(published[0]) >= set(live.get_state())


def test_a_read_publishes_nothing(published: list[dict[str, Any]]) -> None:
    live.get_state()
    assert published == []


def test_a_refused_mutation_publishes_nothing(published: list[dict[str, Any]]) -> None:
    with pytest.raises(live.LiveFenError):
        live.show_position("nonsense")
    with pytest.raises(live.NoLivePositionError):
        live.make_move("e2e4")
    assert published == []


def test_a_subscriber_that_raises_cannot_break_the_board() -> None:
    seen: list[str] = []

    def angry(_event: dict[str, Any]) -> None:
        raise RuntimeError("no")

    events_service.subscribe(angry)
    events_service.subscribe(lambda event: seen.append(event["event"]))
    live.show_position(START)
    assert seen == [live.EVENT_LIVE_UPDATED]
    assert live.get_state()["active"] is True


# --- who is watching -------------------------------------------------------


def test_the_viewer_count_follows_the_sockets() -> None:
    assert live.get_state()["viewer_count"] == 0
    live.viewer_joined()
    live.viewer_joined()
    assert live.viewer_count() == 2
    assert live.get_state()["viewer_count"] == 2
    live.viewer_left()
    assert live.get_state()["viewer_count"] == 1
    live.viewer_left()
    live.viewer_left()
    assert live.viewer_count() == 0, "a stray disconnect must not take it negative"


def test_clearing_the_board_does_not_disconnect_anybody() -> None:
    live.viewer_joined()
    try:
        assert live.clear()["viewer_count"] == 1
    finally:
        live.viewer_left()


def test_batch_navigation_preserves_annotations_and_rejects_partial_batch(session: Session) -> None:
    state = live.show_positions(session, [{"fen": START, "text": "First"}, {"fen": FRENCH}])
    assert state["position_count"] == 2
    live.annotate(arrows=["e2e4"])
    assert live.select_position(1)["fen"] == FRENCH
    assert live.select_position(0)["arrows"][0]["from"] == "e2"
    before = live.get_state()
    with pytest.raises(live.LiveFenError):
        live.show_positions(session, [{"fen": FRENCH}, {"fen": "invalid"}])
    assert live.get_state() == before
    with pytest.raises(live.LiveRequestError):
        live.select_position(2)
    assert live.clear()["position_count"] == 0


def test_batch_game_reference_contains_replay(session: Session, game: Game) -> None:
    state = live.show_positions(session, [{"game_id": game.id, "ply": 2}])
    assert state["line_positions"][2]["fen"] == state["fen"]
    assert len(state["line_positions"]) == len(game.moves_uci) + 1
    assert state["line_positions"][1]["san"]


# --- the owner's board: loading, playing, stepping -------------------------

ITALIAN_PGN = """[Event "Casual"]
[White "A"]
[Black "B"]

1. e4 e5 2. Nf3 (2. f4 exf4) 2... Nc6 3. Bc4 {the Italian} 1-0
"""


def test_new_board_is_the_starting_position_on_an_empty_line() -> None:
    state = live.new_board()
    assert state["fen"] == START
    assert state["active"] is True
    assert state["ply"] is None, "a bare position has no mainline to count along"
    assert state["line_positions"][0]["fen"] == START and len(state["line_positions"]) == 1


def test_load_takes_a_fen() -> None:
    assert live.load(fen=FRENCH)["fen"] == FRENCH


def test_load_takes_one_thing_and_only_one() -> None:
    with pytest.raises(live.LiveRequestError):
        live.load()
    with pytest.raises(live.LiveRequestError):
        live.load(fen=START, pgn=ITALIAN_PGN)


def test_a_pgn_loads_its_mainline_and_stands_at_the_end() -> None:
    state = live.load(pgn=ITALIAN_PGN)
    assert [p["san"] for p in state["line_positions"][1:]] == ["e4", "e5", "Nf3", "Nc6", "Bc4"]
    assert state["ply"] == 5
    assert state["last_move"] == "f1c4"
    assert state["moves"] == [], "the PGN's own variation is not the board's branch"
    assert state["game_id"] is None


def test_a_pgn_starts_where_its_fen_header_says() -> None:
    pgn = f'[SetUp "1"]\n[FEN "{FRENCH}"]\n\n2. d4 d5 *\n'
    state = live.load(pgn=pgn)
    assert state["line_positions"][0]["fen"] == FRENCH
    assert state["ply"] == 2


def test_a_pgn_with_an_illegal_move_is_refused_and_changes_nothing() -> None:
    live.show_position(FRENCH)
    with pytest.raises(live.LiveRequestError):
        live.load(pgn="1. e4 e5 2. Ke3 *")
    assert live.get_state()["fen"] == FRENCH


def test_text_that_is_no_pgn_is_refused() -> None:
    with pytest.raises(live.LiveRequestError):
        live.load(pgn="hello there, this is not chess")
    with pytest.raises(live.LiveRequestError):
        live.load(pgn="   ")


def test_play_on_an_empty_board_starts_one_for_the_owner_only() -> None:
    with pytest.raises(live.NoLivePositionError):
        live.play(["e2e4"])
    state = live.play(["e2e4"], start_if_empty=True)
    assert state["moves"] == ["e2e4"] and state["cursor"] == 1
    assert state["position_count"] == 1


def test_a_batch_is_played_whole_or_not_at_all() -> None:
    live.show_position(START)
    with pytest.raises(live.IllegalMoveError):
        live.play(["e2e4", "e7e5", "e1e3"])
    assert live.get_state()["fen"] == START
    state = live.play(["e2e4", "e7e5", "g1f3"])
    assert state["move_sans"] == ["e4", "e5", "Nf3"] and state["cursor"] == 3


def test_stepping_back_through_the_mainline_and_forward_again() -> None:
    live.load(pgn=ITALIAN_PGN)
    back = live.goto(2)
    assert back["fen"] == live.get_state()["line_positions"][2]["fen"]
    assert back["last_move"] == "e7e5"
    # Playing the mainline's own next move stays on it.
    state = live.play(["g1f3"])
    assert state["ply"] == 3 and state["moves"] == []


def test_a_departure_from_the_mainline_is_a_branch_that_survives_stepping_away() -> None:
    live.load(pgn=ITALIAN_PGN)
    live.goto(2)
    state = live.play(["f2f4", "e5f4"])
    assert state["base"] == 2 and state["ply"] == 2
    assert state["move_sans"] == ["f4", "exf4"] and state["cursor"] == 2

    elsewhere = live.goto(5)
    assert elsewhere["moves"] == ["f2f4", "e5f4"], "the branch is kept"
    assert elsewhere["cursor"] == 0 and elsewhere["base"] == 2

    inside = live.goto(2, 1)
    assert inside["last_move"] == "f2f4" and inside["cursor"] == 1


def test_the_branchs_own_next_move_steps_into_it() -> None:
    live.show_position(START)
    live.play(["e2e4", "e7e5", "g1f3"])
    live.goto(0, 1)
    state = live.play(["e7e5"])
    assert state["cursor"] == 2 and len(state["moves"]) == 3, "the tail is kept"


def test_another_move_inside_the_branch_cuts_it_there() -> None:
    live.show_position(START)
    live.play(["e2e4", "e7e5", "g1f3"])
    live.goto(0, 1)
    state = live.play(["c7c5"])
    assert state["moves"] == ["e2e4", "c7c5"] and state["cursor"] == 2


def test_a_new_departure_replaces_the_old_branch() -> None:
    live.load(pgn=ITALIAN_PGN)
    live.goto(2)
    live.play(["f2f4"])
    live.goto(4)
    state = live.play(["f1b5"])
    assert state["base"] == 4 and state["moves"] == ["f1b5"]


def test_goto_refuses_what_is_not_on_the_line() -> None:
    with pytest.raises(live.NoLivePositionError):
        live.goto(0)
    live.load(pgn=ITALIAN_PGN)
    for ply, cursor in ((6, 0), (-1, 0), (2, 1), (0, -1)):
        with pytest.raises(live.LiveRequestError):
            live.goto(ply, cursor)


def test_stepping_wipes_the_marks() -> None:
    live.load(pgn=ITALIAN_PGN)
    live.annotate(arrows=["e2e4"], text="look")
    state = live.goto(1)
    assert state["arrows"] == [] and state["text"] == "look"

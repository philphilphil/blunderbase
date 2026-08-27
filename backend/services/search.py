"""One box over the whole database: games, opponents, openings and notes.

Four groups from one string, each capped on its own. The box is typed into, not
submitted, so nothing here is expensive and nothing here is an error: it answers with
what it has and stays quiet until the query is worth answering.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import ColumnElement, case, func, or_, select
from sqlalchemy.orm import Session

from backend.db.enums import Color
from backend.db.models import Game
from backend.services import games as games_service
from backend.services import notes as notes_service
from backend.services.games import DRAW, WIN, GameFilters, outcome_condition

# Below this a query matches half the database, so it matches nothing instead.
MIN_QUERY = 2


def global_search(session: Session, query: str, *, limit: int = 5) -> dict[str, Any]:
    """Everything `query` touches, in four groups of at most `limit` rows each.

    A query too short to mean anything comes back as four empty groups rather than an
    error: the box searches as it is typed, and the first letter is not a mistake.
    """
    text = query.strip()
    if len(text) < MIN_QUERY or limit <= 0:
        return {"games": [], "opponents": [], "openings": [], "notes": []}

    found = games_service.search_games(session, GameFilters(text=text), limit=limit)
    return {
        "games": [games_service.game_summary(game) for game in found],
        "opponents": search_opponents(session, text, limit=limit),
        "openings": search_openings(session, text, limit=limit),
        "notes": [
            notes_service.note_payload(note)
            for note in notes_service.search_notes(session, query=text, limit=limit)
        ],
    }


def search_opponents(session: Session, text: str, *, limit: int = 5) -> list[dict[str, Any]]:
    """Opponents whose name contains `text`, most played first, with how I did.

    Only games the owner played in: a game that is nobody's has no other side of the
    board, and no score to report. `score` is those games as a percentage — a win is a
    point, a draw is half of one — so 50 is an even head-to-head record.
    """
    name = _opponent_name()
    points = case((outcome_condition(WIN), 1.0), (outcome_condition(DRAW), 0.5), else_=0.0)
    played = func.count(Game.id)
    statement = (
        select(name.label("name"), played, func.sum(points))
        .where(Game.owner_color.is_not(None), _contains(name, text))
        .group_by(name)
        .order_by(played.desc(), name)
        .limit(limit)
    )
    return [
        {
            "name": opponent,
            "games": int(games),
            "score": round(float(scored or 0.0) / int(games) * 100, 1),
        }
        for opponent, games, scored in session.execute(statement)
        if games
    ]


def search_openings(session: Session, text: str, *, limit: int = 5) -> list[dict[str, Any]]:
    """Openings whose name contains `text` or whose ECO starts with it, most played first.

    Both halves of the same question: "sicilian" is how the owner names an opening and
    "B9" is how the database does, and the box should not care which one was typed.
    """
    played = func.count(Game.id)
    statement = (
        select(Game.eco, Game.opening_name, played)
        .where(or_(_contains(Game.opening_name, text), _starts_with(Game.eco, text)))
        .group_by(Game.eco, Game.opening_name)
        .order_by(played.desc(), Game.opening_name, Game.eco)
        .limit(limit)
    )
    return [
        {"eco": eco or "", "name": opening or "", "games": int(games)}
        for eco, opening, games in session.execute(statement)
    ]


def _opponent_name() -> ColumnElement[str | None]:
    """Whoever was on the other side of the board, as one column to group by."""
    return case(
        (Game.owner_color == Color.WHITE, Game.black_name),
        (Game.owner_color == Color.BLACK, Game.white_name),
    )


def _contains(column: ColumnElement[str | None], value: str) -> ColumnElement[bool]:
    return column.ilike(f"%{_escape_like(value)}%", escape="\\")


def _starts_with(column: ColumnElement[str | None], value: str) -> ColumnElement[bool]:
    return column.ilike(f"{_escape_like(value)}%", escape="\\")


def _escape_like(value: str) -> str:
    return value.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

"""The coach's memory: notes, the variations they hang off, and getting both back out.

Three things live here, and they are one module because they are one feature. A **note** is
free text plus tags with up to three anchors (a game, a position, a variation); a **line**
is a variation off a stored game, which exists so that a note about one has something
durable to point at; and the **export** turns either into Markdown or PGN, which is how the
memory leaves this program for a coach, a printout or another tool.

The rules worth knowing before reading the code:

* `ply` is a half-move *count*, never a move index: `ply == 0` is the starting position and
  `ply == n` is the position after n half-moves. On a line it is on the same scale as the
  line's `base_ply`, so `base_ply + k` is the position k moves into the variation. One
  scale for both is what lets the UI jump to a note without asking which kind it is.
* A line is stored once per branch point, longest wins — `save_line` folds a line that is
  the head of a stored one into it, the same rule the move list applies to the variations
  it keeps for the session.
* Free-text search goes through FTS5 where the SQLite has it and falls back to a scan where
  it does not; tags are always matched in Python (see `SCAN_LIMIT`).
* Every write announces itself on the `/events` stream after the commit, never before.
"""

from __future__ import annotations

import io
import re
from collections.abc import Iterable, Sequence
from datetime import datetime
from typing import TYPE_CHECKING, Any
from weakref import WeakKeyDictionary

from sqlalchemy import ColumnElement, case, func, select, text
from sqlalchemy.exc import DatabaseError
from sqlalchemy.orm import Session

from backend.db.enums import NoteSource
from backend.db.fts import NOTES_FTS, notes_fts_exists
from backend.db.models import Game, GamePosition, Line, Note, Position
from backend.db.types import utcnow
from backend.services import events as events_service
from backend.services.explorer import find_position, get_or_create_position, normalize_fen

if TYPE_CHECKING:  # pragma: no cover - typing only
    import chess

# A tag is matched after the row is read rather than in SQL: `notes.tags` is a plain JSON
# column, and searching inside one means a full scan through SQLite's JSON functions
# either way. Coach memory is small; this is the cheap half of the trade.
SCAN_LIMIT = 5000

# A note the coach writes has to show up in the open UI without a refresh, so both of the
# writes announce themselves on the `/events` stream. Emitted after the commit, never
# before: a note that was rolled back was never written.
EVENT_NOTE_CREATED = "note.created"
EVENT_NOTE_UPDATED = "note.updated"
EVENT_NOTE_DELETED = "note.deleted"
EVENT_LINE_CREATED = "line.created"
EVENT_LINE_DELETED = "line.deleted"

# What "worth re-reading" means. A position note whose position turned up in a game
# imported inside the window is news; any note nobody has touched in three weeks is a
# reminder. Both are deliberately generous — this is a nudge, not a queue.

# The scopes a listing can be narrowed to, by which anchors a note carries.
SCOPES = ("game", "position", "line", "free")

# One export format's media type and the name the browser saves it under.
EXPORT_FORMATS: dict[str, tuple[str, str]] = {
    "md": ("text/markdown; charset=utf-8", "blunderbase-notes.md"),
    "pgn": ("application/x-chess-pgn; charset=utf-8", "blunderbase-notes.pgn"),
}

# A word as FTS5 tokenizes one. Anything else in a query — punctuation, a stray quote — is
# a separator, which is also what keeps a query from being an FTS expression injection.
_WORD = re.compile(r"\w+", re.UNICODE)

# Whether a given database carries the notes index, asked once per Engine. Weak keys so a
# test's throwaway engine does not keep an entry alive after it is disposed.
_FTS_READY: WeakKeyDictionary[Any, bool] = WeakKeyDictionary()


class NoteNotFoundError(LookupError):
    """No note with that id."""


class LineNotFoundError(LookupError):
    """No line with that id."""


class UnknownGameError(LookupError):
    """No game to hang the line or the note off."""


# --- lines -----------------------------------------------------------------


def save_line(session: Session, game_id: int, base_ply: int, moves: Sequence[str]) -> Line:
    """Persist a variation off a game, folding it into an overlapping one.

    Two lines off the same position where one is the head of the other are one line walked
    twice: a line already covered by a stored one returns that one untouched, and one that
    continues a stored line extends it where it stands. Anything else is a new line.

    The moves are replayed against the game before anything is written, so a line that
    could not have been played is a `ValueError` rather than a row nothing can render.
    """
    game = session.get(Game, int(game_id))
    if game is None:
        raise UnknownGameError(f"no game with id {game_id}")

    wanted = _clean_moves(moves)
    if not wanted:
        raise ValueError("a line needs at least one move")
    base = int(base_ply)
    if base < 0 or base > game.ply_count:
        raise ValueError(f"base_ply {base} is outside game {game.id}")
    # Raises on an illegal continuation, which is the whole reason it runs here.
    _replay(_board_at(game, base), wanted)

    stored = list(
        session.scalars(
            select(Line).where(Line.game_id == game.id, Line.base_ply == base).order_by(Line.id)
        )
    )
    for line in stored:
        if _is_prefix(wanted, list(line.moves or ())):
            return line
    for line in stored:
        if _is_prefix(list(line.moves or ()), wanted):
            line.moves = wanted
            line.updated_at = utcnow()
            session.commit()
            _announce_line(session, EVENT_LINE_CREATED, line)
            return line

    line = Line(game_id=game.id, base_ply=base, moves=wanted)
    session.add(line)
    session.commit()
    _announce_line(session, EVENT_LINE_CREATED, line)
    return line


def get_line(session: Session, line_id: int) -> Line | None:
    """One line."""
    return session.get(Line, int(line_id))


def get_lines(session: Session, game_id: int) -> list[Line]:
    """Every stored variation off a game, in the order they branch."""
    return list(
        session.scalars(
            select(Line).where(Line.game_id == int(game_id)).order_by(Line.base_ply, Line.id)
        )
    )


def delete_line(session: Session, line_id: int) -> bool:
    """Unpin a line. Its notes survive with `line_id` cleared — see the model."""
    line = session.get(Line, int(line_id))
    if line is None:
        return False
    payload = line_payload(session, line)
    session.delete(line)
    session.commit()
    events_service.emit(
        {"event": EVENT_LINE_DELETED, "line_id": payload["id"], "game_id": payload["game_id"]}
    )
    return True


def line_payload(session: Session, line: Line, *, with_notes: bool = False) -> dict[str, Any]:
    """One line as an API response: the moves in UCI, and the same line in SAN."""
    payload: dict[str, Any] = {
        "id": line.id,
        "game_id": line.game_id,
        "base_ply": line.base_ply,
        "moves": list(line.moves or ()),
        "sans": line_sans(line),
        "created_at": line.created_at.isoformat(),
        "updated_at": line.updated_at.isoformat(),
    }
    if with_notes:
        notes = sorted(line.notes, key=lambda note: (note.ply is None, note.ply or 0, note.id))
        payload["notes"] = note_payloads(session, notes)
    return payload


def line_sans(line: Line) -> list[str]:
    """The line in SAN, derived rather than stored, so it cannot disagree with the game.

    Lenient on purpose: a line whose game was re-imported with different moves renders as
    far as it still replays instead of failing the whole payload.
    """
    game = line.game
    if game is None:
        return []
    board = _board_at(game, line.base_ply)
    sans: list[str] = []
    for uci in line.moves or ():
        try:
            move = board.parse_uci(uci)
        except ValueError:
            break
        sans.append(board.san(move))
        board.push(move)
    return sans


# --- notes -----------------------------------------------------------------


def save_note(
    session: Session,
    text_body: str,
    tags: Sequence[str] = (),
    *,
    game_id: int | None = None,
    fen: str | None = None,
    ply: int | None = None,
    line_id: int | None = None,
    line: dict[str, Any] | None = None,
    source: NoteSource | str = NoteSource.WEB,
    from_live: bool = False,
) -> Note:
    """Write a coach note, against as much of a position as the caller could name.

    Every anchor is optional and they compose. `fen` is resolved to a Position — one is
    created if no game ever reached it, because a note about a position is worth keeping
    before the owner has played it and the row is what a later import joins onto. `line`
    (`{game_id, base_ply, moves}`) is persisted through `save_line` first: a note on a
    variation always pins it, since a note pointing at a line nobody kept would be a note
    about nothing.

    `from_live` snapshots the board the coach and the owner are looking at: the FEN, the
    game it is following, and the moves played beyond it as a line. It fills in only what
    the caller did not name.
    """
    body = text_body.strip()
    if not body:
        raise ValueError("a note needs text")

    kind = NoteSource(source)
    if from_live:
        game_id, fen, ply, line, kind = _from_live(game_id, fen, ply, line)

    stored_line: Line | None = None
    if line is not None:
        stored_line = save_line(
            session,
            int(line["game_id"]),
            int(line.get("base_ply") or 0),
            line.get("moves") or (),
        )
    elif line_id is not None:
        stored_line = session.get(Line, int(line_id))
        if stored_line is None:
            raise LineNotFoundError(f"no line with id {line_id}")

    if stored_line is not None:
        game_id = game_id if game_id is not None else stored_line.game_id
        ply = _line_ply(stored_line, ply)
    elif game_id is not None and ply is not None:
        game = session.get(Game, int(game_id))
        if game is None:
            raise UnknownGameError(f"no game with id {game_id}")
        if int(ply) < 0 or int(ply) > game.ply_count:
            raise ValueError(f"ply {ply} is outside game {game.id}")
        ply = int(ply)

    position_id = None
    if fen:
        position_id = get_or_create_position(session, fen).id
    elif ply is not None:
        anchor = _fen_at(session, stored_line, game_id, ply)
        if anchor is not None:
            position_id = get_or_create_position(session, anchor).id

    note = Note(
        text=body,
        tags=normalize_tags(tags),
        game_id=game_id,
        position_id=position_id,
        line_id=stored_line.id if stored_line is not None else None,
        ply=ply,
        source=kind,
    )
    session.add(note)
    session.commit()
    _announce(session, EVENT_NOTE_CREATED, note)
    return note


def get_note(session: Session, note_id: int) -> Note | None:
    """One note."""
    return session.get(Note, note_id)


def latest_note_by_fen(session: Session, fens: Iterable[str]) -> dict[str, Note]:
    """The newest note on each of a batch of positions, keyed by the FEN it was asked for.

    One query for the whole batch rather than one per position: the caller is the explorer
    annotating a page of twenty continuations at once, and a lookup per row would be twenty
    round trips over one small table.

    Which notes belong to a position is the same rule `search_notes(fen=…)` applies — the
    note's `position_id`, newest by `(created_at, id)` — because the move table and the
    notes card show the same position and must never name different notes for it. A FEN
    nobody has written about, one no `Position` row exists for, and one that is not a
    position at all are all simply absent from the answer.
    """
    epds: dict[str, str] = {}
    for fen in fens:
        if fen in epds:
            continue
        try:
            epds[fen] = normalize_fen(fen)[0]
        except ValueError:
            continue
    if not epds:
        return {}

    ids = {
        epd: position_id
        for position_id, epd in session.execute(
            select(Position.id, Position.fen).where(Position.fen.in_(set(epds.values())))
        )
    }
    if not ids:
        return {}

    newest: dict[int, Note] = {}
    statement = (
        select(Note)
        .where(Note.position_id.in_(ids.values()))
        .order_by(Note.created_at.desc(), Note.id.desc())
    )
    for note in session.scalars(statement):
        newest.setdefault(note.position_id, note)

    found: dict[str, Note] = {}
    for fen, epd in epds.items():
        position_id = ids.get(epd)
        note = newest.get(position_id) if position_id is not None else None
        if note is not None:
            found[fen] = note
    return found


def search_notes(
    session: Session,
    *,
    query: str | None = None,
    tags: Sequence[str] = (),
    since: datetime | None = None,
    until: datetime | None = None,
    game_id: int | None = None,
    fen: str | None = None,
    scope: str | None = None,
    line_id: int | None = None,
    has_position: bool | None = None,
    limit: int = 50,
) -> list[Note]:
    """Notes matching any combination of text, tags, date, game, position and scope.

    Newest first. Tags are AND-ed: asking for `["opening", "sicilian"]` means notes
    carrying both, which is what makes tags worth writing. `scope` narrows by which
    anchors a note has rather than by their values — see `SCOPES`.
    """
    conditions: list[ColumnElement[bool]] = []
    if query:
        conditions.append(_matches_text(session, query))
    if since is not None:
        conditions.append(Note.created_at >= since)
    if until is not None:
        conditions.append(Note.created_at <= until)
    if game_id is not None:
        conditions.append(Note.game_id == game_id)
    if line_id is not None:
        conditions.append(Note.line_id == line_id)
    if has_position is not None:
        conditions.append(
            Note.position_id.is_not(None) if has_position else Note.position_id.is_(None)
        )
    if scope:
        conditions.append(_scope_condition(scope))
    if fen:
        position = find_position(session, fen)
        if position is None:
            return []
        conditions.append(Note.position_id == position.id)

    statement = (
        select(Note)
        .where(*conditions)
        .order_by(Note.created_at.desc(), Note.id.desc())
        .limit(SCAN_LIMIT)
    )

    wanted = normalize_tags(tags)
    folded = {tag.casefold() for tag in wanted}
    found: list[Note] = []
    for note in session.scalars(statement):
        if folded and not folded <= {tag.casefold() for tag in note.tags or ()}:
            continue
        found.append(note)
        if limit and len(found) >= limit:
            break
    return found


def delete_note(session: Session, note_id: int) -> bool:
    """Remove a note. Returns whether there was one to remove."""
    note = session.get(Note, note_id)
    if note is None:
        return False
    gone = {"note_id": note.id, "game_id": note.game_id, "line_id": note.line_id}
    session.delete(note)
    session.commit()
    events_service.emit({"event": EVENT_NOTE_DELETED, **gone})
    return True


def update_note(
    session: Session,
    note_id: int,
    *,
    text: str | None = None,
    tags: Sequence[str] | None = None,
) -> Note:
    """Rewrite a note's text or tags. `updated_at` moves; `created_at` does not."""
    note = session.get(Note, note_id)
    if note is None:
        raise NoteNotFoundError(f"no note with id {note_id}")
    if text is not None:
        body = text.strip()
        if not body:
            raise ValueError("a note needs text")
        note.text = body
    if tags is not None:
        note.tags = normalize_tags(tags)
    session.commit()
    _announce(session, EVENT_NOTE_UPDATED, note)
    return note


def list_tags(session: Session) -> list[dict[str, Any]]:
    """Every tag in use with how often, so a new session can see what it wrote about."""
    counts: dict[str, int] = {}
    for (stored,) in session.execute(select(Note.tags)):
        for tag in stored or ():
            counts[tag] = counts.get(tag, 0) + 1
    return [
        {"tag": tag, "notes": count}
        for tag, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    ]


def normalize_tags(tags: Sequence[str]) -> list[str]:
    """Trimmed, de-duplicated, in the order they were given. Case is the writer's."""
    cleaned: list[str] = []
    seen: set[str] = set()
    for tag in tags or ():
        trimmed = str(tag).strip()
        folded = trimmed.casefold()
        if not trimmed or folded in seen:
            continue
        seen.add(folded)
        cleaned.append(trimmed)
    return cleaned


# --- export ----------------------------------------------------------------


def export_notes(session: Session, notes: Sequence[Note], *, fmt: str = "md") -> str:
    """A batch of notes as a document. `fmt` is a key of `EXPORT_FORMATS`."""
    if fmt not in EXPORT_FORMATS:
        raise ValueError(f"unknown export format {fmt!r}; expected one of {sorted(EXPORT_FORMATS)}")
    return export_markdown(session, notes) if fmt == "md" else export_pgn(session, notes)


def export_library_pgn(session: Session) -> str:
    """Every stored game and portable annotation as one PGN document.

    The game's stored PGN is the base, so source headers, clocks, comments and imported
    variations survive. Blunderbase notes and saved lines are then added the same way the
    notes-only export adds them. Position-only and free notes are appended as synthetic
    games because otherwise a whole-library export would silently leave them behind.
    """
    games = list(session.scalars(select(Game).order_by(Game.played_at, Game.id)))
    found = list(session.scalars(select(Note).order_by(Note.id)))
    kept = list(session.scalars(select(Line).order_by(Line.game_id, Line.base_ply, Line.id)))
    by_game, positions, free = _grouped(found)
    annotations = {game.id: rows for game, rows in by_game}
    lines: dict[int, list[Line]] = {}
    for line in kept:
        lines.setdefault(line.game_id, []).append(line)

    exported = [
        _pgn_for_library_game(
            session, game, annotations.get(game.id, ()), lines=lines.get(game.id, ())
        )
        for game in games
    ]
    exported.extend(_pgn_for_position(note) for note in positions)
    if free:
        exported.append(_pgn_for_free_notes(free))
    return _write_pgn(exported)


def export_markdown(session: Session, notes: Sequence[Note]) -> str:
    """Notes as Markdown: one section per game, then loose positions, then free notes.

    Written to be read by a person and by a chat model, which is the same document: the
    move each note is about is spelled in SAN, the variation under it is spelled as a line
    of SAN, and every game heading carries the app path that opens it.
    """
    by_game, positions, free = _grouped(notes)
    out: list[str] = ["# Blunderbase notes", ""]
    out.append(f"_{len(notes)} note{'s' if len(notes) != 1 else ''}, exported {_day(utcnow())}_")
    out.append("")

    for game, rows in by_game:
        out.append(f"## {game.white_name} – {game.black_name}, {game.result}{_played(game)}")
        out.append("")
        out.append(f"[/games/{game.id}](/games/{game.id})")
        out.append("")
        for note in rows:
            out.extend(_markdown_note(note, game))
        out.append("")

    if positions:
        out.extend(["## Positions", ""])
        for note in positions:
            out.append(f"- {note.text}{_markdown_meta(note)}")
            if note.position is not None:
                out.append(f"  - `{note.position.fen}`")
        out.append("")

    if free:
        out.extend(["## Free notes", ""])
        for note in free:
            out.append(f"- {note.text}{_markdown_meta(note)}")
        out.append("")

    return "\n".join(out).rstrip() + "\n"


def export_pgn(session: Session, notes: Sequence[Note]) -> str:
    """Notes as PGN, so the memory opens in any board program.

    A note on a game is a comment at its ply; a note on a line is a comment inside that
    line, written as a real PGN variation. A note that only knows a position becomes a
    one-position game with `[SetUp "1"]` and the note as its comment, and a note anchored
    to nothing at all is a headerless game carrying only the comment — losing it on the way
    out would make an export a lossy backup, which is the one thing it must not be.
    """
    by_game, positions, free = _grouped(notes)
    games: list[chess.pgn.Game] = []

    for game, rows in by_game:
        games.append(_pgn_for_game(session, game, rows))
    for note in positions:
        games.append(_pgn_for_position(note))
    if free:
        games.append(_pgn_for_free_notes(free))
    return _write_pgn(games)


# --- payloads --------------------------------------------------------------


def note_payload(session: Session, note: Note) -> dict[str, Any]:
    """One note as an API response or an MCP tool result.

    Carries the anchors resolved rather than only their ids: the FEN of the position, a
    small summary of the game and the whole line, because every surface that renders a note
    needs all three and none of them should have to make three more calls for them.

    Two of them are what makes a position note readable away from where it was written.
    `move` is the move it was written on, so a note that surfaces at a position the owner
    reached some other way can still name its origin; `position_games` and
    `position_reference_games` are how many games in the library pass through the position,
    which is the count behind the way back to the explorer.
    """
    return _payload(session, note, reach_by_position(session, [note.position_id]))


def note_payloads(session: Session, notes: Sequence[Note]) -> list[dict[str, Any]]:
    """A page of notes, with the reach of every position counted in one query rather than
    one per note — this is what a list endpoint calls."""
    reach = reach_by_position(session, [note.position_id for note in notes])
    return [_payload(session, note, reach) for note in notes]


def reach_by_position(
    session: Session, position_ids: Iterable[int | None]
) -> dict[int, dict[str, int]]:
    """How many games pass through each of a batch of positions, keyed by position id.

    Two counts rather than one, because they mean different things to a note. `games` is the
    games the owner played a side of — exactly the ones the opening explorer counts for a
    position, so the number and the screen the button opens agree — and `reference_games` is
    everything else through it: a model game added from the reference books, or one whose
    side has not been worked out yet. Both are `db.models.Game`'s own distinction.

    Counted over distinct games: a position repeated in one game is one game, not two.
    """
    wanted = {int(value) for value in position_ids if value is not None}
    if not wanted:
        return {}

    seen = (
        select(
            GamePosition.position_id.label("position_id"),
            GamePosition.game_id.label("game_id"),
            Game.owner_color.label("owner_color"),
        )
        .join(Game, Game.id == GamePosition.game_id)
        .where(GamePosition.position_id.in_(wanted))
        .distinct()
        .subquery()
    )
    owned = case((seen.c.owner_color.is_not(None), 1), else_=0)
    rows = session.execute(
        select(
            seen.c.position_id,
            func.coalesce(func.sum(owned), 0),
            func.coalesce(func.sum(1 - owned), 0),
        ).group_by(seen.c.position_id)
    )
    return {
        int(position_id): {"games": int(games), "reference_games": int(reference)}
        for position_id, games, reference in rows
    }


def game_brief(game: Game) -> dict[str, Any]:
    """Just enough of a game to label a note with it.

    `is_owner_game` rides along because a note written on a model game reads differently
    from one written on the owner's own — see `db.models.Game`.
    """
    return {
        "id": game.id,
        "white": game.white_name,
        "black": game.black_name,
        "result": str(game.result),
        "date": _day(game.played_at) if game.played_at is not None else None,
        "is_owner_game": game.is_owner_game,
    }


def note_move(note: Note) -> dict[str, Any] | None:
    """The move a note was written on, spelled the way a person writes it.

    A note on a variation is labelled by the variation's own move rather than by whatever
    the game played at that ply — the ply is shared, the move is not, which is the rule the
    Markdown export applies too. None where there is no move to name: a note on the starting
    position, on a game as a whole, or on a position no game of the owner's ever reached.
    """
    line = note.line
    if line is not None:
        return _line_move(line.base_ply, line_sans(line), note.ply)
    if note.game is None:
        return None
    return move_context(note.game, note.ply)


def move_context(game: Game, ply: int | None) -> dict[str, Any] | None:
    """The move that reached `ply`, as the label a note is filed under.

    None at ply 0 and past the end of the game: there is no move to name, and a note there
    is about the position rather than about a move.
    """
    if ply is None or ply <= 0:
        return None
    index = int(ply) - 1
    sans = game.moves_san or []
    if index >= len(sans):
        return None
    return _move_label(int(ply), sans[index])


# --- internals -------------------------------------------------------------


def _payload(session: Session, note: Note, reach: dict[int, dict[str, int]]) -> dict[str, Any]:
    """The note payload proper, over reach counts somebody else has already fetched."""
    line = note.line
    through = reach.get(note.position_id) if note.position_id is not None else None
    return {
        "id": note.id,
        "text": note.text,
        "tags": list(note.tags or ()),
        "game_id": note.game_id,
        "position_id": note.position_id,
        "line_id": note.line_id,
        "ply": note.ply,
        "source": str(note.source),
        "fen": note.position.fen if note.position is not None else None,
        "move": note_move(note),
        "line": line_payload(session, line) if line is not None else None,
        "game": game_brief(note.game) if note.game is not None else None,
        "position_games": through["games"] if through else 0,
        "position_reference_games": through["reference_games"] if through else 0,
        "created_at": note.created_at.isoformat(),
        "updated_at": note.updated_at.isoformat(),
    }


def _move_label(ply: int, san: str, *, on_line: bool = False) -> dict[str, Any]:
    """One half-move as a label. `ply` is the count *after* it, so the move is at `ply - 1`."""
    index = int(ply) - 1
    number = index // 2 + 1
    white = index % 2 == 0
    return {
        "ply": int(ply),
        "move_number": number,
        "color": "white" if white else "black",
        "san": san,
        "label": f"{number}. {san}" if white else f"{number}... {san}",
        "on_line": on_line,
    }


def _from_live(
    game_id: int | None,
    fen: str | None,
    ply: int | None,
    line: dict[str, Any] | None,
) -> tuple[int | None, str | None, int | None, dict[str, Any] | None, NoteSource]:
    """The live board as a note's anchors. Read-only, and fills only what is missing."""
    # Imported here rather than at the top: the live board reads games, and a note is
    # written from far more places than the one that is watching one.
    from backend.services import live as live_service

    state = live_service.get_state()
    if not state.get("active"):
        raise live_service.NoLivePositionError("there is nothing on the live board")

    board_ply = state.get("ply")
    moves = list(state.get("moves") or ())
    if fen is None and game_id is None:
        fen = state.get("fen")
        game_id = state.get("game_id")
    if line is None and moves and game_id is not None and board_ply is not None:
        line = {"game_id": game_id, "base_ply": int(board_ply), "moves": moves}
    if ply is None and board_ply is not None:
        ply = int(board_ply) + len(moves)
    return game_id, fen, ply, line, NoteSource.LIVE


def _line_ply(line: Line, ply: int | None) -> int:
    """A note's ply on a line, defaulting to its tip and clamped to the line."""
    span = len(line.moves or ())
    if ply is None:
        return line.base_ply + span
    value = int(ply)
    if value < line.base_ply or value > line.base_ply + span:
        raise ValueError(
            f"ply {value} is outside line {line.id}, which covers "
            f"{line.base_ply}..{line.base_ply + span}"
        )
    return value


def _fen_at(session: Session, line: Line | None, game_id: int | None, ply: int) -> str | None:
    """The position a note is about, so a mainline or line note is found like a FEN one."""
    if line is not None:
        board = _board_at(line.game, line.base_ply)
        try:
            _replay(board, list(line.moves or ())[: ply - line.base_ply])
        except ValueError:
            return None
        return board.epd()
    if game_id is None:
        return None
    return session.scalar(
        select(Position.fen)
        .join(GamePosition, GamePosition.position_id == Position.id)
        .where(GamePosition.game_id == game_id, GamePosition.ply == ply)
    )


def _scope_condition(scope: str) -> ColumnElement[bool]:
    """A scope name as the shape of anchors it means."""
    name = str(scope).strip().casefold()
    if name == "line":
        return Note.line_id.is_not(None)
    if name == "game":
        return Note.game_id.is_not(None) & Note.line_id.is_(None)
    if name == "position":
        return Note.position_id.is_not(None) & Note.game_id.is_(None) & Note.line_id.is_(None)
    if name == "free":
        return Note.game_id.is_(None) & Note.line_id.is_(None) & Note.position_id.is_(None)
    raise ValueError(f"unknown scope {scope!r}; expected one of {', '.join(SCOPES)}")


def _matches_text(session: Session, query: str) -> ColumnElement[bool]:
    """Free text as a condition: the FTS index where there is one, a scan where there isn't."""
    expression = _fts_query(query)
    if expression is not None and _fts_ready(session):
        try:
            rows = session.execute(
                text(f"SELECT rowid FROM {NOTES_FTS} WHERE {NOTES_FTS} MATCH :q"),
                {"q": expression},
            ).scalars()
            return Note.id.in_(list(rows))
        except DatabaseError:
            # An index that answers with an error is an index this process stops trusting.
            session.rollback()
            _FTS_READY[session.get_bind()] = False
    return _contains(Note.text, query)


def _fts_query(query: str) -> str | None:
    """A person's words as an FTS5 MATCH expression, last word taken as a prefix.

    Every token is quoted, which is what makes an apostrophe or a stray `AND` a word to
    look for rather than syntax to obey.
    """
    words = _WORD.findall(query or "")
    if not words:
        return None
    quoted = [f'"{word}"' for word in words[:-1]]
    quoted.append(f'"{words[-1]}"*')
    return " ".join(quoted)


def _fts_ready(session: Session) -> bool:
    """Whether this database has the notes index. Asked once per Engine, then remembered."""
    bind = session.get_bind()
    cached = _FTS_READY.get(bind)
    if cached is not None:
        return cached
    try:
        ready = notes_fts_exists(session.connection())
    except DatabaseError:
        ready = False
    _FTS_READY[bind] = ready
    return ready


def _grouped(
    notes: Sequence[Note],
) -> tuple[list[tuple[Game, list[Note]]], list[Note], list[Note]]:
    """An export's notes as its sections: per game, loose positions, then free ones."""
    games: dict[int, tuple[Game, list[Note]]] = {}
    positions: list[Note] = []
    free: list[Note] = []
    for note in notes:
        game = note.game
        if game is not None:
            games.setdefault(game.id, (game, []))[1].append(note)
        elif note.position_id is not None:
            positions.append(note)
        else:
            free.append(note)

    ordered = sorted(games.values(), key=lambda entry: _sort_key(entry[0]))
    for _game, rows in ordered:
        rows.sort(key=lambda note: (note.ply is None, note.ply or 0, note.id))
    return ordered, positions, free


def _sort_key(game: Game) -> tuple[int, datetime | int]:
    return (0, game.played_at) if game.played_at is not None else (1, game.id)


def _markdown_note(note: Note, game: Game) -> list[str]:
    """One note under a game heading: its move, its text, its line, its metadata.

    A note on a variation is labelled by the variation's own move rather than by whatever
    the game happened to play at that ply — the ply is shared, the move is not.
    """
    line = note.line
    sans = line_sans(line) if line is not None else []
    if line is not None and sans:
        label = _line_label(line.base_ply, sans, note.ply)
    else:
        context = move_context(game, note.ply)
        label = context["label"] if context is not None else None
    head = f"**{label}** — " if label else ""
    rows = [f"- {head}{note.text}{_markdown_meta(note)}"]
    if sans and line is not None:
        rows.append(f"  - line: {_san_line(line.base_ply, sans)}")
    return rows


def _line_move(base_ply: int, sans: Sequence[str], ply: int | None) -> dict[str, Any] | None:
    """The move inside a variation a note is filed under, defaulting to the line's tip."""
    offset = (ply if ply is not None else base_ply + len(sans)) - base_ply
    if offset <= 0 or offset > len(sans):
        return None
    return _move_label(base_ply + offset, sans[offset - 1], on_line=True)


def _line_label(base_ply: int, sans: Sequence[str], ply: int | None) -> str | None:
    """The same move, spelled the way a person writes it — what the Markdown export prints."""
    move = _line_move(base_ply, sans, ply)
    return move["label"] if move is not None else None


def _markdown_meta(note: Note) -> str:
    """The trailing "tags · date" a note carries wherever it is rendered."""
    parts = []
    if note.tags:
        parts.append(" ".join(f"#{tag}" for tag in note.tags))
    parts.append(_day(note.created_at))
    return "  _(" + " · ".join(parts) + ")_"


def _san_line(base_ply: int, sans: Sequence[str]) -> str:
    """A variation as it is written down: "12... Nc6 13. Bb5 a6"."""
    out: list[str] = []
    for offset, san in enumerate(sans):
        index = base_ply + offset
        number = index // 2 + 1
        if index % 2 == 0:
            out.append(f"{number}. {san}")
        elif offset == 0:
            out.append(f"{number}... {san}")
        else:
            out.append(san)
    return " ".join(out)


def _pgn_for_game(
    session: Session,
    game: Game,
    notes: Sequence[Note],
    *,
    lines: Sequence[Line] | None = None,
) -> Any:
    """One stored game with its notes as comments and its lines as variations."""
    import chess.pgn

    pgn_game = chess.pgn.Game()
    pgn_game.setup(_board_at(game, 0))
    pgn_game.headers["Event"] = "Blunderbase notes"
    pgn_game.headers["Site"] = f"/games/{game.id}"
    played = _day(game.played_at).replace("-", ".") if game.played_at is not None else None
    pgn_game.headers["Date"] = played or "????.??.??"
    pgn_game.headers["White"] = game.white_name
    pgn_game.headers["Black"] = game.black_name
    pgn_game.headers["Result"] = str(game.result)
    if game.eco:
        pgn_game.headers["ECO"] = game.eco
    if game.opening_name:
        pgn_game.headers["Opening"] = game.opening_name

    node: Any = pgn_game
    for uci in game.moves_uci or ():
        try:
            move = node.board().parse_uci(uci)
        except ValueError:
            break
        node = node.add_main_variation(move)
    return _annotate_pgn(session, game, notes, pgn_game, lines=lines)


def _pgn_for_library_game(
    session: Session, game: Game, notes: Sequence[Note], *, lines: Sequence[Line]
) -> Any:
    """A stored PGN with Blunderbase's annotations layered onto it.

    Old or hand-built databases can contain a PGN python-chess cannot read even though
    their normalized move lists are usable. Those fall back to the reconstruction used by
    the notes export, so one malformed source document cannot abort a library download.
    """
    import chess.pgn

    try:
        parsed = chess.pgn.read_game(io.StringIO(game.pgn))
    except Exception:
        parsed = None
    if parsed is None or parsed.errors:
        return _pgn_for_game(session, game, notes, lines=lines)
    return _annotate_pgn(session, game, notes, parsed, lines=lines)


def _annotate_pgn(
    session: Session,
    game: Game,
    notes: Sequence[Note],
    pgn_game: Any,
    *,
    lines: Sequence[Line] | None = None,
) -> Any:
    """Add notes and kept variations to a PGN whose main line is the stored game."""
    nodes = [pgn_game, *pgn_game.mainline()]

    on_lines: dict[int, list[Note]] = {}
    for note in notes:
        if note.line_id is not None:
            on_lines.setdefault(note.line_id, []).append(note)
            continue
        target = nodes[note.ply] if note.ply is not None and note.ply < len(nodes) else pgn_game
        target.comment = _joined(target.comment, _pgn_comment(note))

    for line in lines if lines is not None else get_lines(session, game.id):
        if line.base_ply >= len(nodes):
            continue
        branch: Any = nodes[line.base_ply]
        variation_nodes = [branch]
        for uci in line.moves or ():
            try:
                move = branch.board().parse_uci(uci)
            except ValueError:
                break
            branch = branch.add_variation(move)
            variation_nodes.append(branch)
        for note in on_lines.get(line.id, ()):
            offset = (note.ply or line.base_ply) - line.base_ply
            inside = 0 <= offset < len(variation_nodes)
            target = variation_nodes[offset] if inside else variation_nodes[-1]
            target.comment = _joined(target.comment, _pgn_comment(note))
    return pgn_game


def _pgn_for_free_notes(notes: Sequence[Note]) -> Any:
    """Unanchored notes as a PGN entry, so a library export never drops them."""
    import chess.pgn

    loose = chess.pgn.Game()
    loose.headers["Event"] = "Blunderbase notes"
    loose.headers["White"] = "?"
    loose.headers["Black"] = "?"
    loose.headers["Result"] = "*"
    loose.comment = "  ".join(_pgn_comment(note) for note in notes)
    return loose


def _write_pgn(games: Sequence[Any]) -> str:
    """Write independent games without reusing the exporter's accumulating state."""
    import chess.pgn

    def written(game: Any) -> str:
        exporter = chess.pgn.StringExporter(headers=True, variations=True, comments=True)
        return game.accept(exporter)

    if not games:
        return ""
    return "\n\n".join(written(game) for game in games).rstrip() + "\n"


def _pgn_for_position(note: Note) -> Any:
    """A position note as a PGN game that is only its position and the note."""
    import chess
    import chess.pgn

    game = chess.pgn.Game()
    game.headers["Event"] = "Blunderbase notes"
    game.headers["White"] = "?"
    game.headers["Black"] = "?"
    game.headers["Result"] = "*"
    if note.position is not None:
        game.setup(_board_from(note.position.fen))
    game.comment = _pgn_comment(note)
    return game


def _pgn_comment(note: Note) -> str:
    """A note as PGN comment text. Braces are the one character a comment cannot carry."""
    tags = f" [{', '.join(note.tags)}]" if note.tags else ""
    body = note.text.replace("{", "(").replace("}", ")")
    return f"{body}{tags}"


def _joined(existing: str, addition: str) -> str:
    return f"{existing}  {addition}" if existing else addition


def _board_from(fen: str) -> chess.Board:
    """A stored FEN as a board, only calling it chess960 when standard rules refuse it."""
    import chess

    board = chess.Board()
    try:
        board.set_fen(fen)
    except ValueError:
        board = chess.Board(chess960=True)
        try:
            board.set_fen(fen)
        except ValueError:
            return chess.Board()
    return board


def _board_at(game: Game, ply: int) -> chess.Board:
    """The game's position after `ply` half-moves, replayed from where it started."""
    import chess

    from backend.services.import_service import CHESS960_VARIANTS

    rows = list(game.positions or ())
    initial = rows[0].position.fen if rows and rows[0].ply == 0 else None
    chess960 = (game.variant or "").lower() in CHESS960_VARIANTS
    board = chess.Board(initial, chess960=chess960) if initial else chess.Board(chess960=chess960)
    board.chess960 = board.chess960 or board.has_chess960_castling_rights()
    _replay(board, list(game.moves_uci or ())[:ply])
    return board


def _replay(board: chess.Board, moves: Iterable[str]) -> chess.Board:
    """Push a UCI sequence, raising `ValueError` on the first move that is not legal."""
    for uci in moves:
        board.push(board.parse_uci(uci))
    return board


def _clean_moves(moves: Sequence[str]) -> list[str]:
    cleaned = [str(uci).strip() for uci in moves or ()]
    return [uci for uci in cleaned if uci]


def _is_prefix(first: Sequence[str], second: Sequence[str]) -> bool:
    """`first` is `second`, or the start of it."""
    return len(first) <= len(second) and all(
        uci == second[index] for index, uci in enumerate(first)
    )


def _day(moment: datetime) -> str:
    return moment.date().isoformat()


def _played(game: Game) -> str:
    return f" ({_day(game.played_at)})" if game.played_at is not None else ""


def _announce(session: Session, event: str, note: Note) -> None:
    """One note write on the `/events` stream, flat, the way every other event is shaped."""
    payload = note_payload(session, note)
    events_service.emit({"event": event, "note_id": payload.pop("id"), **payload})


def _announce_line(session: Session, event: str, line: Line) -> None:
    payload = line_payload(session, line)
    events_service.emit({"event": event, "line_id": payload.pop("id"), **payload})


def _contains(column: ColumnElement[str | None], value: str) -> ColumnElement[bool]:
    escaped = value.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return column.ilike(f"%{escaped}%", escape="\\")

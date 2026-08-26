from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

from mcp.types import TextContent

# Everything a coach tool sends is read by a model, so a payload pays for every byte of
# itself: no indentation, no key that carries `None`, and floats rounded to the precision
# the number actually has.
SEPARATORS = (",", ":")
DIGITS = 3

# Timestamps go out to the minute. A game was played at a time of day (the stats layer
# aggregates by hour), but nothing here is answered by its seconds.
STAMP_FORMAT = "%Y-%m-%dT%H:%MZ"

# The fields of a game summary a card keeps. The rest of what `games.game_summary` builds
# — source id, dedup material, the raw ratings of both sides — is for the UI.
GAME_FIELDS = (
    "id",
    "source",
    "played_at",
    "color",
    "outcome",
    "result",
    "opponent",
    "opponent_rating",
    "rating",
    "speed",
    "time_control",
    "variant",
    "eco",
    "opening",
    "termination",
    "ply_count",
)

# A move's own quality is only worth a key when it went wrong; "good" on 40 plies is 400
# bytes saying nothing.
NOTABLE = frozenset({"inaccuracy", "mistake", "blunder"})

# Keys whose value is a moment in time, wherever they turn up. Shortening them here means
# a payload passed straight through from a service still goes out to the minute.
STAMP_KEYS = frozenset(
    {
        "at",
        "created_at",
        "finished_at",
        "first_game",
        "last_game",
        "last_played",
        "played_at",
        "since",
        "started_at",
        "until",
        "updated_at",
    }
)


def result(payload: Mapping[str, Any]) -> TextContent:
    """One tool payload as the single compact JSON block the model receives."""
    text = json.dumps(compact(payload), separators=SEPARATORS, ensure_ascii=False, default=str)
    return TextContent(type="text", text=text)


def compact(value: Any, digits: int = DIGITS) -> Any:
    """Drop every null, round every float and shorten every timestamp, all the way down."""
    if isinstance(value, Mapping):
        return {
            key: stamp(item) if key in STAMP_KEYS else compact(item, digits)
            for key, item in value.items()
            if item is not None
        }
    if isinstance(value, str | bytes):
        return value
    if isinstance(value, Sequence):
        return [compact(item, digits) for item in value if item is not None]
    if isinstance(value, bool | int):
        return value
    if isinstance(value, float):
        return round(value, digits)
    return value


def stamp(value: Any) -> str | None:
    """An ISO timestamp shortened to the minute, in UTC."""
    if value is None:
        return None
    moment = value
    if isinstance(value, str):
        try:
            moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return value
    if not isinstance(moment, datetime):
        return str(value)
    if moment.tzinfo is not None:
        moment = moment.astimezone(UTC)
    return moment.strftime(STAMP_FORMAT)


def game_row(summary: Mapping[str, Any]) -> dict[str, Any]:
    """A game as one line of a list: who, when, what happened, which opening."""
    row = {field: summary.get(field) for field in GAME_FIELDS}
    row["played_at"] = stamp(summary.get("played_at"))
    if summary.get("color") is None:
        # Nobody's account played in this one, so "opponent" means nothing and the two
        # names are the only way to say who did.
        row["white"] = summary.get("white")
        row["black"] = summary.get("black")
    return row


def game_card(card: Mapping[str, Any], *, curve_points: int) -> dict[str, Any]:
    """A game the way "check my last two games" wants it: the row plus what went wrong."""
    row = game_row(card)
    row["analyzed"] = bool(card.get("analyzed"))
    if card.get("deep"):
        row["deep"] = True
    points = eval_curve(card.get("eval_curve") or (), curve_points)
    if points:
        row["eval_curve"] = points
    moments = [moment_row(entry) for entry in card.get("worst_moments") or ()]
    if moments:
        row["worst_moments"] = moments
    return row


def eval_curve(points: Sequence[Mapping[str, Any]], limit: int) -> list[list[float]]:
    """The eval curve as `[[ply, win%], ...]`, thinned to at most `limit` points.

    Pairs rather than objects, and thinned rather than whole: the shape of the game is
    what a coach reads off a curve, and it survives both.
    """
    usable = [point for point in points if point.get("win") is not None]
    if not usable:
        return []
    if limit > 0 and len(usable) > limit:
        step = len(usable) / limit
        kept = [usable[int(index * step)] for index in range(limit - 1)]
        kept.append(usable[-1])
        usable = kept
    return [[int(point["ply"]), round(float(point["win"]), 1)] for point in usable]


def moment_row(entry: Mapping[str, Any]) -> dict[str, Any]:
    """One move that cost something, with the move that would not have."""
    return {
        "ply": entry.get("ply"),
        "move_number": entry.get("move_number"),
        "san": entry.get("san"),
        "classification": entry.get("classification"),
        "win_loss": _round(entry.get("win_loss"), 1),
        "best_move_uci": entry.get("best_move_uci"),
    }


def worst_moment(entry: Mapping[str, Any]) -> dict[str, Any]:
    """A moment from `stats.get_worst_recent_moments`, which carries its own game."""
    row = moment_row(entry)
    row["best_move_san"] = entry.get("best_move_san")
    row["phase"] = entry.get("phase")
    row["piece"] = entry.get("piece")
    row["fen"] = entry.get("fen")
    game = entry.get("game")
    if isinstance(game, Mapping):
        row["game"] = game_row(game)
    return row


def move_row(move: Mapping[str, Any], *, include_lines: bool) -> dict[str, Any]:
    """One ply of a game: what was played, what it was worth, what was better."""
    classification = move.get("classification")
    notable = classification in NOTABLE
    row: dict[str, Any] = {
        "ply": move.get("ply"),
        "san": move.get("san"),
        "cp": move.get("eval_after_cp"),
        "mate": move.get("eval_after_mate"),
        "win_after": _round(move.get("win_after"), 1),
        "clock": _round(move.get("clock"), 1),
    }
    if notable:
        row["classification"] = classification
        row["win_loss"] = _round(move.get("win_loss"), 1)
        row["best_move_uci"] = move.get("best_move_uci")
    if move.get("maia"):
        row["maia"] = move["maia"]
    if include_lines and move.get("best_lines"):
        row["best_lines"] = move["best_lines"]
    return row


def run_row(run: Mapping[str, Any]) -> dict[str, Any]:
    """One analysis pass over a game, as the coach needs to tell them apart."""
    return {
        "id": run.get("id"),
        "tier": run.get("tier"),
        "status": run.get("status"),
        "engine": run.get("engine"),
        "nodes": run.get("nodes"),
        "multipv": run.get("multipv"),
        "ply_start": run.get("ply_start"),
        "ply_end": run.get("ply_end"),
        "finished_at": stamp(run.get("finished_at")),
    }


def note_row(note: Mapping[str, Any]) -> dict[str, Any]:
    row = dict(note)
    row["created_at"] = stamp(note.get("created_at"))
    updated = stamp(note.get("updated_at"))
    row["updated_at"] = updated if updated != row["created_at"] else None
    return row


def _round(value: Any, digits: int) -> Any:
    return round(float(value), digits) if isinstance(value, int | float) else value

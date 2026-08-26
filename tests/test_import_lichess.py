from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.adapters import lichess, pgn_import
from backend.db.enums import JobStatus, Result, Source, Speed
from backend.db.models import Account, Game, ImportJob
from backend.services.import_service import ImportFailure, ParsedGame, run_import

EXPORT = "https://lichess.org/api/games/user/ExamplePlayer"
PLAYER = "ExamplePlayer"

# The newest `createdAt` in the fixture (zzScandi), which is what a sync leaves behind.
NEWEST = "1786442400000"


class Sleeper:
    """Stands in for `time.sleep` so a rate-limit test does not take a minute."""

    def __init__(self) -> None:
        self.waited: list[float] = []

    def __call__(self, seconds: float) -> None:
        self.waited.append(seconds)


@pytest.fixture()
def archive(fixtures_dir: Path) -> str:
    return (fixtures_dir / "lichess_games.ndjson").read_text(encoding="utf-8")


@pytest.fixture()
def records(archive: str) -> list[dict[str, Any]]:
    return [json.loads(line) for line in archive.splitlines() if line.strip()]


def ndjson(*payloads: dict[str, Any]) -> str:
    return "".join(f"{json.dumps(payload)}\n" for payload in payloads)


def sync(session: Session, player: str = PLAYER, **options: Any) -> ImportJob:
    return run_import(session, Source.LICHESS, username=player, sleep=Sleeper(), **options)


def games(session: Session) -> list[Game]:
    return list(session.scalars(select(Game).order_by(Game.id)))


@respx.mock
def test_a_sync_stores_every_standard_game_in_the_archive(session: Session, archive: str) -> None:
    respx.get(EXPORT).mock(return_value=httpx.Response(200, text=archive))

    job = sync(session)

    assert job.status is JobStatus.DONE
    # Seven games: six stored — two of them a rematch that shares its moves, its players
    # and its day, and is still two games because Lichess named them separately — and one
    # crazyhouse this database does not model.
    assert (job.games_seen, job.games_imported, job.games_skipped, job.games_failed) == (
        7,
        6,
        0,
        1,
    )
    assert [game.source_id for game in games(session)] == [
        "zzDanish",
        "zzScandi",
        "zzNoClok",
        "zzLowClk",
        "zzBullet",
        "zzCasual",
    ]
    assert all(game.source is Source.LICHESS for game in games(session))


@respx.mock
def test_an_unsupported_variant_is_recorded_and_never_aborts_the_sync(
    session: Session, archive: str
) -> None:
    respx.get(EXPORT).mock(return_value=httpx.Response(200, text=archive))

    job = sync(session)

    assert job.errors == [
        {"ref": "lichess:zzFiltered", "error": "unsupported variant 'crazyhouse'"}
    ]


@respx.mock
def test_the_owners_side_is_resolved_from_the_accounts_table(
    session: Session, archive: str
) -> None:
    session.add(Account(platform="lichess", username="exampleplayer", is_owner=True))
    session.commit()

    respx.get(EXPORT).mock(return_value=httpx.Response(200, text=archive))
    job = sync(session)

    stored = {game.source_id: game for game in games(session)}
    assert stored["zzDanish"].owner_color == "white"
    assert stored["zzScandi"].owner_color == "black"
    assert job.account_id == session.scalars(select(Account.id)).one()


@respx.mock
def test_the_first_sync_asks_for_the_whole_archive_oldest_first(
    session: Session, archive: str
) -> None:
    route = respx.get(EXPORT).mock(return_value=httpx.Response(200, text=archive))

    sync(session)

    params = route.calls[0].request.url.params
    assert "since" not in params
    assert params["sort"] == "dateAsc"
    assert params["clocks"] == "true"
    assert params["opening"] == "true"
    assert route.calls[0].request.headers["accept"] == "application/x-ndjson"


@respx.mock
def test_a_second_sync_starts_from_the_stored_cursor(session: Session, archive: str) -> None:
    route = respx.get(EXPORT).mock(
        side_effect=[httpx.Response(200, text=archive), httpx.Response(200, text="")]
    )

    first = sync(session)
    assert first.cursor == NEWEST

    second = sync(session)

    assert route.calls[1].request.url.params["since"] == NEWEST
    assert second.games_seen == 0
    # Nothing new still means the newest job carries the newest cursor.
    assert second.cursor == NEWEST


@respx.mock
def test_a_cursor_belongs_to_the_account_it_was_read_for(session: Session, archive: str) -> None:
    respx.get(EXPORT).mock(return_value=httpx.Response(200, text=archive))
    other = respx.get("https://lichess.org/api/games/user/OtherPlayer").mock(
        return_value=httpx.Response(200, text="")
    )

    sync(session)
    sync(session, player="OtherPlayer")

    assert "since" not in other.calls[0].request.url.params


@respx.mock
def test_an_explicit_since_overrides_the_stored_cursor(session: Session, archive: str) -> None:
    route = respx.get(EXPORT).mock(
        side_effect=[httpx.Response(200, text=archive), httpx.Response(200, text="")]
    )

    sync(session)
    sync(session, since="2026-01-01")

    assert route.calls[1].request.url.params["since"] == "1767225600000"


@respx.mock
def test_since_all_walks_the_whole_archive_again(session: Session, archive: str) -> None:
    route = respx.get(EXPORT).mock(
        side_effect=[httpx.Response(200, text=archive), httpx.Response(200, text=archive)]
    )

    sync(session)
    repeat = sync(session, since="all")

    assert "since" not in route.calls[1].request.url.params
    assert (repeat.games_imported, repeat.games_skipped) == (0, 6)


@respx.mock
def test_max_games_is_passed_on_and_caps_the_request(session: Session, archive: str) -> None:
    route = respx.get(EXPORT).mock(return_value=httpx.Response(200, text=archive))

    sync(session, max_games=2)

    assert route.calls[0].request.url.params["max"] == "2"


@respx.mock
def test_speed_and_rated_filters_are_left_to_lichess(session: Session, archive: str) -> None:
    route = respx.get(EXPORT).mock(return_value=httpx.Response(200, text=archive))

    job = sync(session, speeds=["blitz"], rated=True)

    params = route.calls[0].request.url.params
    assert params["perfType"] == "blitz"
    assert params["rated"] == "true"
    # The endpoint ignores a filter it does not know, so what came back is filtered again.
    assert job.games_seen == 6


@respx.mock
def test_a_filtered_sync_leaves_the_accounts_cursor_alone(session: Session, archive: str) -> None:
    """A sync that asked for one speed saw only part of what the account played, so its
    newest game is not a stamp anything may resume from: the games it filtered out are
    older, and a later unfiltered sync starting there would never see them."""
    route = respx.get(EXPORT).mock(return_value=httpx.Response(200, text=archive))

    filtered = sync(session, speeds=["blitz"])
    assert filtered.cursor is None

    sync(session)

    assert "since" not in route.calls[1].request.url.params


@respx.mock
def test_a_token_is_sent_as_a_bearer_header(session: Session, archive: str) -> None:
    route = respx.get(EXPORT).mock(return_value=httpx.Response(200, text=archive))

    sync(session, token="lip_secret")

    assert route.calls[0].request.headers["authorization"] == "Bearer lip_secret"


@respx.mock
def test_a_rate_limit_is_retried_after_the_delay_lichess_asks_for(
    session: Session, archive: str
) -> None:
    route = respx.get(EXPORT).mock(
        side_effect=[
            httpx.Response(429, headers={"retry-after": "5"}, text="slow down"),
            httpx.Response(200, text=archive),
        ]
    )
    sleeper = Sleeper()

    job = run_import(session, Source.LICHESS, username=PLAYER, sleep=sleeper)

    assert route.call_count == 2
    # Lichess asks for a full minute after a 429 whatever the header says.
    assert sleeper.waited == [60.0]
    assert job.status is JobStatus.DONE
    assert job.games_imported == 6


@respx.mock
def test_a_rate_limit_that_never_clears_fails_the_job(session: Session) -> None:
    route = respx.get(EXPORT).mock(return_value=httpx.Response(429, headers={"retry-after": "90"}))
    sleeper = Sleeper()

    job = run_import(session, Source.LICHESS, username=PLAYER, sleep=sleeper)

    assert route.call_count == lichess.MAX_ATTEMPTS
    assert sleeper.waited == [90.0, 90.0]
    assert job.status is JobStatus.FAILED
    assert "rate limiting" in (job.message or "")
    assert games(session) == []


@pytest.mark.parametrize(
    ("header", "expected"),
    [("5", 60.0), ("90", 90.0), ("99999", 300.0), ("Mon, 01 Jan 2026 00:00:00 GMT", 60.0)],
)
def test_the_retry_delay_is_clamped_to_something_sane(header: str, expected: float) -> None:
    assert lichess.retry_delay(httpx.Headers({"retry-after": header})) == expected


def test_a_missing_retry_after_still_waits_a_minute() -> None:
    assert lichess.retry_delay(httpx.Headers()) == 60.0


@respx.mock
def test_a_malformed_line_is_recorded_and_the_rest_imported(
    session: Session, records: list[dict[str, Any]]
) -> None:
    body = f"{ndjson(records[0])}{{not json at all\n{ndjson(records[1])}"
    respx.get(EXPORT).mock(return_value=httpx.Response(200, text=body))

    job = sync(session)

    assert job.status is JobStatus.DONE
    assert (job.games_seen, job.games_imported, job.games_failed) == (3, 2, 1)
    assert [error["ref"] for error in job.errors] == ["line 2"]
    assert "JSONDecodeError" in job.errors[0]["error"]
    assert [game.source_id for game in games(session)] == ["zzDanish", "zzScandi"]


@respx.mock
def test_a_line_that_is_not_a_game_object_is_recorded_too(session: Session) -> None:
    respx.get(EXPORT).mock(return_value=httpx.Response(200, text=ndjson({"error": "nope"})))

    job = sync(session)

    assert job.games_failed == 1
    assert job.errors == [{"ref": "line 1", "error": "not a lichess game object"}]


@respx.mock
def test_a_game_with_an_illegal_move_costs_only_that_game(
    session: Session, records: list[dict[str, Any]]
) -> None:
    broken = dict(records[0], id="zzBroken", moves="e4 e5 Qxq9")
    respx.get(EXPORT).mock(return_value=httpx.Response(200, text=ndjson(broken, records[1])))

    job = sync(session)

    assert (job.games_imported, job.games_failed) == (1, 1)
    assert job.errors[0]["ref"] == "lichess:zzBroken"
    assert [game.source_id for game in games(session)] == ["zzScandi"]


@respx.mock
def test_an_unknown_player_fails_the_job_without_a_stack_trace(session: Session) -> None:
    respx.get(EXPORT).mock(return_value=httpx.Response(404, json={"error": "Not found"}))

    job = sync(session)

    assert job.status is JobStatus.FAILED
    assert job.message == "UnknownPlayerError: lichess has no player called 'ExamplePlayer'"


@respx.mock
def test_a_server_error_fails_the_job(session: Session) -> None:
    respx.get(EXPORT).mock(return_value=httpx.Response(503, text="down"))

    job = sync(session)

    assert job.status is JobStatus.FAILED
    assert "503" in (job.message or "")


def test_an_import_without_a_username_is_refused(session: Session) -> None:
    job = run_import(session, Source.LICHESS)

    assert job.status is JobStatus.FAILED
    assert "username" in (job.message or "")


@respx.mock
def test_progress_events_name_the_games_by_their_lichess_id(
    session: Session, records: list[dict[str, Any]]
) -> None:
    respx.get(EXPORT).mock(return_value=httpx.Response(200, text=ndjson(records[0])))
    events: list[dict[str, Any]] = []

    run_import(session, Source.LICHESS, username=PLAYER, progress=events.append)

    game_events = [event for event in events if event["event"] == "import.game"]
    assert [event["ref"] for event in game_events] == ["lichess:zzDanish"]
    assert game_events[0]["status"] == "imported"


def test_metadata_comes_off_the_export_record(records: list[dict[str, Any]]) -> None:
    game = lichess.parse_game(records[0])

    assert isinstance(game, ParsedGame)
    assert game.source is Source.LICHESS
    assert game.source_id == "zzDanish"
    assert (game.white_name, game.black_name) == ("ExamplePlayer", "OpponentAlpha")
    assert (game.white_rating, game.black_rating) == (1500, 1523)
    assert game.result is Result.WHITE_WIN
    assert game.termination == "resign"
    assert game.variant == "standard"
    assert game.rated is True
    assert game.speed is Speed.BLITZ
    assert (game.time_control, game.initial_clock, game.increment) == ("180+2", 180, 2)
    assert (game.eco, game.opening_name) == ("C21", "Danish Gambit Accepted")
    assert game.played_at is not None
    assert game.played_at.isoformat() == "2026-08-08T12:00:00+00:00"
    assert game.initial_fen is None
    assert len(game.moves_uci) == len(game.moves_san) == 36
    assert game.moves_uci[:4] == ["e2e4", "e7e5", "d2d4", "e5d4"]
    assert game.moves_san[:4] == ["e4", "e5", "d4", "exd4"]
    # Castling as `e1g1`, because this is not a chess960 game.
    assert "e1g1" in game.moves_uci


def test_clocks_arrive_in_centiseconds_and_are_stored_in_seconds(
    records: list[dict[str, Any]],
) -> None:
    game = lichess.parse_game(records[0])

    assert game.clocks is not None
    assert len(game.clocks) == len(game.moves_uci)
    assert game.clocks[:2] == [180.03, 180.03]


def test_a_game_without_clocks_stores_none(records: list[dict[str, Any]]) -> None:
    assert lichess.parse_game(records[2]).clocks is None


def test_the_written_pgn_reads_back_as_the_same_game(records: list[dict[str, Any]]) -> None:
    game = lichess.parse_game(records[0])

    parsed = list(pgn_import.parse_stream(io.StringIO(game.pgn)))

    assert len(parsed) == 1
    again = parsed[0]
    assert isinstance(again, ParsedGame)
    assert again.moves_uci == game.moves_uci
    assert again.moves_san == game.moves_san
    assert again.speed is game.speed
    assert again.rated is game.rated
    assert again.result is game.result
    assert again.eco == game.eco
    assert again.source_id == game.source_id
    assert again.played_at == game.played_at
    # A PGN spells the clock in hundredths of a second, so it comes back a rounding apart.
    assert again.clocks == pytest.approx(game.clocks)


def test_an_aborted_game_is_a_recorded_failure(records: list[dict[str, Any]]) -> None:
    aborted = dict(records[0], moves="", status="aborted")
    del aborted["winner"]

    items = list(lichess.parse_stream([json.dumps(aborted)]))

    assert isinstance(items[0], ImportFailure)
    assert items[0].error == "ValueError: the game ended before a move was played"


def test_a_draw_is_read_off_the_status(records: list[dict[str, Any]]) -> None:
    drawn = dict(records[0], status="draw")
    del drawn["winner"]

    assert lichess.parse_game(drawn).result is Result.DRAW


def test_an_unfinished_game_has_an_unknown_result(records: list[dict[str, Any]]) -> None:
    unknown = dict(records[0], status="unknownFinish")
    del unknown["winner"]

    assert lichess.parse_game(unknown).result is Result.UNKNOWN


def test_an_anonymous_opponent_and_a_bot_still_get_names(records: list[dict[str, Any]]) -> None:
    payload = dict(records[0])
    payload["players"] = {"white": {"aiLevel": 5}, "black": {}}

    game = lichess.parse_game(payload)

    assert (game.white_name, game.black_name) == ("lichess AI level 5", "Anonymous")
    assert (game.white_rating, game.black_rating) == (None, None)


def test_ultrabullet_is_stored_as_bullet(records: list[dict[str, Any]]) -> None:
    assert lichess.parse_game(dict(records[0], speed="ultraBullet")).speed is Speed.BULLET


def test_a_chess960_game_castles_the_way_chess960_spells_it(records: list[dict[str, Any]]) -> None:
    start = "1rkr4/pppppppp/8/8/8/8/PPPPPPPP/1RKR4 w DBdb - 0 1"
    payload = dict(
        records[0],
        id="zz960Gam",
        variant="chess960",
        initialFen=start,
        moves="O-O e5 Rbe1",
        clocks=[18000, 18000, 18000],
    )

    game = lichess.parse_game(payload)

    assert game.variant == "chess960"
    assert game.initial_fen == start
    # King takes rook, because that is the only unambiguous way to say it here.
    assert game.moves_uci == ["c1d1", "e7e5", "b1e1"]
    assert game.moves_san == ["O-O", "e5", "Rbe1"]


@respx.mock
def test_a_chess960_game_is_replayed_from_its_own_start_position(
    session: Session, records: list[dict[str, Any]]
) -> None:
    payload = dict(
        records[0],
        id="zz960Gam",
        variant="chess960",
        initialFen="1rkr4/pppppppp/8/8/8/8/PPPPPPPP/1RKR4 w DBdb - 0 1",
        moves="O-O e5 Rbe1",
        clocks=[18000, 18000, 18000],
    )
    respx.get(EXPORT).mock(return_value=httpx.Response(200, text=ndjson(payload)))

    job = sync(session)

    assert (job.games_imported, job.games_failed) == (1, 0)
    stored = games(session)[0]
    assert stored.ply_count == 3
    assert len(stored.positions) == 4
    assert stored.positions[0].position.fen.startswith("1rkr4/pppppppp")


def test_from_position_games_are_named_the_way_the_pgn_adapter_names_them(
    records: list[dict[str, Any]],
) -> None:
    payload = dict(
        records[0],
        variant="fromPosition",
        initialFen="4k3/8/8/8/8/8/4P3/4K3 w - - 0 1",
        moves="e4",
        clocks=[18000],
    )

    game = lichess.parse_game(payload)

    assert game.variant == "from position"
    assert game.moves_uci == ["e2e4"]


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("1786442400000", 1786442400000),
        (1786442400000, 1786442400000),
        ("2026-01-01", 1767225600000),
        ("2026-01-01T12:00:00+00:00", 1767268800000),
        ("all", None),
        ("", None),
    ],
)
def test_a_since_value_may_be_a_stamp_a_date_or_the_whole_archive(
    value: str | int, expected: int | None
) -> None:
    assert lichess.parse_since(value) == expected


def test_an_unreadable_since_value_is_refused() -> None:
    with pytest.raises(ValueError, match="cannot read"):
        lichess.parse_since("last tuesday")

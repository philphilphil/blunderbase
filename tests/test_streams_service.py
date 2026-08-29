"""The broker's own rules, with a backend that only writes down what it was asked to do.

The two real backends are tested where they can be: the local one against a scripted engine
in `test_streams_api.py`, the remote one against a `FakeRunner` there too. What is left is
everything the broker decides on its own — which engine, how many boards, who is still
listening, what a lost runner costs — and none of that needs a process to be honest about.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from typing import Any

import pytest
from sqlalchemy.orm import Session, sessionmaker

from backend.config import Settings
from backend.db.enums import EngineKind, EngineRole
from backend.db.models import Engine, Runner
from backend.services import app_settings
from backend.services import engines as engines_service
from backend.services import events as events_service
from backend.services import streams as streams_service
from backend.services.streams import (
    StreamBroker,
    StreamLimitError,
    StreamRequestError,
    StreamSession,
    StreamUnavailableError,
    UnknownStreamError,
)

STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"

# Long enough that a machine under load is not the reason a test fails, short enough that a
# wait nothing will ever satisfy is a failure rather than a hung suite.
SETTLE_SECONDS = 5.0


class Backend:
    """A backend that serves nothing and remembers everything."""

    def __init__(self, name: str, *, refuse: str | None = None) -> None:
        self.name = name
        self.refuse = refuse
        self.opened: list[str] = []
        self.restarted: list[tuple[str, str, int]] = []
        self.closed: list[tuple[str, str]] = []

    async def open(self, session: StreamSession) -> None:
        if self.refuse is not None:
            raise StreamUnavailableError(self.refuse)
        self.opened.append(session.id)

    async def restart(self, session: StreamSession) -> None:
        self.restarted.append((session.id, session.fen, session.multipv))

    async def close(self, session: StreamSession, reason: str) -> None:
        self.closed.append((session.id, reason))


class OneSlot(Backend):
    """A backend with room for exactly one board: the shape of a pool of one."""

    def __init__(self, name: str) -> None:
        super().__init__(name)
        self.free = asyncio.Semaphore(1)
        self.waiting = asyncio.Event()

    async def open(self, session: StreamSession) -> None:
        self.waiting.set()
        await asyncio.wait_for(self.free.acquire(), SETTLE_SECONDS)
        self.opened.append(session.id)

    async def close(self, session: StreamSession, reason: str) -> None:
        self.closed.append((session.id, reason))
        self.free.release()


class Listeners:
    """How many browsers the reaper is told are watching."""

    def __init__(self, count: int = 1) -> None:
        self.count = count

    def __call__(self) -> int:
        return self.count


@pytest.fixture()
def events() -> Iterator[list[dict[str, Any]]]:
    seen: list[dict[str, Any]] = []
    cancel = events_service.subscribe(seen.append)
    yield seen
    cancel()


def add_engine(
    sessions: sessionmaker[Session],
    name: str = "stockfish",
    *,
    kind: EngineKind = EngineKind.UCI,
    role: EngineRole | None = EngineRole.DEEP,
    enabled: bool = True,
    runner_id: int | None = None,
    streams: bool = True,
) -> int:
    with sessions() as session:
        engine = Engine(
            name=name,
            kind=kind,
            path="/usr/games/stockfish",
            enabled=enabled,
            runner_id=runner_id,
            streams=streams,
        )
        session.add(engine)
        session.commit()
        # First registered keeps the role, as the old `default_tier` resolution did: a
        # board with no engine named asks for the deep one, and these tests are about which
        # engine that is.
        if role is not None and app_settings.get_role_engine_id(session, role) is None:
            engines_service.set_role_engine(session, role, engine.id)
        return engine.id


def add_runner(
    sessions: sessionmaker[Session], name: str = "gpu-box", *, connected: bool = True
) -> int:
    with sessions() as session:
        runner = Runner(name=name, token_hash=f"hash-{name}", slots=2, connected=connected)
        session.add(runner)
        session.commit()
        return runner.id


def broker_for(
    settings: Settings,
    sessions: sessionmaker[Session],
    *,
    backends: dict[str, Any] | None = None,
    listeners: Listeners | None = None,
) -> StreamBroker:
    return StreamBroker(
        settings=settings,
        sessions=sessions,
        backends=backends or {streams_service.LOCAL: Backend(streams_service.LOCAL)},
        listeners=listeners or Listeners(1),
    )


def of_kind(events: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return [event for event in events if event.get("event") == kind]


# --- choosing an engine ------------------------------------------------------


async def test_a_board_with_no_engine_named_takes_the_deep_tier_s(
    settings: Settings, sessions: sessionmaker[Session], events: list[dict[str, Any]]
) -> None:
    engine_id = add_engine(sessions, "deepfish", role=EngineRole.DEEP)
    broker = broker_for(settings, sessions)

    session = await broker.open(fen=STARTING_FEN, surface="game")

    assert (session.engine_id, session.engine) == (engine_id, "deepfish")
    assert (session.runner_id, session.state) == (None, "starting")
    started = of_kind(events, streams_service.EVENT_STREAM_STARTED)[0]
    assert (started["session_id"], started["surface"]) == (session.id, "game")


async def test_a_maia_is_refused_because_it_answers_with_a_policy(
    settings: Settings, sessions: sessionmaker[Session]
) -> None:
    engine_id = add_engine(sessions, "maia-1500", kind=EngineKind.MAIA, role=None)
    broker = broker_for(settings, sessions)

    with pytest.raises(StreamRequestError, match="human-move model"):
        await broker.open(fen=STARTING_FEN, engine_id=engine_id)


async def test_an_engine_that_is_switched_off_is_refused(
    settings: Settings, sessions: sessionmaker[Session]
) -> None:
    engine_id = add_engine(sessions, "retired", enabled=False)
    broker = broker_for(settings, sessions)

    with pytest.raises(StreamUnavailableError, match="switched off"):
        await broker.open(fen=STARTING_FEN, engine_id=engine_id)


async def test_an_engine_whose_host_answers_no_stream_open_is_refused(
    settings: Settings, sessions: sessionmaker[Session]
) -> None:
    """The host's own word, and the reason it is a column rather than an inference.

    The picker hides one of these, but a coach or a script asking by id has to get a
    sentence back rather than a board that waits forever for a `stream_started`.
    """
    runner_id = add_runner(sessions, "this browser")
    engine_id = add_engine(sessions, "queue-only", runner_id=runner_id, streams=False)
    broker = broker_for(settings, sessions)

    with pytest.raises(StreamUnavailableError, match="drives no analysis board"):
        await broker.open(fen=STARTING_FEN, engine_id=engine_id)


async def test_an_engine_on_a_runner_nobody_is_dialled_in_from_is_refused(
    settings: Settings, sessions: sessionmaker[Session]
) -> None:
    runner_id = add_runner(sessions, "gpu-box", connected=False)
    engine_id = add_engine(sessions, "sf-remote", runner_id=runner_id)
    broker = broker_for(settings, sessions)

    with pytest.raises(StreamUnavailableError, match="not connected"):
        await broker.open(fen=STARTING_FEN, engine_id=engine_id)


async def test_a_connected_runner_s_engine_goes_to_the_remote_backend(
    settings: Settings, sessions: sessionmaker[Session]
) -> None:
    runner_id = add_runner(sessions)
    engine_id = add_engine(sessions, "sf-remote", runner_id=runner_id)
    remote = Backend(streams_service.REMOTE)
    broker = broker_for(
        settings,
        sessions,
        backends={
            streams_service.LOCAL: Backend(streams_service.LOCAL),
            streams_service.REMOTE: remote,
        },
    )

    session = await broker.open(fen=STARTING_FEN, engine_id=engine_id)

    assert (session.runner_id, session.runner) == (runner_id, "gpu-box")
    assert remote.opened == [session.id]


async def test_a_position_that_is_not_one_is_refused_before_any_engine_is_asked(
    settings: Settings, sessions: sessionmaker[Session]
) -> None:
    add_engine(sessions)
    broker = broker_for(settings, sessions)

    with pytest.raises(StreamRequestError):
        await broker.open(fen="not a position")
    with pytest.raises(StreamRequestError, match="multipv is 1 to 5"):
        await broker.open(fen=STARTING_FEN, multipv=9)
    with pytest.raises(StreamRequestError, match="unknown surface"):
        await broker.open(fen=STARTING_FEN, surface="telepathy")


async def test_a_backend_that_cannot_take_the_board_leaves_no_session_behind(
    settings: Settings, sessions: sessionmaker[Session]
) -> None:
    add_engine(sessions)
    broker = broker_for(
        settings, sessions, backends={streams_service.LOCAL: Backend("local", refuse="no slot")}
    )

    with pytest.raises(StreamUnavailableError, match="no slot"):
        await broker.open(fen=STARTING_FEN)

    assert broker.list() == []


async def test_an_open_waiting_for_a_slot_does_not_hold_up_the_close_that_frees_it(
    settings: Settings, sessions: sessionmaker[Session]
) -> None:
    """A local backend waits up to 20s for a pool slot. Held across that wait, the broker's
    own lock would be the only thing between the board and the slot it is waiting for."""
    add_engine(sessions)
    local = OneSlot(streams_service.LOCAL)
    broker = broker_for(settings, sessions, backends={streams_service.LOCAL: local})
    first = await broker.open(fen=STARTING_FEN, surface="game")
    local.waiting.clear()

    opening = asyncio.ensure_future(broker.open(fen=AFTER_E4, surface="live"))
    await asyncio.wait_for(local.waiting.wait(), SETTLE_SECONDS)
    await broker.close(first.id)
    second = await opening

    assert local.opened == [first.id, second.id]
    assert [session.id for session in broker.list()] == [second.id]


# --- how many boards ---------------------------------------------------------


async def test_a_second_board_on_the_same_surface_replaces_the_first(
    settings: Settings, sessions: sessionmaker[Session], events: list[dict[str, Any]]
) -> None:
    """The page moved on; two searches nobody is watching would be one too many."""
    add_engine(sessions)
    local = Backend(streams_service.LOCAL)
    broker = broker_for(settings, sessions, backends={streams_service.LOCAL: local})

    first = await broker.open(fen=STARTING_FEN, surface="game")
    second = await broker.open(fen=AFTER_E4, surface="game")

    assert [session.id for session in broker.list()] == [second.id]
    assert local.closed == [(first.id, streams_service.REASON_REPLACED)]
    ended = of_kind(events, streams_service.EVENT_STREAM_ENDED)[0]
    assert (ended["session_id"], ended["reason"]) == (first.id, "replaced")


async def test_the_two_surfaces_each_get_their_own_board(
    settings: Settings, sessions: sessionmaker[Session]
) -> None:
    add_engine(sessions)
    broker = broker_for(settings, sessions)

    game = await broker.open(fen=STARTING_FEN, surface="game")
    live = await broker.open(fen=AFTER_E4, surface="live")

    assert {session.id for session in broker.list()} == {game.id, live.id}


async def test_more_boards_than_the_deployment_allows_is_a_refusal(
    settings: Settings, sessions: sessionmaker[Session]
) -> None:
    settings.stream_max_sessions = 1
    add_engine(sessions)
    broker = broker_for(settings, sessions)
    await broker.open(fen=STARTING_FEN, surface="game")

    with pytest.raises(StreamLimitError):
        await broker.open(fen=AFTER_E4, surface="live")


# --- moving and closing ------------------------------------------------------


async def test_a_position_change_is_a_restart_on_the_same_slot(
    settings: Settings, sessions: sessionmaker[Session]
) -> None:
    add_engine(sessions)
    local = Backend(streams_service.LOCAL)
    broker = broker_for(settings, sessions, backends={streams_service.LOCAL: local})
    session = await broker.open(fen=STARTING_FEN, multipv=1)

    moved = await broker.restart(session.id, fen=AFTER_E4, multipv=3)

    assert moved.fen.startswith("rnbqkbnr/pppppppp/8/8/4P3")
    assert moved.multipv == 3
    assert local.restarted == [(session.id, moved.fen, 3)]
    assert local.closed == [], "a new position must never cost the board its engine"


async def test_only_what_was_sent_changes(
    settings: Settings, sessions: sessionmaker[Session]
) -> None:
    add_engine(sessions)
    broker = broker_for(settings, sessions)
    session = await broker.open(fen=STARTING_FEN, multipv=2)

    moved = await broker.restart(session.id, fen=AFTER_E4)

    assert moved.multipv == 2


async def test_restarting_or_reading_a_session_that_is_gone_is_a_named_refusal(
    settings: Settings, sessions: sessionmaker[Session]
) -> None:
    broker = broker_for(settings, sessions)

    with pytest.raises(UnknownStreamError):
        broker.get("str_nothing")
    with pytest.raises(UnknownStreamError):
        await broker.restart("str_nothing", fen=STARTING_FEN)
    # Closing one that has already gone is not an error: a page that refreshed twice
    # must not be told off for tidying up.
    await broker.close("str_nothing")


async def test_closing_a_board_frees_it_and_says_why(
    settings: Settings, sessions: sessionmaker[Session], events: list[dict[str, Any]]
) -> None:
    add_engine(sessions)
    local = Backend(streams_service.LOCAL)
    broker = broker_for(settings, sessions, backends={streams_service.LOCAL: local})
    session = await broker.open(fen=STARTING_FEN)

    await broker.close(session.id)

    assert broker.list() == []
    assert local.closed == [(session.id, streams_service.REASON_CLOSED)]
    assert of_kind(events, streams_service.EVENT_STREAM_ENDED)[0]["reason"] == "closed"


async def test_an_engine_that_died_ends_the_board_with_what_it_said(
    settings: Settings, sessions: sessionmaker[Session], events: list[dict[str, Any]]
) -> None:
    add_engine(sessions)
    broker = broker_for(settings, sessions)
    session = await broker.open(fen=STARTING_FEN)

    await broker.backend_ended(
        session.id, reason=streams_service.REASON_ENGINE_FAILED, error="EngineTerminatedError"
    )

    ended = of_kind(events, streams_service.EVENT_STREAM_ENDED)[0]
    assert (ended["reason"], ended["error"]) == ("engine_failed", "EngineTerminatedError")
    assert broker.list() == []


# --- snapshots ----------------------------------------------------------------


async def test_the_broker_numbers_the_snapshots_whoever_produced_them(
    settings: Settings, sessions: sessionmaker[Session], events: list[dict[str, Any]]
) -> None:
    """`seq` is the broker's, so a local board and a remote one are read the same way."""
    engine_id = add_engine(sessions, "deepfish")
    broker = broker_for(settings, sessions)
    session = await broker.open(fen=STARTING_FEN, multipv=2)

    lines = [{"multipv": 1, "cp": 34, "mate": None, "pv": ["e2e4"]}]
    broker.snapshot(session.id, {"depth": 24, "nodes": 1000, "nps": 500, "time_ms": 2000,
                                 "lines": lines})
    # A producer's own numbering is ignored: this frame arrives claiming to be the 99th.
    broker.snapshot(session.id, {"seq": 99, "depth": 25, "lines": lines})

    published = of_kind(events, streams_service.EVENT_STREAM_SNAPSHOT)
    assert [frame["seq"] for frame in published] == [1, 2]
    assert published[0]["engine_id"] == engine_id
    assert published[0]["lines"] == lines
    assert (published[0]["depth"], published[0]["nodes"]) == (24, 1000)
    assert published[0]["fen"] == session.fen
    assert published[0]["multipv"] == 2
    assert broker.get(session.id).state == "running"


async def test_a_snapshot_for_a_board_that_has_closed_goes_nowhere(
    settings: Settings, sessions: sessionmaker[Session], events: list[dict[str, Any]]
) -> None:
    """The engine thread is a step behind the close; it must not be able to resurrect it."""
    add_engine(sessions)
    broker = broker_for(settings, sessions)
    session = await broker.open(fen=STARTING_FEN)
    await broker.close(session.id)

    broker.snapshot(session.id, {"depth": 24, "lines": []})

    assert of_kind(events, streams_service.EVENT_STREAM_SNAPSHOT) == []


# --- who is watching, and who has gone -----------------------------------------


async def test_a_board_nobody_is_listening_to_gives_its_slot_back(
    settings: Settings, sessions: sessionmaker[Session], events: list[dict[str, Any]]
) -> None:
    settings.stream_idle_seconds = 0.0
    add_engine(sessions)
    listeners = Listeners(0)
    broker = broker_for(settings, sessions, listeners=listeners)
    session = await broker.open(fen=STARTING_FEN)

    reaped = await broker.reap_idle()

    assert reaped == [session.id]
    assert of_kind(events, streams_service.EVENT_STREAM_ENDED)[0]["reason"] == "idle"


async def test_a_board_somebody_is_watching_is_left_alone(
    settings: Settings, sessions: sessionmaker[Session]
) -> None:
    settings.stream_idle_seconds = 30.0
    add_engine(sessions)
    broker = broker_for(settings, sessions, listeners=Listeners(1))
    session = await broker.open(fen=STARTING_FEN)

    assert await broker.reap_idle() == []
    assert [open_session.id for open_session in broker.list()] == [session.id]


async def test_a_runner_that_drops_takes_its_boards_with_it(
    settings: Settings, sessions: sessionmaker[Session], events: list[dict[str, Any]]
) -> None:
    """`runner_gone` is what tells the page it may offer another engine, local included."""
    runner_id = add_runner(sessions)
    engine_id = add_engine(sessions, "sf-remote", runner_id=runner_id)
    local_id = add_engine(sessions, "stockfish", role=EngineRole.QUICK)
    broker = broker_for(
        settings,
        sessions,
        backends={
            streams_service.LOCAL: Backend(streams_service.LOCAL),
            streams_service.REMOTE: Backend(streams_service.REMOTE),
        },
    )
    remote_session = await broker.open(fen=STARTING_FEN, engine_id=engine_id, surface="game")
    kept = await broker.open(fen=STARTING_FEN, engine_id=local_id, surface="live")

    await broker.runner_gone(runner_id)

    ended = of_kind(events, streams_service.EVENT_STREAM_ENDED)
    assert [frame["session_id"] for frame in ended] == [remote_session.id]
    assert ended[0]["reason"] == "runner_gone"
    assert [session.id for session in broker.list()] == [kept.id]

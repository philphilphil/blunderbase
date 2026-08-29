"""The runner registry: one-time tokens, a limiter of its own, and advertised engines."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.db.enums import EngineKind, EngineRole, RunStatus, Tier
from backend.db.models import AnalysisRun, Credential, Engine, Runner
from backend.runners.protocol import EngineAd
from backend.services import analysis
from backend.services import auth as auth_service
from backend.services import engines as engines_service
from backend.services import events as events_service
from backend.services import runners as runners_service
from backend.services.runners import (
    DuplicateRunnerError,
    RunnerAuthError,
    RunnerLockedOutError,
    RunnerValidationError,
)

THREADS = {
    "name": "Threads",
    "type": "spin",
    "default": 1,
    "min": 1,
    "max": 128,
    "var": [],
    "managed": False,
}


@pytest.fixture(autouse=True)
def _fresh_limiter() -> Iterator[None]:
    """The limiter is module state, so a test that fails tokens must not spill into the next."""
    runners_service.reset_limiter()
    yield
    runners_service.reset_limiter()


def _ad(name: str = "sf-remote", **changes: Any) -> EngineAd:
    data: dict[str, Any] = {
        "name": name,
        "kind": "uci",
        "path": "/usr/games/stockfish",
        "version": "Stockfish 17",
        "tier": "deep",
        "options": {"Threads": 8},
        "declared_options": [THREADS],
    }
    return EngineAd.from_dict({**data, **changes})


def _local_engine(session: Session, name: str = "stockfish", **changes: Any) -> Engine:
    engine = Engine(
        name=name,
        kind=changes.pop("kind", EngineKind.UCI),
        path=changes.pop("path", "/usr/bin/stockfish"),
        enabled=changes.pop("enabled", True),
        **changes,
    )
    session.add(engine)
    session.commit()
    engines_service.assign_default_roles(session, engine)
    return engine


def _run(session: Session, engine_id: int | None, status: RunStatus) -> AnalysisRun:
    run = AnalysisRun(engine_id=engine_id, tier=Tier.QUICK, status=status)
    session.add(run)
    session.commit()
    return run


# --- registration ---------------------------------------------------------


def test_a_new_runner_is_handed_a_token_the_database_never_keeps(session: Session) -> None:
    runner, token = runners_service.create_runner(session, "gpu-box", slots=4)

    assert token.startswith(runners_service.TOKEN_PREFIX)
    assert runner.slots == 4
    assert runner.connected is False
    assert runner.token_hash == runners_service.token_hash(token)
    # The token itself is in the owner's hands and nowhere else: a copy of this database
    # is not a way to impersonate the runner.
    stored = session.get(Runner, runner.id)
    assert token not in [stored.name, stored.token_hash]


def test_two_runners_never_share_a_token(session: Session) -> None:
    _first, one = runners_service.create_runner(session, "gpu-box")
    _second, two = runners_service.create_runner(session, "laptop")

    assert one != two


def test_a_name_is_taken_once(session: Session) -> None:
    runners_service.create_runner(session, "gpu-box")

    with pytest.raises(DuplicateRunnerError):
        runners_service.create_runner(session, " gpu-box ")


@pytest.mark.parametrize(
    ("name", "slots"),
    [("", 1), ("   ", 1), ("x" * 65, 1), ("local", 1), ("gpu-box", 0), ("gpu-box", -3)],
)
def test_a_registration_that_does_not_hold_up_is_refused(
    session: Session, name: str, slots: int
) -> None:
    with pytest.raises(RunnerValidationError):
        runners_service.create_runner(session, name, slots=slots)


def test_a_runner_can_be_renamed_and_recapped(session: Session) -> None:
    runner, _token = runners_service.create_runner(session, "gpu-box", slots=4)

    updated = runners_service.update_runner(session, runner.id, name="workshop", slots=2)

    assert (updated.name, updated.slots) == ("workshop", 2)


def test_an_update_changes_only_what_it_was_given(session: Session) -> None:
    runner, _token = runners_service.create_runner(session, "gpu-box", slots=4)

    runners_service.update_runner(session, runner.id, slots=1)

    assert (runner.name, runner.slots) == ("gpu-box", 1)


def test_a_rename_cannot_take_another_runners_name(session: Session) -> None:
    runners_service.create_runner(session, "gpu-box")
    other, _token = runners_service.create_runner(session, "laptop")

    with pytest.raises(DuplicateRunnerError):
        runners_service.update_runner(session, other.id, name="gpu-box")


def test_a_rename_to_the_same_name_is_not_a_collision(session: Session) -> None:
    runner, _token = runners_service.create_runner(session, "gpu-box")

    assert runners_service.update_runner(session, runner.id, name="gpu-box").name == "gpu-box"


def test_runners_are_listed_and_looked_up(session: Session) -> None:
    first, _one = runners_service.create_runner(session, "gpu-box")
    second, _two = runners_service.create_runner(session, "laptop")

    assert [runner.id for runner in runners_service.list_runners(session)] == [
        first.id,
        second.id,
    ]
    assert runners_service.runner_by_name(session, "laptop").id == second.id
    assert runners_service.runner_by_name(session, "nobody") is None
    assert runners_service.get_runner(session, 9999) is None
    with pytest.raises(runners_service.UnknownRunnerError):
        runners_service.require_runner(session, 9999)


# --- revoking -------------------------------------------------------------


def test_revoking_a_runner_takes_its_engines_with_it(session: Session) -> None:
    runner, _token = runners_service.create_runner(session, "gpu-box")
    engines_service.sync_runner_engines(session, runner, [_ad(), _ad("maia-remote", kind="maia")])
    remote = engines_service.engines_of_runner(session, runner.id)
    run = _run(session, remote[0].id, RunStatus.QUEUED)

    assert runners_service.delete_runner(session, runner.id) is True

    session.refresh(run)
    assert session.get(Runner, runner.id) is None
    assert engines_service.engines_of_runner(session, runner.id) == []
    # The run keeps its place in the queue; the fallback at `_prepare` will find it an engine.
    assert run.engine_id is None
    assert run.status is RunStatus.QUEUED


def test_revoking_leaves_local_engines_alone(session: Session) -> None:
    local = _local_engine(session)
    runner, _token = runners_service.create_runner(session, "gpu-box")

    runners_service.delete_runner(session, runner.id)

    assert session.get(Engine, local.id) is not None


def test_revoking_a_runner_that_is_not_there_says_so(session: Session) -> None:
    assert runners_service.delete_runner(session, 4242) is False


# --- authentication -------------------------------------------------------


def test_the_token_it_was_given_is_the_runner_it_names(session: Session) -> None:
    runner, token = runners_service.create_runner(session, "gpu-box")

    assert runners_service.authenticate(session, token).id == runner.id


@pytest.mark.parametrize("token", [None, "", "bb_rnr_nonsense", "not-even-prefixed"])
def test_a_token_nobody_minted_is_refused(session: Session, token: str | None) -> None:
    runners_service.create_runner(session, "gpu-box")

    with pytest.raises(RunnerAuthError):
        runners_service.authenticate(session, token)


def test_a_revoked_token_stops_working(session: Session) -> None:
    runner, token = runners_service.create_runner(session, "gpu-box")
    runners_service.delete_runner(session, runner.id)

    with pytest.raises(RunnerAuthError):
        runners_service.authenticate(session, token)


def test_enough_wrong_tokens_shut_the_door_on_that_token(session: Session) -> None:
    runners_service.create_runner(session, "gpu-box")
    for _ in range(runners_service.LOCKOUT_THRESHOLD):
        with pytest.raises(RunnerAuthError):
            runners_service.authenticate(session, "bb_rnr_wrong")

    with pytest.raises(RunnerLockedOutError) as locked:
        runners_service.authenticate(session, "bb_rnr_wrong")

    assert locked.value.retry_after >= 1


@pytest.mark.parametrize("guess", ["bb_rnr_wrong", "", None])
def test_a_stranger_cannot_lock_a_registered_runner_out(
    session: Session, guess: str | None
) -> None:
    """The limiter is per presented token, so guesses — or no token at all — shut only
    their own door. One counter for the whole of `/runner` would let anyone at all take
    every runner in the deployment off the queue."""
    _runner, token = runners_service.create_runner(session, "gpu-box")
    for _ in range(runners_service.LOCKOUT_THRESHOLD * 2):
        with pytest.raises(RunnerAuthError):
            runners_service.authenticate(session, guess)

    assert runners_service.authenticate(session, token).name == "gpu-box"


def test_a_runner_s_good_token_does_not_forgive_somebody_else_s_backoff(
    session: Session,
) -> None:
    """The converse: a poller authenticating every few seconds would otherwise clear a
    guesser's backoff faster than it could ever accumulate."""
    _runner, token = runners_service.create_runner(session, "gpu-box")
    for _ in range(runners_service.LOCKOUT_THRESHOLD):
        with pytest.raises(RunnerAuthError):
            runners_service.authenticate(session, "bb_rnr_wrong")

    runners_service.authenticate(session, token)

    with pytest.raises(RunnerLockedOutError):
        runners_service.authenticate(session, "bb_rnr_wrong")


def test_the_backoff_lengthens_and_is_capped(session: Session) -> None:
    assert runners_service._backoff(runners_service.LOCKOUT_THRESHOLD) == (
        runners_service.LOCKOUT_BASE
    )
    assert runners_service._backoff(runners_service.LOCKOUT_THRESHOLD + 1) == (
        runners_service.LOCKOUT_BASE * 2
    )
    assert runners_service._backoff(runners_service.LOCKOUT_THRESHOLD + 40) == (
        runners_service.LOCKOUT_MAX
    )


def test_a_stranger_at_the_runner_door_cannot_lock_the_owner_out(session: Session) -> None:
    """The two limiters are deliberately separate: guessing runner tokens must not cost the
    owner their own browser."""
    auth_service.set_password(session, "correct-horse-battery")
    for _ in range(runners_service.LOCKOUT_THRESHOLD * 2):
        with pytest.raises(RunnerAuthError):
            runners_service.authenticate(session, "bb_rnr_wrong")

    credential = session.scalars(select(Credential)).one()
    assert credential.failed_attempts == 0
    assert credential.locked_until is None
    assert auth_service.verify_password(session, "correct-horse-battery") is True


def test_a_good_token_forgives_the_failures_it_earned_itself(session: Session) -> None:
    """A runner whose token was rotated back to the right one starts from nothing again."""
    runner, token = runners_service.create_runner(session, "gpu-box")
    stale = runners_service.mint_token()
    for _ in range(runners_service.LOCKOUT_THRESHOLD - 1):
        with pytest.raises(RunnerAuthError):
            runners_service.authenticate(session, stale)

    runner.token_hash = runners_service.token_hash(stale)
    session.commit()

    assert runners_service.authenticate(session, stale).name == "gpu-box"
    for _ in range(runners_service.LOCKOUT_THRESHOLD - 1):
        with pytest.raises(RunnerAuthError):
            runners_service.authenticate(session, token)
    assert runners_service.authenticate(session, stale).name == "gpu-box"


# --- connection state -----------------------------------------------------


def test_connecting_and_disconnecting_are_announced(session: Session) -> None:
    runner, _token = runners_service.create_runner(session, "gpu-box", slots=4)
    engines_service.sync_runner_engines(session, runner, [_ad()])
    events: list[dict[str, Any]] = []
    cancel = events_service.subscribe(events.append)
    try:
        runners_service.mark_connected(session, runner, version="0.1.0", slots=4)
        assert runner.connected is True
        runners_service.mark_disconnected(session, runner.id, reason="timeout")
    finally:
        cancel()

    assert [event["event"] for event in events] == [
        runners_service.EVENT_RUNNER_CONNECTED,
        runners_service.EVENT_RUNNER_DISCONNECTED,
    ]
    assert events[0]["engines"] == ["sf-remote"]
    assert events[0]["transport"] == "websocket"
    assert events[1]["reason"] == "timeout"
    assert runner.connected is False
    assert runner.version == "0.1.0"


def test_an_owners_edit_is_announced_with_the_counts_the_link_had(session: Session) -> None:
    """A rename is a state change like any other: a second browser hears about it."""
    runner, _token = runners_service.create_runner(session, "gpu-box", slots=4)
    runners_service.mark_connected(session, runner)
    events: list[dict[str, Any]] = []
    cancel = events_service.subscribe(events.append)
    try:
        row = runners_service.runner_rows(
            session, live={runner.id: {"busy": 2, "streams": 1, "free_slots": 1}}
        )[0]
        runners_service.announce(row)
    finally:
        cancel()

    assert events[0]["event"] == runners_service.EVENT_RUNNER_UPDATED
    assert events[0]["runner_id"] == runner.id
    assert (events[0]["name"], events[0]["slots"], events[0]["connected"]) == ("gpu-box", 4, True)
    assert (events[0]["busy"], events[0]["streams"], events[0]["free_slots"]) == (2, 1, 1)


def test_a_gone_runners_engines_are_marked_unavailable(session: Session) -> None:
    runner, _token = runners_service.create_runner(session, "gpu-box")
    engines_service.sync_runner_engines(session, runner, [_ad()])

    runners_service.mark_disconnected(session, runner.id)

    assert [engine.enabled for engine in engines_service.engines_of_runner(session, runner.id)] == [
        False
    ]


def test_the_owners_cap_wins_over_what_a_runner_claims(session: Session) -> None:
    runner, _token = runners_service.create_runner(session, "gpu-box", slots=2)

    assert runners_service.effective_slots(runner, 8) == 2
    assert runners_service.effective_slots(runner, 1) == 1
    assert runners_service.effective_slots(runner) == 2


def test_a_starting_process_clears_the_flag_a_dead_one_left(session: Session) -> None:
    runner, _token = runners_service.create_runner(session, "gpu-box")
    runners_service.mark_connected(session, runner)

    assert runners_service.disconnect_all(session) == 1
    assert runners_service.disconnect_all(session) == 0
    session.refresh(runner)
    assert runner.connected is False


def test_a_beat_moves_last_seen(session: Session) -> None:
    runner, _token = runners_service.create_runner(session, "gpu-box")
    assert runner.last_seen_at is None

    runners_service.touch(session, runner.id)

    session.refresh(runner)
    assert runner.last_seen_at is not None


# --- what the API and the CLI read ---------------------------------------


def test_a_runner_reads_as_its_row_plus_the_gateways_live_half(session: Session) -> None:
    runner, _token = runners_service.create_runner(session, "gpu-box", slots=4)
    engines_service.sync_runner_engines(session, runner, [_ad()])
    runners_service.mark_connected(session, runner, version="0.1.0")

    payload = runners_service.runner_payload(
        runner,
        engines=engines_service.engines_of_runner(session, runner.id),
        live={"transport": "websocket", "busy": 2, "streams": 1, "free_slots": 1},
    )

    assert payload["connected"] is True
    assert payload["transport"] == "websocket"
    assert (payload["busy"], payload["streams"], payload["free_slots"]) == (2, 1, 1)
    assert payload["engines"][0]["name"] == "sf-remote"
    assert payload["engines"][0]["streams"] is True
    assert payload["last_seen_at"] is not None


def test_a_runner_nobody_has_dialled_in_for_reads_as_idle(session: Session) -> None:
    runner, _token = runners_service.create_runner(session, "gpu-box")

    payload = runners_service.runner_payload(runner, engines=[])

    assert payload["transport"] is None
    assert (payload["busy"], payload["free_slots"], payload["engines"]) == (0, 0, [])


def test_maia_is_never_offered_as_a_stream(session: Session) -> None:
    runner, _token = runners_service.create_runner(session, "gpu-box")
    engines_service.sync_runner_engines(session, runner, [_ad("maia-remote", kind="maia")])

    payload = runners_service.engine_payload(
        engines_service.engines_of_runner(session, runner.id)[0]
    )

    assert (payload["kind"], payload["streams"]) == ("maia", False)


def test_a_runner_that_advertises_no_streams_is_taken_at_its_word(session: Session) -> None:
    """The flag is the host's answer, not an inference from its kind.

    A browser tab runs `run_dispatch` and answers no `stream_open`, and it says so. Reading
    `kind == "uci"` here instead is what let the analysis-board picker offer it and then
    wait forever for a `stream_started`.
    """
    runner, _token = runners_service.create_runner(session, "this browser")
    engines_service.sync_runner_engines(
        session, runner, [_ad("wasm-sf", path="wasm:stockfish-18", streams=False)]
    )
    engine = engines_service.engines_of_runner(session, runner.id)[0]

    payload = runners_service.engine_payload(engine)

    assert engine.streams is False
    assert (payload["kind"], payload["streams"]) == ("uci", False)


def test_a_runner_that_learns_to_stream_is_taken_at_its_word_too(session: Session) -> None:
    """The row is overwritten from the advertisement, so an upgraded tab is offered boards."""
    runner, _token = runners_service.create_runner(session, "this browser")
    engines_service.sync_runner_engines(
        session, runner, [_ad("wasm-sf", path="wasm:stockfish-18", streams=False)]
    )

    engines_service.sync_runner_engines(
        session, runner, [_ad("wasm-sf", path="wasm:stockfish-18", streams=True)]
    )
    engine = engines_service.engines_of_runner(session, runner.id)[0]

    assert engine.streams is True
    assert runners_service.engine_payload(engine)["streams"] is True


def test_an_engine_on_this_host_advertises_nothing_and_drives_a_board(session: Session) -> None:
    """Nothing advertises for a local binary, so the column's default is the whole answer."""
    engine = _local_engine(session)

    assert engine.streams is True
    assert runners_service.engine_payload(engine)["streams"] is True


def test_the_breakdown_says_where_the_backlog_will_be_worked(session: Session) -> None:
    local = _local_engine(session)
    runner, _token = runners_service.create_runner(session, "gpu-box", slots=4)
    runners_service.mark_connected(session, runner)
    engines_service.sync_runner_engines(session, runner, [_ad()])
    remote = engines_service.engines_of_runner(session, runner.id)[0]
    orphan = _local_engine(session, "retired", enabled=False)

    _run(session, local.id, RunStatus.QUEUED)
    _run(session, local.id, RunStatus.RUNNING)
    _run(session, remote.id, RunStatus.QUEUED)
    _run(session, remote.id, RunStatus.QUEUED)
    _run(session, remote.id, RunStatus.RUNNING)
    _run(session, None, RunStatus.QUEUED)
    _run(session, orphan.id, RunStatus.QUEUED)
    _run(session, local.id, RunStatus.DONE)

    breakdown = runners_service.queue_breakdown(session)

    # A run with no engine, and one whose engine is switched off, count as local: that is
    # where `_prepare`'s fallback will send them.
    assert breakdown[0] == {
        "destination": "local",
        "runner_id": None,
        "name": "local",
        "connected": True,
        "slots": None,
        "queued": 3,
        "running": 1,
    }
    assert breakdown[1] == {
        "destination": "runner",
        "runner_id": runner.id,
        "name": "gpu-box",
        "connected": True,
        "slots": 4,
        "queued": 2,
        "running": 1,
    }


def test_an_empty_queue_still_names_every_destination(session: Session) -> None:
    runners_service.create_runner(session, "gpu-box")

    breakdown = runners_service.queue_breakdown(session)

    assert [entry["name"] for entry in breakdown] == ["local", "gpu-box"]
    assert all(entry["queued"] == 0 and entry["running"] == 0 for entry in breakdown)


def test_a_listed_runner_carries_the_backlog_only_it_can_do(session: Session) -> None:
    local = _local_engine(session)
    runner, _token = runners_service.create_runner(session, "gpu-box", slots=4)
    runners_service.mark_connected(session, runner)
    engines_service.sync_runner_engines(session, runner, [_ad()])
    remote = engines_service.engines_of_runner(session, runner.id)[0]
    _run(session, remote.id, RunStatus.QUEUED)
    _run(session, remote.id, RunStatus.RUNNING)
    _run(session, local.id, RunStatus.QUEUED)

    rows = runners_service.runner_rows(
        session, live={runner.id: {"transport": "poll", "busy": 1, "free_slots": 3}}
    )

    assert len(rows) == 1
    assert rows[0]["queued_eligible"] == 1, "the local run is nobody else's business"
    assert (rows[0]["transport"], rows[0]["busy"], rows[0]["free_slots"]) == ("poll", 1, 3)


def test_the_status_read_puts_this_host_beside_the_runners(session: Session) -> None:
    local = _local_engine(session)
    runner, _token = runners_service.create_runner(session, "gpu-box", slots=4)
    engines_service.sync_runner_engines(session, runner, [_ad()])
    _run(session, local.id, RunStatus.QUEUED)
    _run(session, None, RunStatus.RUNNING)

    payload = runners_service.status_payload(
        session, local={"slots": 6, "busy": 1, "streams": 0, "workers": True}
    )

    assert payload["queue"] == {"queued": 1, "running": 1}
    assert payload["local"]["slots"] == 6
    assert payload["local"]["workers"] is True
    assert (payload["local"]["queued"], payload["local"]["running"]) == (1, 1)
    assert [engine["name"] for engine in payload["local"]["engines"]] == ["stockfish"]
    # A runner nobody is holding a link for still reads as itself, from the row alone.
    assert payload["runners"][0]["name"] == "gpu-box"
    assert payload["runners"][0]["connected"] is False
    assert [engine["name"] for engine in payload["runners"][0]["engines"]] == ["sf-remote"]


def test_a_destination_says_what_is_holding_its_slots(session: Session) -> None:
    runner, _token = runners_service.create_runner(session, "gpu-box", slots=4)
    runners_service.mark_connected(session, runner)
    engines_service.sync_runner_engines(session, runner, [_ad()])
    remote = engines_service.engines_of_runner(session, runner.id)[0]
    _run(session, remote.id, RunStatus.QUEUED)

    destinations = runners_service.queue_destinations(
        session,
        live={runner.id: {"busy": 2, "streams": 1}},
        local={"slots": 6, "streams": 2},
    )

    assert destinations[0]["slots"] == 6, "the local cap is the caller's to supply"
    assert destinations[0]["streams"] == 2
    assert destinations[1]["name"] == "gpu-box"
    assert (destinations[1]["queued"], destinations[1]["streams"]) == (1, 1)


def test_the_handed_over_yaml_is_a_runner_config(session: Session) -> None:
    runner, token = runners_service.create_runner(session, "gpu-box", slots=4)

    parsed = yaml.safe_load(
        runners_service.config_yaml(runner, token, server_url="https://blunderbase.example.com")
    )

    assert parsed["server"] == "https://blunderbase.example.com"
    assert parsed["token"] == token
    assert parsed["name"] == "gpu-box"
    assert parsed["slots"] == 4
    assert parsed["engines"][0]["name"] == "sf-remote"


def test_a_name_yaml_would_choke_on_survives_the_snippet(session: Session) -> None:
    runner, token = runners_service.create_runner(session, "gpu: box #1")

    parsed = yaml.safe_load(runners_service.config_yaml(runner, token, server_url="http://x"))

    assert parsed["name"] == "gpu: box #1"


# --- advertised engines ---------------------------------------------------


def test_an_advertisement_becomes_an_engine_row(session: Session) -> None:
    runner, _token = runners_service.create_runner(session, "gpu-box")

    accepted = engines_service.sync_runner_engines(session, runner, [_ad()])

    assert [entry.accepted for entry in accepted] == [True]
    engine = session.get(Engine, accepted[0].engine_id)
    assert engine.name == "sf-remote"
    assert engine.runner_id == runner.id
    assert engine.kind is EngineKind.UCI
    assert engine.path == "/usr/games/stockfish"
    assert engine.version == "Stockfish 17"
    assert engine.options == {"Threads": 8}
    assert engine.enabled is True
    # The ad's `tier: deep` is accepted and ignored — a runner cannot claim a job — but a
    # role nobody had filled goes to the first engine that fits it.
    assert engines_service.engine_for_tier(session, Tier.QUICK).id == engine.id
    assert engines_service.engine_for_tier(session, Tier.DEEP).id == engine.id


def test_re_advertising_updates_the_row_rather_than_adding_one(session: Session) -> None:
    runner, _token = runners_service.create_runner(session, "gpu-box")
    first = engines_service.sync_runner_engines(session, runner, [_ad()])

    again = engines_service.sync_runner_engines(
        session, runner, [_ad(path="/opt/stockfish", tier="quick", options={"Threads": 2})]
    )

    assert again[0].engine_id == first[0].engine_id
    engine = session.get(Engine, again[0].engine_id)
    assert (engine.path, engine.options) == ("/opt/stockfish", {"Threads": 2})


def test_an_engine_the_runner_stops_advertising_is_disabled_not_deleted(
    session: Session,
) -> None:
    runner, _token = runners_service.create_runner(session, "gpu-box")
    accepted = engines_service.sync_runner_engines(session, runner, [_ad(), _ad("spare")])

    engines_service.sync_runner_engines(session, runner, [_ad()])

    spare = session.get(Engine, accepted[1].engine_id)
    assert spare is not None
    assert spare.enabled is False
    assert session.get(Engine, accepted[0].engine_id).enabled is True


def test_a_re_advertised_engine_comes_back(session: Session) -> None:
    runner, _token = runners_service.create_runner(session, "gpu-box")
    engines_service.sync_runner_engines(session, runner, [_ad()])
    runners_service.mark_disconnected(session, runner.id)

    engines_service.sync_runner_engines(session, runner, [_ad()])

    assert engines_service.engines_of_runner(session, runner.id)[0].enabled is True


def test_a_name_this_host_already_uses_is_refused_with_a_reason(session: Session) -> None:
    _local_engine(session, "stockfish")
    runner, _token = runners_service.create_runner(session, "gpu-box")

    accepted = engines_service.sync_runner_engines(session, runner, [_ad("stockfish")])

    assert accepted[0].accepted is False
    assert accepted[0].engine_id is None
    assert "already registered on this host" in accepted[0].reason
    assert session.scalars(select(Engine).where(Engine.name == "stockfish")).one().runner_id is None


def test_a_name_another_runner_uses_is_refused_with_a_reason(session: Session) -> None:
    first, _one = runners_service.create_runner(session, "gpu-box")
    second, _two = runners_service.create_runner(session, "laptop")
    engines_service.sync_runner_engines(session, first, [_ad()])

    accepted = engines_service.sync_runner_engines(session, second, [_ad()])

    assert accepted[0].accepted is False
    assert "another runner" in accepted[0].reason


def test_an_option_the_engine_never_declared_is_a_rejected_engine(session: Session) -> None:
    """Not a run that fails on another machine an hour later."""
    runner, _token = runners_service.create_runner(session, "gpu-box")

    accepted = engines_service.sync_runner_engines(
        session, runner, [_ad(options={"Threads": 8, "Hash": 4096})]
    )

    assert accepted[0].accepted is False
    assert "Hash" in accepted[0].reason
    assert engines_service.engines_of_runner(session, runner.id) == []


def test_an_option_the_engine_will_not_take_is_a_rejected_engine(session: Session) -> None:
    runner, _token = runners_service.create_runner(session, "gpu-box")

    accepted = engines_service.sync_runner_engines(
        session, runner, [_ad(options={"Threads": 4096})]
    )

    assert accepted[0].accepted is False
    assert accepted[0].reason


def test_a_runner_s_engine_row_cannot_be_edited_on_this_host(session: Session) -> None:
    """`update_engine` re-probes — that is, *starts* — the path in the row when the options
    change, and the path in this row was written by another machine."""
    runner, _token = runners_service.create_runner(session, "gpu-box")
    accepted = engines_service.sync_runner_engines(
        session, runner, [_ad(path="/bin/sh -c 'touch pwned'")]
    )
    started: list[str] = []

    def probe(path: str, **_kwargs: Any) -> Any:
        started.append(path)
        raise AssertionError("a path from a runner must never be started here")

    with pytest.raises(engines_service.EngineValidationError, match="edited there"):
        engines_service.update_engine(
            session, accepted[0].engine_id, options={"Threads": 4}, probe=probe
        )

    assert started == []
    assert session.get(Engine, accepted[0].engine_id).options == {"Threads": 8}


def test_one_rejected_engine_does_not_take_the_others_with_it(session: Session) -> None:
    _local_engine(session, "stockfish")
    runner, _token = runners_service.create_runner(session, "gpu-box")

    accepted = engines_service.sync_runner_engines(session, runner, [_ad("stockfish"), _ad()])

    assert [entry.accepted for entry in accepted] == [False, True]
    assert [engine.name for engine in engines_service.engines_of_runner(session, runner.id)] == [
        "sf-remote"
    ]


# --- which host an engine is on -------------------------------------------


def test_local_and_remote_engines_are_told_apart(session: Session) -> None:
    local = _local_engine(session)
    disabled = _local_engine(session, "retired", enabled=False)
    runner, _token = runners_service.create_runner(session, "gpu-box")
    accepted = engines_service.sync_runner_engines(session, runner, [_ad()])
    remote_id = accepted[0].engine_id

    assert engines_service.local_engine_ids(session) == [local.id]
    assert engines_service.local_engine_ids(session, enabled_only=False) == [
        local.id,
        disabled.id,
    ]
    assert engines_service.remote_engine_ids(session) == [remote_id]
    assert engines_service.runner_engine_ids(session, runner.id) == [remote_id]


def test_a_switched_off_remote_engine_is_still_not_this_hosts_work(session: Session) -> None:
    """`remote_engine_ids` is what the local worker excludes itself from claiming; a
    disabled remote engine must not fall back into the local half of the queue."""
    runner, _token = runners_service.create_runner(session, "gpu-box")
    accepted = engines_service.sync_runner_engines(session, runner, [_ad()])
    engines_service.disable_runner_engines(session, runner.id)

    assert engines_service.remote_engine_ids(session) == [accepted[0].engine_id]
    assert engines_service.runner_engine_ids(session, runner.id) == []


def test_a_local_only_ask_never_reaches_for_a_remote_binary(session: Session) -> None:
    """And never substitutes: the assigned engine being elsewhere is no engine here."""
    _local_engine(session, "stockfish")
    runner, _token = runners_service.create_runner(session, "gpu-box")
    accepted = engines_service.sync_runner_engines(session, runner, [_ad()])
    engines_service.set_role_engine(session, EngineRole.DEEP, accepted[0].engine_id)

    assert engines_service.engine_for_tier(session, Tier.DEEP).name == "sf-remote"
    assert engines_service.engine_for_tier(session, Tier.DEEP, local_only=True) is None


def test_a_first_time_runners_engine_fills_a_role_nobody_has_filled(session: Session) -> None:
    """What keeps a deployment whose only engine arrived over the wire able to run one."""
    runner, _token = runners_service.create_runner(session, "gpu-box")

    accepted = engines_service.sync_runner_engines(session, runner, [_ad(), _ad("spare")])

    assert engines_service.engine_for_tier(session, Tier.QUICK).id == accepted[0].engine_id
    assert engines_service.engine_for_tier(session, Tier.DEEP).id == accepted[0].engine_id


def test_a_re_advertised_engine_does_not_refill_a_role_the_owner_emptied(
    session: Session,
) -> None:
    runner, _token = runners_service.create_runner(session, "gpu-box")
    engines_service.sync_runner_engines(session, runner, [_ad()])
    engines_service.set_role_engine(session, EngineRole.DEEP, None)

    engines_service.sync_runner_engines(session, runner, [_ad()])

    assert engines_service.engine_for_tier(session, Tier.DEEP) is None


def test_the_maia_a_host_uses_is_the_one_the_owner_chose(session: Session) -> None:
    """One model is chosen for the whole deployment, and only its own host answers with it."""
    local_maia = _local_engine(session, "maia", kind=EngineKind.MAIA)
    runner, _token = runners_service.create_runner(session, "gpu-box")
    accepted = engines_service.sync_runner_engines(
        session, runner, [_ad("maia-remote", kind="maia", tier=None)]
    )

    assert engines_service.maia_engine_for_host(session, None).id == local_maia.id
    assert engines_service.maia_engine_for_host(session, runner.id) is None

    engines_service.set_role_engine(session, EngineRole.HUMAN, accepted[0].engine_id)

    assert engines_service.maia_engine_for_host(session, None) is None
    assert engines_service.maia_engine_for_host(session, runner.id).id == accepted[0].engine_id


def test_a_host_without_maia_simply_has_none(session: Session) -> None:
    _local_engine(session, "maia", kind=EngineKind.MAIA)
    runner, _token = runners_service.create_runner(session, "gpu-box")
    engines_service.sync_runner_engines(session, runner, [_ad()])

    assert engines_service.maia_engine_for_host(session, runner.id) is None


def test_a_tier_on_a_runner_that_is_not_connected_is_unavailable(session: Session) -> None:
    runner, _token = runners_service.create_runner(session, "gpu-box")
    engines_service.sync_runner_engines(session, runner, [_ad()])

    status = engines_service.tier_status(session, Tier.DEEP)

    assert status.available is False
    assert "not connected" in status.reason
    assert status.engine_name == "sf-remote"


def test_a_tier_on_a_connected_runner_is_available_without_a_binary_here(
    session: Session,
) -> None:
    """`binary_present` is meaningless for a path on another machine."""
    runner, _token = runners_service.create_runner(session, "gpu-box")
    engines_service.sync_runner_engines(session, runner, [_ad(path="/nowhere/at/all")])
    runners_service.mark_connected(session, runner)

    assert engines_service.tier_status(session, Tier.DEEP).available is True


def test_a_run_bound_to_a_runners_engine_is_left_for_that_runner(session: Session) -> None:
    _local_engine(session)
    runner, _token = runners_service.create_runner(session, "gpu-box")
    accepted = engines_service.sync_runner_engines(session, runner, [_ad()])
    remote_id = accepted[0].engine_id
    _run(session, remote_id, RunStatus.QUEUED)

    excluded = engines_service.remote_engine_ids(session)

    assert analysis.claim_next_run(session, exclude_engine_ids=excluded) is None
    claimed = analysis.claim_next_run(session, engine_ids=[remote_id])
    assert claimed is not None
    assert claimed.engine_id == remote_id

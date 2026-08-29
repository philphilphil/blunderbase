"""Engine management: probe on add, honest options, and a tier that degrades."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fake_uci import MAIA_OPTIONS, STOCKFISH_OPTIONS, fake_engine_command
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.db.enums import EngineKind, EngineRole, RunStatus, Tier
from backend.db.models import AnalysisRun, Engine, MoveEval, Runner
from backend.services.engines import (
    DuplicateEngineError,
    EngineOptionError,
    EngineProbeError,
    EngineRunError,
    EngineValidationError,
    TierUnavailableError,
    UnknownEngineError,
    add_engine,
    binary_present,
    delete_engine,
    engine_for_tier,
    get_engine,
    is_binary_path,
    list_engines,
    maia_status,
    path_scheme,
    probe_engine,
    role_status,
    sample_eval,
    set_role_engine,
    spec_for,
    tier_status,
    update_engine,
    validate_options,
)

FRENCH = "rnbqkbnr/pppp1ppp/4p3/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2"


@pytest.fixture()
def stockfish_path(tmp_path: Path) -> str:
    return fake_engine_command(
        tmp_path,
        name="FakeFish 17",
        options=STOCKFISH_OPTIONS,
        go_default={
            "info": [
                "depth 16 multipv 1 score cp 28 nodes 90210 pv e2e4 d7d5",
                "depth 16 multipv 2 score cp 12 nodes 90210 pv d2d4 d7d5",
            ],
            "bestmove": "e2e4",
        },
    )


@pytest.fixture()
def maia_path(tmp_path: Path) -> str:
    return fake_engine_command(
        tmp_path,
        name="lc0 maia-1500",
        options=MAIA_OPTIONS,
        go_default={
            "info": [
                "string e2e4  (322 ) N: 0 (+ 0) (P: 41.00%)",
                "depth 1 multipv 1 score cp 20 pv e2e4",
            ],
            "bestmove": "e2e4",
        },
    )


def register(session: Session, path: str, **kwargs: Any) -> Engine:
    kwargs.setdefault("name", "Stockfish")
    return add_engine(session, path=path, **kwargs)


# --- registering ----------------------------------------------------------


def test_a_registered_engine_keeps_what_the_probe_found(
    session: Session, stockfish_path: str
) -> None:
    engine = register(session, stockfish_path, options={"Threads": 2})

    assert engine.id is not None
    assert engine.version == "FakeFish 17"
    assert engine.kind is EngineKind.UCI
    assert engine.options == {"Threads": 2}
    assert engine.enabled is True
    assert list_engines(session) == [engine]
    assert get_engine(session, engine.id) is engine


def test_a_binary_that_is_not_an_engine_is_rejected_at_setup_time(tmp_path: Path) -> None:
    """The whole point of probing on add: the owner hears about it in Settings, not three
    days later when an analysis run fails."""
    path = fake_engine_command(tmp_path, exit_before_uciok=True)

    with pytest.raises(EngineProbeError):
        probe_engine(path)


def test_a_missing_binary_is_rejected_at_setup_time(session: Session, tmp_path: Path) -> None:
    with pytest.raises(EngineProbeError) as caught:
        register(session, str(tmp_path / "stockfish"))

    assert "could not be started" in str(caught.value) or "not a usable" in str(caught.value)
    assert list_engines(session) == []


def test_two_engines_cannot_share_a_name(session: Session, stockfish_path: str) -> None:
    register(session, stockfish_path)

    with pytest.raises(DuplicateEngineError):
        register(session, stockfish_path)


def test_an_engine_needs_a_name_and_a_path(session: Session, stockfish_path: str) -> None:
    with pytest.raises(EngineValidationError):
        add_engine(session, name="  ", path=stockfish_path)
    with pytest.raises(EngineValidationError):
        add_engine(session, name="Stockfish", path="  ")


def test_the_probe_is_the_one_thing_a_test_can_stand_in_for(session: Session) -> None:
    from backend.adapters.stockfish import EngineProbe, UciOption

    probed = EngineProbe(name="Pretend 1", options=(UciOption("Threads", "spin", 1, 1, 8),))
    engine = add_engine(
        session,
        name="Pretend",
        path="/nowhere/pretend",
        options={"Threads": 4},
        probe=lambda path, timeout: probed,
    )

    assert engine.version == "Pretend 1"
    assert engine.options == {"Threads": 4}


# --- options --------------------------------------------------------------


def test_an_option_the_engine_never_declared_is_refused(
    session: Session, stockfish_path: str
) -> None:
    with pytest.raises(EngineOptionError) as caught:
        register(session, stockfish_path, options={"Threadz": 2})

    assert "Threadz" in str(caught.value)
    assert "Threads" in str(caught.value)  # the message says what is on offer
    assert list_engines(session) == []


def test_a_value_is_coerced_to_the_type_the_engine_declared(
    session: Session, stockfish_path: str
) -> None:
    engine = register(
        session,
        stockfish_path,
        options={"threads": "4", "UCI_ShowWDL": "true", "Style": "wild"},
    )

    # Stored under the engine's own spelling, as the type it declared.
    assert engine.options == {"Threads": 4, "UCI_ShowWDL": True, "Style": "wild"}


def test_a_value_outside_the_declared_range_is_refused(
    session: Session, stockfish_path: str
) -> None:
    with pytest.raises(EngineOptionError):
        register(session, stockfish_path, options={"Threads": 99})


def test_a_value_outside_a_declared_combo_is_refused(session: Session, stockfish_path: str) -> None:
    with pytest.raises(EngineOptionError):
        register(session, stockfish_path, options={"Style": "reckless"})


def test_an_option_the_analysis_sets_itself_cannot_be_stored(
    session: Session, stockfish_path: str
) -> None:
    """MultiPV is per run, and python-chess overwrites it on every call, so storing a value
    for it would be a setting that silently does nothing."""
    with pytest.raises(EngineOptionError):
        register(session, stockfish_path, options={"MultiPV": 3})


def test_validating_needs_no_database(stockfish_path: str) -> None:
    probed = probe_engine(stockfish_path)

    assert validate_options(probed, {"Hash": "64"}) == {"Hash": 64}
    assert validate_options(probed, None) == {}


# --- editing --------------------------------------------------------------


def test_renaming_and_disabling_do_not_need_the_binary(
    session: Session, stockfish_path: str
) -> None:
    """An engine whose binary has gone missing must still be renamable and switchable off."""
    engine = register(session, stockfish_path)

    def refuse(*_: Any, **__: Any) -> Any:
        raise AssertionError("the binary must not be probed for a rename")

    updated = update_engine(session, engine.id, name="Old Stockfish", enabled=False, probe=refuse)

    assert (updated.name, updated.enabled) == ("Old Stockfish", False)


def test_which_role_an_engine_serves_is_not_a_field_of_the_engine(
    session: Session, stockfish_path: str
) -> None:
    """It is the owner's assignment, written by `set_role_engine` and nothing else."""
    engine = register(session, stockfish_path)

    with pytest.raises(EngineValidationError, match="cannot change default_tier"):
        update_engine(session, engine.id, default_tier="deep")


def test_editing_the_options_validates_them_against_the_engine(
    session: Session, stockfish_path: str
) -> None:
    engine = register(session, stockfish_path, options={"Threads": 2})

    updated = update_engine(session, engine.id, options={"Hash": "128"})
    assert updated.options == {"Hash": 128}

    with pytest.raises(EngineOptionError):
        update_engine(session, engine.id, options={"Hash": 99999})
    session.rollback()
    assert get_engine(session, engine.id).options == {"Hash": 128}


def test_a_new_path_is_probed_and_the_stored_options_are_rechecked(
    session: Session, stockfish_path: str, maia_path: str
) -> None:
    engine = register(session, stockfish_path, options={"Threads": 2})

    with pytest.raises(EngineOptionError):
        # The Maia build declares no Threads, so the stored value cannot survive the move.
        update_engine(session, engine.id, path=maia_path)
    session.rollback()

    assert get_engine(session, engine.id).path == stockfish_path


def test_a_field_that_is_not_editable_is_refused(session: Session, stockfish_path: str) -> None:
    engine = register(session, stockfish_path)

    with pytest.raises(EngineValidationError):
        update_engine(session, engine.id, version="made up")


def test_a_rename_onto_another_engines_name_is_refused(
    session: Session, stockfish_path: str
) -> None:
    first = register(session, stockfish_path, name="One")
    register(session, stockfish_path, name="Two")

    with pytest.raises(DuplicateEngineError):
        update_engine(session, first.id, name="Two")


def test_editing_an_engine_that_is_not_there(session: Session) -> None:
    with pytest.raises(UnknownEngineError):
        update_engine(session, 4242, name="ghost")


# --- deleting -------------------------------------------------------------


def test_deleting_an_engine_leaves_its_runs_behind_without_it(
    session: Session, stockfish_path: str
) -> None:
    engine = register(session, stockfish_path)
    run = AnalysisRun(tier=Tier.QUICK, engine_id=engine.id, status=RunStatus.DONE)
    session.add(run)
    session.commit()

    assert delete_engine(session, engine.id) == (True, 0)

    session.refresh(run)
    assert run.engine_id is None
    assert list_engines(session) == []


def test_deleting_an_engine_drops_its_queued_runs_but_keeps_the_rest(
    session: Session, stockfish_path: str
) -> None:
    engine = register(session, stockfish_path)
    queued = AnalysisRun(tier=Tier.QUICK, engine_id=engine.id, status=RunStatus.QUEUED)
    done = AnalysisRun(tier=Tier.QUICK, engine_id=engine.id, status=RunStatus.DONE)
    session.add_all([queued, done])
    session.commit()
    session.add(MoveEval(run_id=done.id, ply=0, move_uci="e2e4", move_san="e4"))
    session.commit()
    queued_id, done_id = queued.id, done.id

    assert delete_engine(session, engine.id) == (True, 1)

    assert session.get(AnalysisRun, queued_id) is None
    session.refresh(done)
    assert done.engine_id is None
    assert len(session.scalars(select(MoveEval).where(MoveEval.run_id == done_id)).all()) == 1


def test_deleting_an_engine_that_is_not_there_says_so(session: Session) -> None:
    assert delete_engine(session, 4242) == (False, 0)


# --- the roles ------------------------------------------------------------
#
# The owner assigns one engine to each of Quick, Deep and Human moves. Nothing falls back:
# a role whose engine cannot run does not run, and says which engine and why.


def test_a_tier_uses_the_engine_it_is_assigned(session: Session, stockfish_path: str) -> None:
    register(session, stockfish_path, name="Quick")
    deep = register(session, stockfish_path, name="Deep")
    set_role_engine(session, EngineRole.DEEP, deep.id)

    assert engine_for_tier(session, Tier.DEEP) is deep
    assert tier_status(session, Tier.DEEP).engine_name == "Deep"


def test_the_first_engine_registered_takes_the_roles_it_fits(
    session: Session, stockfish_path: str, maia_path: str
) -> None:
    """A fresh install runs without a visit to the roles form — and a later engine, which
    the owner may have added for something else entirely, steals nothing."""
    first = register(session, stockfish_path, name="First")
    model = register(session, maia_path, name="maia3", kind=EngineKind.MAIA)
    register(session, stockfish_path, name="Second")

    assert engine_for_tier(session, Tier.QUICK) is first
    assert engine_for_tier(session, Tier.DEEP) is first
    assert role_status(session, EngineRole.HUMAN).engine_id == model.id


def test_a_disabled_engine_is_not_used_and_nothing_stands_in_for_it(
    session: Session, stockfish_path: str
) -> None:
    engine = register(session, stockfish_path)
    register(session, stockfish_path, name="Spare")
    update_engine(session, engine.id, enabled=False)

    assert engine_for_tier(session, Tier.QUICK) is None
    status = tier_status(session, Tier.QUICK)
    assert status.available is False
    assert status.engine_id == engine.id
    assert "'Stockfish' is assigned to the quick tier and is switched off" in (status.reason or "")


def test_a_role_refuses_an_engine_of_a_kind_it_cannot_use(
    session: Session, stockfish_path: str, maia_path: str
) -> None:
    search = register(session, stockfish_path)
    model = register(session, maia_path, name="maia3", kind=EngineKind.MAIA)

    with pytest.raises(EngineValidationError, match="needs a UCI engine"):
        set_role_engine(session, EngineRole.DEEP, model.id)
    with pytest.raises(EngineValidationError, match="needs a human-move model"):
        set_role_engine(session, EngineRole.HUMAN, search.id)
    with pytest.raises(EngineValidationError, match="no engine with id"):
        set_role_engine(session, EngineRole.QUICK, 4242)


def test_deleting_an_engine_unassigns_the_roles_it_held(
    session: Session, stockfish_path: str
) -> None:
    engine = register(session, stockfish_path)

    delete_engine(session, engine.id)

    status = role_status(session, EngineRole.QUICK)
    assert status.configured is False
    assert status.engine_id is None
    assert "no engine is assigned" in (status.reason or "")


def test_a_maia_engine_never_stands_in_for_an_evaluation(session: Session, maia_path: str) -> None:
    register(session, maia_path, name="Maia 1500", kind=EngineKind.MAIA)

    assert engine_for_tier(session, Tier.QUICK) is None


def test_no_engines_at_all_is_a_reason_not_a_crash(session: Session) -> None:
    status = tier_status(session, Tier.QUICK)

    assert status.available is False
    assert status.engine_id is None
    assert "no engine is assigned to the quick tier" in (status.reason or "")
    assert status.as_dict()["tier"] == "quick"


def test_an_engine_whose_binary_has_gone_missing_degrades_its_tier(
    session: Session, stockfish_path: str, tmp_path: Path
) -> None:
    engine = register(session, stockfish_path)
    engine.path = str(tmp_path / "moved-away")
    session.commit()

    status = tier_status(session, Tier.QUICK)
    assert status.available is False
    assert status.engine_id == engine.id
    assert "no longer at" in (status.reason or "")


def test_a_caller_that_needs_an_engine_gets_a_typed_condition(session: Session) -> None:
    from backend.services import engines as engine_service

    with pytest.raises(TierUnavailableError) as caught:
        engine_service.require_engine_for_tier(session, Tier.DEEP)

    assert caught.value.tier is Tier.DEEP
    assert caught.value.reason


def test_a_caller_that_needs_an_engine_gets_it_when_there_is_one(
    session: Session, stockfish_path: str
) -> None:
    from backend.services import engines as engine_service

    engine = register(session, stockfish_path)

    assert engine_service.require_engine_for_tier(session, Tier.QUICK) is engine


# --- the human-move role --------------------------------------------------
#
# Beside the tiers, never inside them: `Tier` is a search budget stored on every run row,
# and Maia searches nothing. A deployment with no model at all is a shape, not a fault.


def test_the_human_move_role_names_the_model_this_host_reaches_for(
    session: Session, maia_path: str
) -> None:
    model = register(session, maia_path, name="maia3", kind=EngineKind.MAIA)

    status = maia_status(session)
    assert status.available is True
    assert status.configured is True
    assert status.engine_id == model.id
    assert status.engine_name == "maia3"
    assert status.reason is None
    assert status.as_dict()["engine_name"] == "maia3"


def test_the_assigned_model_is_the_one_and_a_second_never_takes_over(
    session: Session, maia_path: str
) -> None:
    """Switching the chosen model off does not promote the spare: the role is the owner's
    choice, and a run answering at a level nobody picked is exactly what that prevents."""
    first = register(session, maia_path, name="maia3", kind=EngineKind.MAIA)
    register(session, maia_path, name="maia5", kind=EngineKind.MAIA)

    assert maia_status(session).engine_id == first.id

    update_engine(session, first.id, enabled=False)
    status = maia_status(session)
    assert status.engine_name == "maia3"
    assert status.available is False
    assert "switched off" in (status.reason or "")


def test_no_model_at_all_is_a_shape_rather_than_a_fault(
    session: Session, stockfish_path: str
) -> None:
    register(session, stockfish_path)

    status = maia_status(session)
    assert status.available is False
    # The flag the UI reads to keep this calm rather than red.
    assert status.configured is False
    assert status.engine_id is None
    assert "no engine is assigned to human moves" in (status.reason or "")


def test_a_model_that_is_switched_off_says_so(session: Session, maia_path: str) -> None:
    model = register(session, maia_path, name="maia3", kind=EngineKind.MAIA)
    update_engine(session, model.id, enabled=False)

    status = maia_status(session)
    assert status.available is False
    assert status.configured is True, "there is a model; it is off"
    assert "switched off" in (status.reason or "")


def test_a_model_whose_network_has_gone_missing_degrades_the_role(
    session: Session, maia_path: str, tmp_path: Path
) -> None:
    model = register(session, maia_path, name="maia3", kind=EngineKind.MAIA)
    model.path = str(tmp_path / "moved-away")
    session.commit()

    status = maia_status(session)
    assert status.available is False
    assert status.configured is True
    assert status.engine_id == model.id
    assert "no longer at" in (status.reason or "")


def test_a_model_that_only_lives_on_a_runner_is_named_with_where_it_is(
    session: Session, maia_path: str
) -> None:
    """It is doing real work — every run dispatched to that machine gets its Maia pass — so
    "no human-move model" would be a lie to an owner looking straight at one."""
    runner = Runner(name="gpu-box", token_hash="x" * 64, slots=2)
    session.add(runner)
    session.flush()
    model = register(session, maia_path, name="maia3", kind=EngineKind.MAIA)
    model.runner_id = runner.id
    session.commit()

    status = maia_status(session)
    assert status.available is False, "the pass cannot run for work started here"
    assert status.configured is True
    assert status.engine_name == "maia3"
    assert "gpu-box" in (status.reason or "")


def test_a_stored_path_is_checked_without_starting_anything(
    stockfish_path: str, tmp_path: Path
) -> None:
    assert binary_present(stockfish_path) is True
    assert binary_present(str(tmp_path / "nope")) is False
    assert binary_present("   ") is False


# --- an engine that is not a file on a disk --------------------------------
#
# A browser tab advertises the WASM build it loads inside itself, and spells it with a
# scheme. Nothing on this host may stat it, split it or start it.


def test_a_scheme_says_the_path_is_not_a_file(tmp_path: Path) -> None:
    assert path_scheme("wasm:stockfish-18") == "wasm"
    assert path_scheme("  WASM:stockfish-18  ") == "wasm", "a scheme is not case-sensitive"
    assert is_binary_path("wasm:stockfish-18") is False

    assert path_scheme(str(tmp_path / "stockfish")) is None
    assert path_scheme("lc0 --weights=maia-1500.pb.gz") is None
    assert path_scheme(r"C:\engines\stockfish.exe") is None, "a drive letter is not a scheme"
    assert path_scheme("wasm:") is None, "a scheme naming nothing names no engine"
    assert path_scheme("ftp://elsewhere/stockfish") is None, "only the schemes we know count"
    assert is_binary_path(str(tmp_path / "stockfish")) is True


def test_nothing_goes_looking_for_an_engine_that_is_not_a_file(session: Session) -> None:
    """Each of the four questions a path is asked, answered without touching a filesystem."""
    assert binary_present("wasm:stockfish-18") is False

    with pytest.raises(EngineProbeError, match="lives inside a runner"):
        probe_engine("wasm:stockfish-18")

    engine = Engine(name="wasm-sf", kind=EngineKind.UCI, path="wasm:stockfish-18")
    session.add(engine)
    session.commit()

    with pytest.raises(EngineRunError, match="not a binary on this host"):
        spec_for(engine)
    with pytest.raises(EngineRunError, match="not a binary anywhere"):
        sample_eval(session, engine.id)


def test_the_adapter_refuses_to_build_a_command_for_one(tmp_path: Path) -> None:
    """`command_for` is the last gate: no `shlex.split`, no `popen`, no `ENOENT`."""
    from backend.adapters.stockfish import EngineStartError, command_for

    with pytest.raises(EngineStartError, match="does not name a binary"):
        command_for("wasm:stockfish-18")

    binary = tmp_path / "stockfish"
    binary.write_text("")
    assert command_for(str(binary)) == [str(binary)]


def test_a_scheme_path_cannot_be_registered_as_a_local_engine(session: Session) -> None:
    """`add_engine` probes, and there is nothing here to probe."""
    with pytest.raises(EngineProbeError, match="lives inside a runner"):
        add_engine(session, name="wasm-sf", path="wasm:stockfish-18")


# --- the pool key ---------------------------------------------------------


def test_an_engine_row_becomes_a_pool_spec(session: Session, stockfish_path: str) -> None:
    engine = register(session, stockfish_path, options={"Threads": 2})
    spec = spec_for(engine)

    assert spec.path == stockfish_path
    assert spec.kind == "uci"
    assert spec.engine_id == engine.id
    assert spec.option_dict == {"Threads": 2}

    changed = update_engine(session, engine.id, options={"Threads": 4})
    assert spec_for(changed).key != spec.key


# --- the test-run button --------------------------------------------------


def test_a_test_run_returns_a_sample_eval_for_a_position(
    session: Session, stockfish_path: str
) -> None:
    engine = register(session, stockfish_path)

    sample = sample_eval(session, engine.id, FRENCH, nodes=1000, multipv=2)

    assert sample["engine_name"] == "Stockfish"
    assert sample["kind"] == "uci"
    assert sample["fen"] == FRENCH
    assert sample["cp"] == 28
    assert sample["mate"] is None
    assert sample["depth"] == 16
    assert sample["best_move"] == {"uci": "e2e4", "san": "e4"}
    assert sample["lines"][1] == {"multipv": 2, "cp": 12, "mate": None, "pv": ["d2d4", "d7d5"]}
    assert sample["elapsed_ms"] >= 0


def test_a_test_run_works_on_an_engine_that_is_not_enabled_yet(
    session: Session, stockfish_path: str
) -> None:
    engine = register(session, stockfish_path, enabled=False)

    assert sample_eval(session, engine.id, nodes=1000)["cp"] == 28


def test_a_test_run_of_a_maia_engine_shows_its_policy(session: Session, maia_path: str) -> None:
    engine = register(session, maia_path, name="Maia 1500", kind=EngineKind.MAIA)

    sample = sample_eval(session, engine.id, ratings=[1500], multipv=1)

    assert sample["policy"]["1500"] == [{"uci": "e2e4", "san": "e4", "rank": 1, "p": 0.41}]


def test_a_test_run_of_a_maia_engine_without_a_rating_still_answers(
    session: Session, maia_path: str
) -> None:
    engine = register(session, maia_path, name="Maia 1500", kind=EngineKind.MAIA)

    assert list(sample_eval(session, engine.id, multipv=1)["policy"]) == ["any"]


def test_a_test_run_needs_a_position_it_can_parse(session: Session, stockfish_path: str) -> None:
    engine = register(session, stockfish_path)

    with pytest.raises(EngineRunError):
        sample_eval(session, engine.id, "not a fen")


def test_a_test_run_of_an_engine_that_cannot_answer_is_a_typed_condition(
    session: Session, tmp_path: Path
) -> None:
    from backend.adapters.stockfish import EngineProbe

    engine = add_engine(
        session,
        name="Ghost",
        path=str(tmp_path / "ghost"),
        probe=lambda path, timeout: EngineProbe(name="Ghost 1"),
    )

    with pytest.raises(EngineRunError):
        sample_eval(session, engine.id)


def test_a_test_run_of_an_engine_that_is_not_there(session: Session) -> None:
    with pytest.raises(UnknownEngineError):
        sample_eval(session, 4242)

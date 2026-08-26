"""Engine management: probe on add, honest options, and a tier that degrades."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fake_uci import MAIA_OPTIONS, STOCKFISH_OPTIONS, fake_engine_command
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.db.enums import EngineKind, RunStatus, Tier
from backend.db.models import AnalysisRun, Engine, MoveEval
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
    list_engines,
    probe_engine,
    sample_eval,
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
    """An engine whose binary has gone missing must still be removable from a tier."""
    engine = register(session, stockfish_path)

    def refuse(*_: Any, **__: Any) -> Any:
        raise AssertionError("the binary must not be probed for a rename")

    updated = update_engine(
        session,
        engine.id,
        name="Old Stockfish",
        enabled=False,
        default_tier=Tier.DEEP,
        probe=refuse,
    )

    assert (updated.name, updated.enabled, updated.default_tier) == (
        "Old Stockfish",
        False,
        Tier.DEEP,
    )


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


# --- tiers ----------------------------------------------------------------


def test_a_tier_uses_the_engine_that_claims_it(session: Session, stockfish_path: str) -> None:
    register(session, stockfish_path, name="Quick", default_tier=Tier.QUICK)
    deep = register(session, stockfish_path, name="Deep", default_tier=Tier.DEEP)

    assert engine_for_tier(session, Tier.DEEP) is deep
    assert tier_status(session, Tier.DEEP).engine_name == "Deep"


def test_a_tier_nobody_claims_falls_back_to_any_enabled_uci_engine(
    session: Session, stockfish_path: str
) -> None:
    engine = register(session, stockfish_path)

    assert engine_for_tier(session, Tier.QUICK) is engine
    assert engine_for_tier(session, Tier.DEEP) is engine


def test_a_disabled_engine_is_not_used(session: Session, stockfish_path: str) -> None:
    engine = register(session, stockfish_path, default_tier=Tier.QUICK)
    update_engine(session, engine.id, enabled=False)

    assert engine_for_tier(session, Tier.QUICK) is None
    status = tier_status(session, Tier.QUICK)
    assert status.available is False
    assert "disabled" in (status.reason or "")


def test_a_maia_engine_never_stands_in_for_an_evaluation(session: Session, maia_path: str) -> None:
    register(session, maia_path, name="Maia 1500", kind=EngineKind.MAIA)

    assert engine_for_tier(session, Tier.QUICK) is None


def test_no_engines_at_all_is_a_reason_not_a_crash(session: Session) -> None:
    status = tier_status(session, Tier.QUICK)

    assert status.available is False
    assert status.engine_id is None
    assert "no engine is registered" in (status.reason or "")
    assert status.as_dict()["tier"] == "quick"


def test_an_engine_whose_binary_has_gone_missing_degrades_its_tier(
    session: Session, stockfish_path: str, tmp_path: Path
) -> None:
    engine = register(session, stockfish_path, default_tier=Tier.QUICK)
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


def test_a_stored_path_is_checked_without_starting_anything(
    stockfish_path: str, tmp_path: Path
) -> None:
    assert binary_present(stockfish_path) is True
    assert binary_present(str(tmp_path / "nope")) is False
    assert binary_present("   ") is False


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

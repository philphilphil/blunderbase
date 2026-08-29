"""Build an anonymous, screenshot-ready library in a separate SQLite database.

The source library contributes chess only: legal move lists and stored engine facts. Names,
ratings, dates, source identifiers, notes, credentials and configuration are all replaced.
Keeping the demo in another database means the rest of Blunderbase needs no ``is_demo``
condition and there is no route by which fabricated stats can enter the owner's archive.
"""

from __future__ import annotations

import copy
import random
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import Any

import chess
import chess.pgn
from sqlalchemy import exists, or_, select
from sqlalchemy.orm import Session, sessionmaker

from backend.config import Settings
from backend.db.enums import (
    Color,
    EngineKind,
    EngineRole,
    JobStatus,
    NoteSource,
    Platform,
    RunStatus,
    Source,
    Speed,
    Tier,
)
from backend.db.migrate import upgrade_to_head
from backend.db.models import Account, AnalysisRun, Engine, Game, ImportJob, MoveEval
from backend.db.session import create_db_engine, get_sessionmaker, reset_engines
from backend.services import analysis as analysis_service
from backend.services import app_settings as app_settings_service
from backend.services import games as games_service
from backend.services import notes as notes_service
from backend.services.accounts import AccountIndex
from backend.services.import_service import ParsedGame, ingest_game

DEFAULT_GAME_COUNT = 72
DEFAULT_FILENAME = "demo.db"
DEMO_SEED = 0xB1D3
DEMO_NAME = "Alex Knight"
LICHESS_HANDLE = "alex_knight"
CHESSCOM_HANDLE = "AlexKnight"
MAIA_ELOS = (1500, 1800)

OPPONENTS = (
    "Maya Brooks",
    "Theo Fischer",
    "Nora Patel",
    "Leon Weber",
    "Sofia Costa",
    "Jonas Reed",
    "Amira Novak",
    "Felix Martin",
    "Clara Stein",
    "Elias Kim",
    "Lina Rossi",
    "Owen Clarke",
    "Mila Jensen",
    "Noah Laurent",
    "Eva Santos",
    "Samir Khan",
    "Iris Becker",
    "Louis Park",
)

NOTE_TEXTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Review the forcing checks before committing to this capture.", ("tactics", "checks")),
    ("The pawn break was right, but the preparation was one move too slow.", ("middlegame",)),
    ("Compare the quiet move with the immediate attack next session.", ("calculation",)),
    ("Recurring pattern: trading the active rook relieved all the pressure.", ("pattern", "rook")),
    ("In this structure, keep the knight before starting the queenside expansion.", ("strategy",)),
    ("Clock check: simplify earlier when under thirty seconds.", ("time-trouble",)),
    ("Good candidate for a spaced-repetition position.", ("training", "review")),
    ("Build a small repertoire note around this move order.", ("opening", "repertoire")),
)


class DemoDataError(RuntimeError):
    """The demo database cannot safely be built from the requested source and target."""


@dataclass(frozen=True, slots=True)
class DemoSummary:
    path: Path
    games: int
    analyzed: int
    deep: int
    notes: int


@dataclass(frozen=True, slots=True)
class Candidate:
    game_id: int
    run_id: int
    played_at: datetime
    bucket: tuple[str, str, str, str]


def create_demo_database(
    source_path: Path,
    target_path: Path,
    *,
    game_count: int = DEFAULT_GAME_COUNT,
    as_of: date | None = None,
    force: bool = False,
) -> DemoSummary:
    """Create an anonymous demo database, returning what was written.

    ``source_path`` is only opened for reads. ``target_path`` must be a different file and
    must not exist unless ``force`` was explicitly requested. Selection and fake values are
    deterministic for a given source and ``as_of`` date, which keeps screenshots stable.
    """
    source = source_path.expanduser().resolve()
    target = target_path.expanduser().resolve()
    if source == target:
        raise DemoDataError("the demo database must be a different file from the source")
    if not source.is_file():
        raise DemoDataError(f"source database does not exist: {source}")
    if game_count < 1:
        raise DemoDataError("game_count must be at least 1")
    if target.exists() and not force:
        raise DemoDataError(f"target already exists: {target} (pass --force to replace it)")

    if force:
        _remove_database_files(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    anchor = as_of or datetime.now(UTC).date()

    source_engine = create_db_engine(f"sqlite+pysqlite:///{source}")
    source_factory = sessionmaker(
        bind=source_engine, autoflush=False, expire_on_commit=False, future=True
    )
    target_settings = Settings(
        root=target.parent,
        data_dir=target.parent,
        BLUNDERBASE_DB_PATH=target,
        analysis_workers=False,
    )

    try:
        upgrade_to_head(target_settings)
        with (
            source_factory() as source_session,
            get_sessionmaker(target_settings)() as target_session,
        ):
            candidates = _select_candidates(source_session, game_count)
            if not candidates:
                raise DemoDataError(
                    "the source has no analyzed standard games attributed to an owner"
                )
            summary = _seed(source_session, target_session, candidates, target, anchor)
            target_session.commit()
        return summary
    except Exception:
        reset_engines()
        _remove_database_files(target)
        raise
    finally:
        source_engine.dispose()
        reset_engines()


def _select_candidates(session: Session, amount: int) -> list[Candidate]:
    evaluated = exists(
        select(MoveEval.id).where(
            MoveEval.run_id == AnalysisRun.id,
            or_(
                MoveEval.eval_before_cp.is_not(None),
                MoveEval.eval_before_mate.is_not(None),
                MoveEval.eval_after_cp.is_not(None),
                MoveEval.eval_after_mate.is_not(None),
            ),
        )
    )
    rows = session.execute(
        select(Game, AnalysisRun)
        .join(AnalysisRun, AnalysisRun.game_id == Game.id)
        .where(
            Game.owner_color.is_not(None),
            Game.played_at.is_not(None),
            Game.variant == "standard",
            Game.ply_count >= 20,
            AnalysisRun.status == RunStatus.DONE,
            AnalysisRun.maia_only.is_(False),
            AnalysisRun.ply_start.is_(None),
            AnalysisRun.ply_end.is_(None),
            evaluated,
        )
        .order_by(Game.played_at, AnalysisRun.finished_at.desc(), AnalysisRun.id.desc())
    )

    # Keep one finished full-game run per game, then round-robin across useful screenshot
    # dimensions. A source dominated by blitz or one opening still yields the variety it has.
    by_game: dict[int, Candidate] = {}
    for game, run in rows:
        if game.id in by_game or game.played_at is None:
            continue
        outcome = _outcome(game)
        eco_family = (game.eco or "?")[:1]
        candidate = Candidate(
            game_id=game.id,
            run_id=run.id,
            played_at=game.played_at,
            bucket=(
                str(game.speed or "unknown"),
                outcome,
                str(game.owner_color),
                eco_family,
            ),
        )
        by_game[game.id] = candidate

    buckets: dict[tuple[str, str, str, str], list[Candidate]] = defaultdict(list)
    for candidate in by_game.values():
        buckets[candidate.bucket].append(candidate)
    rng = random.Random(DEMO_SEED)
    for rows_in_bucket in buckets.values():
        rng.shuffle(rows_in_bucket)

    selected: list[Candidate] = []
    keys = sorted(buckets)
    while keys and len(selected) < amount:
        remaining: list[tuple[str, str, str, str]] = []
        for key in keys:
            if buckets[key] and len(selected) < amount:
                selected.append(buckets[key].pop())
            if buckets[key]:
                remaining.append(key)
        keys = remaining
    return sorted(selected, key=lambda candidate: (candidate.played_at, candidate.game_id))


def _seed(
    source: Session,
    target: Session,
    candidates: list[Candidate],
    path: Path,
    anchor: date,
) -> DemoSummary:
    accounts = _accounts(target)
    stockfish, maia = _engines(target)
    _settings(target, stockfish, maia)

    jobs = {
        source_name: ImportJob(
            source=source_name,
            status=JobStatus.RUNNING,
            started_at=datetime.combine(anchor - timedelta(days=180), time(9), tzinfo=UTC),
        )
        for source_name in (Source.LICHESS, Source.CHESSCOM)
    }
    target.add_all(jobs.values())
    target.flush()

    imported: list[Game] = []
    source_runs: list[AnalysisRun] = []
    total = len(candidates)
    for index, candidate in enumerate(candidates):
        original = source.get(Game, candidate.game_id)
        original_run = source.get(AnalysisRun, candidate.run_id)
        if original is None or original_run is None:
            continue
        parsed = _fake_game(original, index, total, anchor)
        outcome = ingest_game(
            target,
            jobs[parsed.source],
            parsed,
            accounts,
            analyze=False,
        )
        imported.append(outcome.game)
        source_runs.append(original_run)

    target.flush()
    analyzed = max(1, round(len(imported) * 0.84))
    deep = 0
    paired = zip(imported[:analyzed], source_runs[:analyzed], strict=True)
    for index, (game, original_run) in enumerate(paired):
        tier = Tier.DEEP if index % 4 == 1 else Tier.QUICK
        deep += int(tier is Tier.DEEP)
        _analysis(target, source, game, original_run, stockfish, tier)

    for job in jobs.values():
        job.status = JobStatus.DONE
        job.finished_at = datetime.combine(anchor, time(16), tzinfo=UTC)
        job.games_seen = sum(game.source is job.source for game in imported)
        job.games_imported = job.games_seen
        job.cursor = anchor.isoformat()

    notes = _notes(target, imported[:analyzed], anchor)
    games_service.rebuild_game_cards(target)
    return DemoSummary(
        path=path,
        games=len(imported),
        analyzed=analyzed,
        deep=deep,
        notes=notes,
    )


def _accounts(session: Session) -> AccountIndex:
    rows = [
        Account(
            platform=Platform.LICHESS,
            username=LICHESS_HANDLE,
            display_name=DEMO_NAME,
            is_owner=True,
        ),
        Account(
            platform=Platform.CHESSCOM,
            username=CHESSCOM_HANDLE,
            display_name=DEMO_NAME,
            is_owner=True,
        ),
    ]
    session.add_all(rows)
    session.flush()
    return AccountIndex.load(session)


def _engines(session: Session) -> tuple[Engine, Engine]:
    stockfish = Engine(
        name="Stockfish 18 (demo)",
        kind=EngineKind.UCI,
        path="/demo/stockfish",
        version="18",
        options={"Threads": 4, "Hash": 512},
        enabled=True,
    )
    maia = Engine(
        name="Maia 2 (demo)",
        kind=EngineKind.MAIA,
        path="/demo/maia",
        version="2",
        options={},
        enabled=True,
    )
    session.add_all((stockfish, maia))
    session.flush()
    return stockfish, maia


def _settings(session: Session, stockfish: Engine, maia: Engine) -> None:
    app_settings_service.set_maia_elos(session, list(MAIA_ELOS))
    app_settings_service.set_role_engine_id(session, EngineRole.QUICK, stockfish.id)
    app_settings_service.set_role_engine_id(session, EngineRole.DEEP, stockfish.id)
    app_settings_service.set_role_engine_id(session, EngineRole.HUMAN, maia.id)


def _fake_game(original: Game, index: int, total: int, anchor: date) -> ParsedGame:
    source = Source.LICHESS if index % 3 else Source.CHESSCOM
    owner_name = LICHESS_HANDLE if source is Source.LICHESS else CHESSCOM_HANDLE
    opponent = OPPONENTS[(index * 7) % len(OPPONENTS)]
    owner_white = original.owner_color is Color.WHITE
    white_name, black_name = (owner_name, opponent) if owner_white else (opponent, owner_name)

    # Oldest to newest over roughly six months, with a visible but non-linear rating trend.
    spread = 176 * index // max(total - 1, 1)
    played_day = anchor - timedelta(days=176 - spread)
    played_at = datetime.combine(
        played_day,
        time(hour=(8 + index * 5) % 24, minute=(index * 17) % 60),
        tzinfo=UTC,
    )
    owner_rating = 1480 + round(118 * index / max(total - 1, 1)) + (index % 7 - 3) * 3
    opponent_rating = owner_rating + ((index * 37) % 181) - 90
    white_rating, black_rating = (
        (owner_rating, opponent_rating) if owner_white else (opponent_rating, owner_rating)
    )
    speed, initial, increment = _clock(original.speed, index)
    clocks = _clocks(original.clocks, original.ply_count, initial, increment, index)
    pgn = _pgn(
        original,
        source,
        white_name,
        black_name,
        white_rating,
        black_rating,
        played_at,
        initial,
        increment,
    )
    return ParsedGame(
        source=source,
        source_id=f"demo-{index + 1:04d}",
        white_name=white_name,
        black_name=black_name,
        white_rating=white_rating,
        black_rating=black_rating,
        result=original.result,
        termination=original.termination or "Normal",
        variant="standard",
        rated=True,
        speed=speed,
        time_control=f"{initial}+{increment}",
        initial_clock=initial,
        increment=increment,
        eco=original.eco,
        opening_name=original.opening_name,
        played_at=played_at,
        pgn=pgn,
        moves_uci=list(original.moves_uci),
        moves_san=list(original.moves_san),
        clocks=clocks,
        ref=f"demo game {index + 1}",
    )


def _clock(speed: Speed | None, index: int) -> tuple[Speed, int, int]:
    choices = {
        Speed.BULLET: (Speed.BULLET, 60, 1),
        Speed.BLITZ: (Speed.BLITZ, 180, 2),
        Speed.RAPID: (Speed.RAPID, 600, 5),
        Speed.CLASSICAL: (Speed.CLASSICAL, 1800, 10),
        Speed.CORRESPONDENCE: (Speed.RAPID, 900, 10),
        None: (Speed.RAPID if index % 3 == 0 else Speed.BLITZ, 600, 5),
    }
    picked = choices[speed]
    if speed is None and picked[0] is Speed.BLITZ:
        return Speed.BLITZ, 180, 2
    return picked


def _clocks(
    stored: list[float | None] | None,
    plies: int,
    initial: int,
    increment: int,
    seed: int,
) -> list[float | None]:
    if stored and len(stored) == plies:
        # Scale the shape of the real clock to the fake time control; only ratios survive.
        peak = max((value for value in stored if value is not None), default=0.0)
        if peak > 0:
            return [None if value is None else round(initial * value / peak, 1) for value in stored]
    rng = random.Random(DEMO_SEED + seed)
    remaining = [float(initial), float(initial)]
    clocks: list[float | None] = []
    for ply in range(plies):
        side = ply % 2
        spend = rng.uniform(1.5, max(2.5, initial / 32))
        remaining[side] = max(0.3, remaining[side] - spend + increment)
        clocks.append(round(remaining[side], 1))
    return clocks


def _pgn(
    original: Game,
    source: Source,
    white: str,
    black: str,
    white_rating: int,
    black_rating: int,
    played_at: datetime,
    initial: int,
    increment: int,
) -> str:
    game = chess.pgn.Game()
    game.headers.update(
        {
            "Event": f"Rated {str(original.speed or Speed.RAPID).title()} game",
            "Site": "https://example.invalid/demo",
            "Date": played_at.strftime("%Y.%m.%d"),
            "UTCDate": played_at.strftime("%Y.%m.%d"),
            "UTCTime": played_at.strftime("%H:%M:%S"),
            "Round": "-",
            "White": white,
            "Black": black,
            "Result": str(original.result),
            "WhiteElo": str(white_rating),
            "BlackElo": str(black_rating),
            "TimeControl": f"{initial}+{increment}",
            "Termination": original.termination or "Normal",
            "Source": str(source),
        }
    )
    if original.eco:
        game.headers["ECO"] = original.eco
    if original.opening_name:
        game.headers["Opening"] = original.opening_name
    board = game.board()
    node: chess.pgn.GameNode = game
    for uci in original.moves_uci:
        move = board.parse_uci(uci)
        node = node.add_variation(move)
        board.push(move)
    exporter = chess.pgn.StringExporter(headers=True, variations=False, comments=False)
    return game.accept(exporter)


def _analysis(
    target: Session,
    source: Session,
    game: Game,
    original_run: AnalysisRun,
    engine: Engine,
    tier: Tier,
) -> None:
    run = AnalysisRun(
        game_id=game.id,
        engine_id=engine.id,
        tier=tier,
        status=RunStatus.RUNNING,
        depth=max(original_run.depth or 18, 18 if tier is Tier.QUICK else 24),
        nodes=250_000 if tier is Tier.QUICK else 2_000_000,
        multipv=1 if tier is Tier.QUICK else 4,
        maia=True,
        maia_elos=list(MAIA_ELOS),
        attempts=1,
    )
    target.add(run)
    target.flush()
    target_positions = {row.ply: row.position_id for row in game.positions}
    original_rows = list(
        source.scalars(
            select(MoveEval).where(MoveEval.run_id == original_run.id).order_by(MoveEval.ply)
        )
    )
    copied = [
        MoveEval(
            ply=row.ply,
            position_id=target_positions.get(row.ply),
            move_uci=row.move_uci,
            move_san=row.move_san,
            eval_before_cp=row.eval_before_cp,
            eval_before_mate=row.eval_before_mate,
            eval_after_cp=row.eval_after_cp,
            eval_after_mate=row.eval_after_mate,
            win_before=row.win_before,
            win_after=row.win_after,
            win_loss=row.win_loss,
            classification=row.classification,
            best_move_uci=row.best_move_uci,
            best_lines=copy.deepcopy(row.best_lines),
            maia_policy=_policy(row),
        )
        for row in original_rows
        if row.ply < game.ply_count
    ]
    analysis_service.complete_run(target, run, copied)
    finished = (game.played_at or datetime.now(UTC)) + timedelta(minutes=3)
    duration = 11 if tier is Tier.QUICK else 68
    run.started_at = finished - timedelta(seconds=duration)
    run.finished_at = finished
    target.commit()


def _policy(row: MoveEval) -> dict[str, list[dict[str, Any]]] | None:
    moves: list[str] = []
    for move in (row.move_uci, row.best_move_uci, *_line_heads(row.best_lines)):
        if move and move not in moves:
            moves.append(move)
    moves = moves[:3]
    if not moves:
        return None
    policies: dict[str, list[dict[str, Any]]] = {}
    for level in MAIA_ELOS:
        weights = [0.52, 0.31, 0.17] if level == MAIA_ELOS[0] else [0.38, 0.43, 0.19]
        chosen = weights[: len(moves)]
        total = sum(chosen)
        policies[str(level)] = [
            {"uci": move, "p": round(weight / total, 3)}
            for move, weight in zip(moves, chosen, strict=True)
        ]
    return policies


def _line_heads(lines: list[dict[str, Any]] | None) -> list[str]:
    if not lines:
        return []
    return [
        str(line["pv"][0])
        for line in lines
        if isinstance(line, dict) and isinstance(line.get("pv"), list) and line["pv"]
    ]


def _notes(session: Session, games: list[Game], anchor: date) -> int:
    if not games:
        return 0
    written = 0
    for index, (text_body, tags) in enumerate(NOTE_TEXTS):
        game = games[(index * 7) % len(games)]
        card = games_service.build_card(session, game)
        moments = card.get("worst_moments") or []
        ply = int(moments[index % len(moments)]["ply"]) if moments else min(12, game.ply_count)
        note = notes_service.save_note(
            session,
            text_body,
            tags,
            game_id=game.id,
            ply=ply,
            source=NoteSource.MCP if index % 3 == 0 else NoteSource.WEB,
        )
        note.created_at = datetime.combine(
            anchor - timedelta(days=4 + index * 6), time(18, index), tzinfo=UTC
        )
        note.updated_at = note.created_at
        session.commit()
        written += 1
    notes_service.save_note(
        session,
        "Training plan: calculate forcing moves, then review rook endings twice this week.",
        ("training-plan",),
        source=NoteSource.MCP,
    )
    return written + 1


def _outcome(game: Game) -> str:
    if str(game.result) == "1/2-1/2":
        return "draw"
    won = (str(game.result) == "1-0") is (game.owner_color is Color.WHITE)
    return "win" if won else "loss"


def _remove_database_files(path: Path) -> None:
    for candidate in (path, Path(f"{path}-shm"), Path(f"{path}-wal")):
        candidate.unlink(missing_ok=True)

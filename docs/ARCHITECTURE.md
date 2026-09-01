# Architecture

Decisions made in phase 1 that everything later has to live with. The visual design lives
in `docs/design/`; this file is only about the shape of the code.

This document describes the current application architecture. The target hosting,
synchronization, and data-ownership model is defined in
[distribution.md](distribution.md).

## One service layer, three consumers

```
backend/
  adapters/   # network- and process-facing: lichess, chesscom, fics, pgn_import, engines
  db/         # models, engine/session factory, Alembic wiring
  services/   # ALL business logic
  workers/    # background analysis queue
  api/        # FastAPI — thin HTTP wrappers over services
  mcp/        # MCP server — thin tool wrappers over the SAME services
  cli.py
```

**Invariant: `api/` and `mcp/` never touch the database.** Neither imports
`backend.db.models`, writes a query, or opens a Session of its own for business purposes —
they call `backend.services`, which is the only place a "blunder", a "recent game" or a
stat is defined. That is what stops the coach and the web UI from disagreeing.

The mirror of that rule points the other way: nothing in `backend/services/` imports
FastAPI or the MCP SDK, and every service function takes an explicit `Session` as its
first argument rather than reaching for a global. A service is callable from a request
handler, an MCP tool, a worker task and a test with equal ease.

`backend/adapters/` knows nothing about the database at all. An adapter fetches, parses or
drives a subprocess and hands plain data back to a service.

## Sync SQLAlchemy, not async

The database layer is synchronous: `Session`, `sessionmaker`, `create_engine`. The
analysis workers are asyncio tasks, and they do database work on one dedicated worker
thread rather than through an async Session. Engine calls still use the event loop's
general thread executor and remain parallel up to `analysis_concurrency`.

Why:

- The expensive thing in an analysis run is the engine subprocess, not the database. A run
  buffers its `MoveEval` rows in memory and commits them once at the end, so the write
  lock is held for milliseconds. SQLite has one writer, so several queue DB threads add
  waiting connections rather than throughput; one thread dispatches every local claim,
  heartbeat and completion while the engines work in parallel.
- SQLite's asyncio support is a thread pool underneath in any case, so an async Session
  would be the same threads with more machinery.
- The predecessor ran this exact pattern in production against the same workload, and
  Alembic, the FastAPI dependency style and the test fixtures are all simpler for it.

Practical consequence: a `Session` belongs to one thread. `backend.db.session` pools with
the default `QueuePool`, so every Session gets its own connection; never share one across
threads, and never hold one open across an `await`. A local analysis run opens separate,
short Sessions to claim, prepare and finish; it holds no connection while an engine thinks.

## One SQLite file

SQLite in WAL mode is the store, and the only one: the file at `BLUNDERBASE_DB_PATH` is
what the app, the CLI and Alembic all open. A personal archive is a single-writer workload
with one reader who is the same person, which is the shape SQLite is best at, and "back up
the `/data` volume" is the whole backup story. The rules that follow from it:

- Access through SQLAlchemy only — no hand-written SQL, no `INSERT OR REPLACE`.
- Enums are plain `VARCHAR` columns validated in Python (`backend.db.types.EnumString`
  over the `StrEnum`s in `backend.db.enums`). SQLite has no enum type, and a `CHECK`
  constraint would be one more thing every batch migration has to recreate.
- Timestamps are stored as naive UTC through `backend.db.types.UtcDateTime` and read back
  as aware UTC. SQLite carries no zone, so the conversion is done in Python.
- Parsed move lists, clock times, multi-PV lines, Maia policies, note tags and per-game
  import errors are `sqlalchemy.JSON` columns.
- Migrations run with `render_as_batch=True`, because SQLite has no `ALTER` worth the name
  and a change to a column is a table copy.

### Demo data is another deployment

`blunderbase demo create` writes a separate SQLite file rather than adding demo rows and a
filter to the personal library. This preserves the one-file invariant: each running process
still has one database, every existing service remains unaware of demo data, and fake ratings
cannot leak into real stats. The command reads analyzed standard games from the source and
retains only chess facts (moves and evaluations). It rebuilds PGNs and replaces identities,
ratings, dates, source IDs, accounts, engine configuration, Maia policies and notes.

The resulting file is the seed for screenshots now and for a read-only demo deployment later.
Read-only behavior and authentication bypass do not belong in the seed generator; they belong
at the future demo-mode write/auth seams, so a locally served seed behaves like a normal
deployment until that mode exists.

WAL, `foreign_keys=ON` and a busy timeout are set by a `connect` event installed in
`backend.db.session.create_db_engine`. They are per-connection pragmas, so they have to be
set on every connection the pool opens; the listener is bound to the engine instance
rather than to the `Engine` class, so it reaches that engine's connections and no others.

## Source-adapter registration

`backend.services.import_service.SOURCES` maps a source name to the dotted
`module:attribute` path of its adapter's entry point:

```python
SOURCES = {
    "lichess": "backend.adapters.lichess:run",
    "chesscom": "backend.adapters.chesscom:run",
    "fics": "backend.adapters.fics:run",
    "pgn": "backend.adapters.pgn_import:run",
}
```

`get_adapter(source)` imports the module on first use and returns the callable;
`register_source(name, target)` adds or replaces an entry (that is how `manual` arrives
with the UI). Registration is by path rather than by import so that

- an adapter that is still a stub raises `SourceNotImplementedError` when it is *called*,
  not at start-up, which is what lets the CLI and the tests exist before the importers do;
- adding a source is one dict entry, not an edit to an import list that every parallel
  branch would conflict on;
- nothing at module scope in `import_service` pulls `httpx` or `chess` into a process that
  only wanted to serve `/health`.

Every adapter implements the `ImportAdapter` protocol —
`(session, job, **options) -> ImportResult` — and reports per-game failures in
`ImportResult.errors` instead of raising. A bad game never aborts a sync.

## The import pipeline

`run_import(session, source, *, progress=None, **options)` opens the `ImportJob`, calls
the adapter under it and folds the result back into the row. An adapter-level error is
recorded as a failed job and *not* re-raised: the row is the record of what happened, and
raising would roll it back.

An adapter's only job is to turn what it fetched into `ParsedGame`s — plain data, no
database — and to hand the stream to `ingest_games`, which does everything else:

```python
def run(session, job, *, path=None, max_games=None, progress=None, **options):
    return ingest_games(session, job, parse_stream(...), progress=progress)
```

What a game it could not parse becomes is an `ImportFailure(ref, error)` yielded in the
stream's place, so one broken game costs exactly that game. `ingest_games` then, per game:

- **Dedups.** `(source, source_id)` where the source has an ID, and a `dedup_hash` —
  sha256 over both player names, the calendar day and the UCI move list — for the routes
  that carry no ID. The hash is what catches the same game arriving twice by two routes,
  so it is stored on every game: a PGN export of an already-synced Lichess game keeps its
  moves, its date and its players while its source and its source ID both change. It is
  only ever *matched* against games the incoming source has not named differently, because
  two IDs from one source are two games however identical they look — a rematch of a short
  trap line shares every scrap of the hash's material.
- **Extracts positions.** The move list is replayed and every position reached becomes a
  `Position` keyed by its normalised FEN — `board.epd()`: placement, side to move,
  castling rights, a legal en-passant square, and deliberately no move counters — plus one
  `GamePosition(game, ply, position)` row, `ply_count + 1` of them, the last with no move.
  New positions are inserted in one batch and existing ones are looked up, so a position
  is one row however many games reach it.
- **Resolves the owner.** `AccountIndex` matches player names against `accounts`. A source
  that names a platform matches on that platform only; a PGN or a manual game has no
  platform and matches on the username alone. No match means `owner_color` stays NULL.
  An account is a first-class row rather than a side effect of a sync — `blunderbase
  accounts add` and `POST /accounts` write one — and both of those, like the sync itself,
  then run `reconcile_games`: the same match re-applied to the games already stored, which
  is what repairs a library imported before any account named its owner. The repair only
  ever fills in an empty column, so it is idempotent and never revises a decided game.
- **Enqueues the quick tier.** A `queued` `AnalysisRun` per imported game, against the
  engine the owner assigned to the quick role. Nothing falls back, and no engine means no
  run — an import must never fail because no engine is assigned.

Each game is its own transaction, so a sync that dies half-way keeps what it got, and the
job's counters and error list are rewritten after every game.

`progress` is an optional `Callable[[dict], None]`; `run_import` passes it to the adapter,
which forwards it to `ingest_games`. Three event shapes, which the `/events` WebSocket
will forward as they are:

| `event` | when | fields beyond `event`, `job_id`, `source` |
|---|---|---|
| `import.started` | job opened | `at` |
| `import.game` | per game | `ref`, `status` (`imported`/`skipped`/`failed`), `game_id`, `error`, `seen`, `imported`, `skipped`, `failed` |
| `import.finished` | job closed | `status` (`done`/`failed`), `seen`, `imported`, `skipped`, `failed`, `message`, `at` |

A subscriber that raises is ignored: it must never be able to abort a sync.

## Analysis queue

The queue is the `analysis_runs` table, not a broker: a run survives a restart because it
is a row. Workers claim the highest `priority` queued row (deep = 10 beats quick = 0, so a
deep request someone is waiting on jumps the FIFO) with one conditional `UPDATE …
RETURNING`, mark it `running`, and on completion write every `MoveEval` and the terminal
status in one commit. The claim index matches that mixed order — priority descending,
then creation and id ascending — so a library backfill is an index walk rather than one
temporary sort per game.

All local queue database transitions pass through one dedicated thread. This does not cap
engine concurrency: N workers can still have N engines searching, but only one of their
short SQLite transactions can hold a pooled connection. Pool checkout exhaustion and
SQLite busy/locked errors are retried with backoff around the same transition, retaining
the buffered result and attempt; they are infrastructure pressure, not engine failures.
A crash writes `failed` with the engine's stderr and buys one retry (`attempts` <
`MAX_ATTEMPTS`). Re-analysis is always a new run; old runs are never overwritten.

## The query side

`games`, `explorer`, `stats` and `notes` are read-mostly and share four decisions.

**"You" is `Game.owner_color`, and a ply's parity is who moved.** White moves on even
plies, so an owner move is `owner_color == white AND ply % 2 = 0` (or the mirror);
`games.owner_move_condition()` is that clause and every blunder count in `stats` uses it.
A game whose owner is unknown contributes every ply, because there is no "you" to filter
by. The assumption underneath is that ply 0 is White's — true for standard and 960, wrong
only for a from-position fragment that starts with Black to move.

**One filter vocabulary.** `games.GameFilters` is the only place a search predicate is
spelled, and `games.game_conditions(filters)` turns it into WHERE clauses that drop into a
`select(Game)`, a `count`, or a stats join without changing the row count (every one is a
column comparison or a correlated EXISTS). `get_stats` therefore takes the same filter
object the games table is already showing. Outcomes are owner-relative — `outcome="win"`
matches a `0-1` game the owner had Black in.

**Which run answers.** `games.get_game_detail` merges *all* of a game's done runs in
`(quick before deep, then age)` order and lets the later one win per ply, so a deep pass
over one window shows deep evals there and quick evals everywhere else, and a Maia run
adds a policy without erasing an eval. `stats.primary_runs()` deliberately does not do
that: an aggregation reads exactly one run per game — the newest done, full-game, UCI
run — because a dimension half at quick budget and half at deep budget is not a number.

**Aggregation in Python, filtering in SQL.** Phase (needs the board), piece moved (needs
the SAN), time trouble (needs the game's clock list) and time of day (needs the viewer's
zone) are not things SQL can work out. The queries fetch narrow tuples under SQL filters;
the bucketing happens in Python. Same reason `notes` matches tags after the read:
`notes.tags` is a plain JSON column, and searching inside one is a scan either way.

**What a game says about itself is written down when it changes.** Two columns' worth: a
game's `card` (its eval curve and worst moments, folded out of every finished run) and its
`stat_summary` plus the three scalars beside it (its contribution to every aggregation,
folded out of the one primary run). Both are rewritten inside `analysis.complete_run`'s
commit — the only moment either can change — so nothing can read a fold that describes
evals it cannot see, or miss one it can. Without them a page of fifty games is a hundred
queries and a dimension is a walk over every analysed ply in the library: 194k rows for one
answer at nine thousand games, several of them at a hundred thousand. With them a dimension
sums one row per game and the worst-moments ranking is an index walk over
`games.stat_worst_win_loss`.

Neither is a source of truth, and that is what keeps them safe. A missing card is computed
on the way out; the summaries are read only while `stats._summaries_ready()` — no game with
a primary run is missing one or describing an older one — and the scan is what answers
until then, so a library upgraded from before the columns existed is slow rather than
wrong. `stats.rebuild_stat_summaries` is the sweep that ends that, a committed chunk at a
time: the server runs it in the background at boot, and `blunderbase db rebuild-stats` runs
it by hand. A question the folds do not hold — time trouble at bands of the caller's own,
worst moments of some other classification — takes the scan whatever the state of the
library.

Two conventions worth knowing: a `limit` of 0 means "no limit" throughout, and payload
builders drop `None` keys, because a chat model pays for every one of them.

The explorer is a `GamePosition` index walk, never a PGN scan. A tree is one query over
the position's join rows; the "where do I leave book" walk follows the most-played
continuation one position at a time, and it is *positional* — every game that has ever
stood in a position counts at that node, whether or not it was following the line at the
previous one, which is what a book means everywhere else and what makes a transposition
count. Book means the owner's own book — there is no reference database by design — so the
walk stops at the first move they have played in only one game.

The explorer has its own written-down fold, for the same reason the games do, and one
extra: a position is shared by every game that reached it, so the numbers change when
*any* of them does. `position_moves` is one row per (position, owner colour, move) holding
exactly the counters the tree accumulates, and `position_totals` is the position's own row
— not the sum of the moves', because a game that visits a position twice and plays two
different moves is counted once by the totals and under both moves. Only the hot positions
get rows (`explorer.BOOK_MIN_OCCURRENCES`): on a real library 452k of 463k positions are
reached by exactly one game and fold live in microseconds, while a thousand-odd carry the
whole cost. `positions.book_state` says which side of that cut a position is on and is the
sweep's work queue — every writer that can change a fold (an import, a finished run, a
reconciliation, a wipe) marks the positions it touched dirty inside its own transaction,
and `explorer.rebuild_position_books` settles them a committed chunk at a time, in the
background at boot and by hand as `blunderbase db rebuild-book`. A position the sweep has
not reached folds live, so an un-swept library is slow rather than wrong.

## Testing

`tests/conftest.py` gives every later test the same two starting points: `session`, an
in-memory SQLite database built from the models with a `StaticPool` (so one connection is
shared across Sessions and threads and the database survives), and `settings`, a
`tmp_path` file database for anything that needs real Alembic migrations. Engine adapters
are tested against scripted fake UCI processes; tests that need a real Stockfish or Maia
binary carry the `engine` marker and are excluded from the default run.

`tests/fake_uci.py` is that fake: a real subprocess speaking real UCI over a real pipe,
scripted by a JSON scenario (declared options, one reply per `go`, a crash, a handshake
that never finishes) and optionally logging every command it received with its pid and a
timestamp. Driving a process rather than stubbing `chess.engine.SimpleEngine` is what makes
the adapter tests worth having: option round-trips, info-line parsing, a dead process and
the pool's start/reuse/quit behaviour are all observed the way production sees them.

## Engines

Engines are rows, and three modules divide the work:

- `adapters/stockfish.py` is the **UCI core**: `command_for` (a stored path is a file, a
  command line, or a name on PATH), `open_engine`, `probe_engine`, the `UciOption` /
  `EngineProbe` model, `Score` / `Candidate` / `AnalysisResult`, and the `EngineError`
  taxonomy. `adapters/maia.py` is an lc0 build and imports all of that rather than
  repeating it.
- `adapters/pool.py` keeps **warm processes per `EngineSpec`** — the spec's key covers
  path, kind and options, so editing an engine's options in the UI starts a fresh process
  instead of leaving the old settings warm. One process per caller up to
  `settings.analysis_concurrency`, not one per spec: every analysis worker resolves the
  quick tier to the same engine row, and a single process would queue the whole pool behind
  one search. The pool is asyncio-facing because the analysis
  workers are asyncio tasks: every blocking engine call goes out through
  `pool.run(spec, work)` / `asyncio.to_thread`, and one semaphore of
  `settings.analysis_concurrency` caps concurrent engine work across all engines. A call
  that raises drops its process (a corpse in the slot would be handed to the next caller)
  and always releases its slot.
- `services/engines.py` owns the policy: probe on add, options validated against what the
  binary declared, and roles that degrade. The owner assigns one engine to each of Quick,
  Deep and Human moves (`EngineRole`, three `app_settings` rows); nothing falls back, so a
  role whose engine is missing, switched off, of the wrong kind or on a runner that is not
  connected simply does not run. `engine_for_role` returns `None`, `role_status(role)`
  explains why in words a UI can show — `configured` telling "you have not chosen one" from
  "the one you chose is down" — and only `require_engine_for_tier` raises, as
  `TierUnavailableError`, never as whatever the process layer threw. `assign_default_roles`
  is the one write that happens without the owner asking: a role nobody has filled goes to
  the first engine of a kind that fits it, at `add_engine` and for a runner's new engines,
  which is what makes a fresh install run without a visit to the form. It imports the
  adapters inside its functions so that listing engines does not pull python-chess into the
  server.

## Analysis

An `AnalysisRun` row *is* the queue. There is no broker, no Redis and no Celery: a run is
enqueued by writing a row, claimed by a conditional `UPDATE`, and survives a restart
because it never lived anywhere else. `services/analysis.py` owns every rule and does it
all synchronously; `workers/analysis_queue.py` owns nothing but the asyncio plumbing.

**Claiming.** `claim_next_run` reads the top candidate by `(priority DESC, created_at,
id)` and then updates it `WHERE id = ? AND status = 'queued'`. A second worker's update
matches no row and it moves on to the next candidate. SQLite has no row locks at all, so
there is no `SELECT … FOR UPDATE SKIP LOCKED` to reach for: the conditional UPDATE is the
claim.

**Scheduling.** Quick runs are FIFO at priority 0; deep runs jump the queue at priority 10
because someone is waiting on one. Concurrency is one semaphore of
`analysis_concurrency` inside the engine pool, shared across every engine process.

**One transaction per run.** `build_plan` reads what a run needs into a `RunPlan` — plain
values, no Session, no ORM object — so `analyse_plan` can be handed to a thread. It
returns unattached `MoveEval` objects that are buffered in memory until `complete_run`
writes them all in one commit. This is the whole reason SQLite's single writer is a
non-issue: the write lock is held for milliseconds, never for the length of a search.

**Two passes, never nested.** Stockfish evaluates, then Maia predicts, each acquiring the
pool separately. A worker that held one slot while waiting for a second would deadlock the
moment `analysis_concurrency` is 1. Maia is asked at the deployment's `maia_elos` — one to
five rating levels, clamped to what the build declares it can answer — because the reading
that teaches something is a comparison: what a 1500 plays here beside what a 1900 plays
here. The levels are the deployment's and never vary by game or by player, which is what
makes two games comparable: a move Maia's answer changed between them is the play
changing, not the question. No Maia engine, or a Maia that will not answer, degrades: the
evaluation is still worth having, and the reason is recorded on the run.

**The second pass is not part of what a run is.** It costs 40-70% of a quick pass — 375 ms
a ply against Stockfish's ~480 at 250k nodes — and a deep run spent it recomputing a policy
identical to the quick run's, since Maia answers a position rather than a search budget. So
a run carries a `maia` flag, written when it is queued from `maia_on_quick` /
`maia_on_deep` the way its node budget is written from `quick_nodes` / `deep_nodes`: on for
quick, off for deep, and a caller may say either explicitly. `maia_both_sides`, read per
plan like the thresholds, is the other half of the cost — on, every ply is asked about,
because "what will a human opposite me fall into" is a question about the positions the
*opponent* moves in; off, only the plies the owner moved in are, which halves the pass. A
run with no Maia pass never starts the process and never takes the pool slot. The two
switched-off cases meet at `maia_only`, the fill pass that adds levels to a game already
searched: it is always a Maia pass, whatever the tier's setting says, because a fill
without one would be no pass at all.

**Classification** is win-percentage based, à la Lichess:
`win% = 100 / (1 + exp(-0.00368208 × cp))` with the centipawn score clamped to ±1000 and a
mate in N read as `(21 - min(10, N))` pawns. Both readings of a move are taken in the
mover's own frame, so `win_loss` is what that player gave away. The thresholds
(`inaccuracy` / `mistake` / `blunder`, default 5 / 10 / 15 points — Lichess's own cuts on
this curve) are app settings, read
per plan and refused rather than clamped when they do not rise. Playing the engine's own first choice is checked before them: a top move that still shows
a large drop is two search depths disagreeing, not a blunder.

**Failure.** A crashed engine's stderr goes to a `StderrCapture` — an unlinked temp file
the adapter hands the process, not a pipe, because nothing in this process drains a pipe
while a search runs. The worker reads its tail before the exception leaves the pool's
context manager (which drops the dead process), and writes it onto the run. The first
failure requeues the run with its error still visible; the second fails it for good. A
failure that will not improve on a retry — a binary that is no longer where the engine row
says — skips the retry. The game stays browsable with whatever tiers it has.

**Restart.** A worker set marks the runs it is executing alive every
`HEARTBEAT_SECONDS`. Starting one calls `requeue_stale_runs`, which collects the `running`
rows whose heartbeat has been quiet for `STALE_AFTER_SECONDS` — a dead process's rows, and
never one another live worker set is still searching, which is what makes
`blunderbase analyze` safe to run while the server is up. A run that has already spent its
retry is failed instead, so a pass that takes the engine down with it cannot survive
restarts forever. A graceful shutdown hands its run back with the attempt refunded: the
pass was taken away from it, it did not fail.

**Events.** `analysis.subscribe(hook)` receives every lifecycle transition as a plain
dict: `analysis.queued` / `.running` / `.progress` / `.done` / `.failed`, each carrying
`run_id`, `game_id`, `fen`, `tier`, `status`, `engine_id`, `priority`, `attempts`,
`maia_only` and `at`, plus `evals` on done, `error` / `stderr` / `will_retry` on failed, and `done` /
`total` on progress. Events are emitted from whichever thread reached the transition, so
the WebSocket layer has to bounce them onto its own loop. A subscriber that raises is
ignored — it must never be able to fail a run. `analysis.queued` waits for the transaction
that created the run to commit — the import pipeline enqueues the quick pass inside the
one that stores the game — so a rolled-back import never announces a run id that does not
exist.

A library-wide write announces itself differently. `analysis.backfill` carries `tier`,
`queued`, `outstanding` and `maia_only`, and names no run at all, because the alternative is ten thousand
`analysis.queued` frames down every open socket in one burst — the shape of storm this
deployment has fallen over on before. `POST /analysis/backfill` queues a full-game pass over
every game with no live run of a tier, uncapped (`/analysis/batch` keeps its five-hundred
ceiling: that one serves a selection made by hand), `GET /analysis/backfill` is the count the
button labels itself with, and `POST /analysis/backfill/cancel` drops what is still queued
while leaving the runs a worker already claimed to finish — there is no cancelled status to
move them to. A client that sees the event refetches the queue.

Two passes share the quick tier, and `maia_only` is what tells them apart. A Maia fill
(`POST /analysis/maia-fill`) is queued under that tier only to borrow its engine and its
place behind the deep passes; it searches nothing and asks the human-move model for the
levels a game is missing. So the tier a run was filed under does not say what it did: a
client that labels a fill by its tier reports a quick pass over a game nobody asked to
re-analyse, coverage counts that treated one as a pass would leave the game permanently
out of a backfill, and `/analysis/backfill/cancel` leaves fills alone — `POST
/analysis/queue/clear` is what takes those back.

**Pausing.** `POST /analysis/queue/pause` and `/queue/resume` throw one stored flag
(`app_settings.queue_paused`), and `claim_next_run` is the only thing that reads it: both
the local worker set and the runner gateway take their work through that one claim, so a
check there stops every machine rather than only this one, and it holds across a restart.
It is deliberately outside `SETTINGS` and outside `app_settings.replace`, which rewrites the
whole set of keys it knows — a member would be un-paused by the next save of the analysis
form. A run already claimed finishes, for the reason a cancel leaves one alone. The switch
announces itself as `analysis.paused` with `paused`, `queued` and `running`, not as an
`analysis.backfill`: nothing was queued and nothing was dropped.

**Where the workers run.** The FastAPI lifespan starts and stops a set
(`analysis_workers = false` turns that off), and `blunderbase analyze` starts the same set
headless, drains the queue and exits. Each set owns its own engine pool, so stopping one
really does stop the processes it started.

## Remote runners

A runner is a remote **worker**, not a remote engine. Whole jobs go out — a serialized
`RunPlan` — and whole results come back as `MoveEval` payloads. The alternative, tunnelling
UCI per position, would have put a network round trip inside every search and made the
protocol a second engine API to keep honest; this way `analyse_plan` runs unchanged on the
far machine and there is still exactly one definition of what a blunder is.

**The database stays the one queue.** A runner claims nothing itself: the gateway on the
server claims through the same `claim_next_run`, narrowed to `engine_ids` — the engines
that runner advertises — and the local worker set claims with `exclude_engine_ids` so it
never picks up work only another machine can start. One queue, one claim, two kinds of
worker reading it. Scheduling therefore survives a runner dying exactly the way it survives
a restart: the rows are still there.

**The attempt token** is what makes a remote result safe. Every claim writes
`analysis_runs.attempt_token`, every dispatch carries it, and `complete_run` accepts a
payload only while the run is `running` under that token. A runner that reconnected twice
and finally answers for a run the stale sweep took away is told `run_ack{accepted: false}`
and its payload is dropped — idempotent by construction rather than by luck.

**Layering.** `backend/runners/` is a peer of `workers/`, and it is the one package both
halves import: `protocol.py` is the wire contract, so a frame the server sends is a frame
the runner can decode by construction. The rule that keeps it importable from both sides is
that **nothing in it opens a `Session`** — `backend.db.models` is imported because a
`MoveEval` row is what crosses the wire, and `services/analysis.py` because the runner
computes what the server would have, but the database is the server's business alone.

**The runner process** (`runners/client.py`, `blunderbase-runner`) reads a `runner.yaml`,
probes every binary once at startup — which is what replaces the server-side probe for a
remote engine, so a bad UCI option is a rejected advertisement with a reason rather than a
run that fails on another machine an hour later — and owns an `EnginePool` sized to its
slot count. Progress doubles as the run's heartbeat: `analyse_plan` reports every few
positions, and a reporter task sends one at least every heartbeat interval anyway, because
a single very deep position is otherwise a silence the stale sweep collects.

**One run, one machine.** A run's evaluation and its human-move passes share a process, so
both engines have to be on one host. There is no field in an analysis request that could
say "this Stockfish and that Maia", so a search engine on a host with no Maia is refused at
enqueue when the deployment's only Maia is somewhere else, naming both machines. The rule
is about a run with *two* passes: `maia` is settled before the check, and a run queued
without one has a single pass and a single host, so it is never refused for this. A
deployment with no Maia at all is unaffected either way — the pass simply does not happen,
exactly as before runners existed.

**The socket is the transport, polling is the fallback.** After
`reconnect.websocket_failures` consecutive failures the runner starts polling `/runner/poll`
instead and keeps retrying the socket every `reconnect.retry_websocket_seconds`. Both modes
execute a job identically; only where the frames go differs. Stream sessions are
unavailable while polling, and an engine advertised over a poll link reports
`streams: false` for exactly that reason — `POST /streams` on one is refused with
`stream_unavailable` at the request, rather than opening a board that never draws and holds
a slot until the idle reaper takes it.

**Whether an engine drives a board is the host's own word, and a column.** `EngineAd.streams`
is written onto `engines.streams` by `sync_runner_engines` rather than inferred from the
engine's kind, because a host may honestly run queue work and answer no `stream_open` at
all. `engine_payload` reports `engine.streams and kind == "uci"` — the kind still has the
last word, since a Maia answers with a policy however it advertises — and `_resolve` refuses
a session on one, so a coach asking by id gets a sentence instead of a board waiting forever
for a `stream_started`. Every row that predates the column defaults to `true`: a binary on
this host advertises nothing and has always driven a board.

**A runner's engine row is an advertisement, not a binary here.** Its `path` is a path on
that machine, so the two things that start a binary in this process refuse it by name: the
synchronous `POST /analysis/position` resolves the tier `local_only` and says plainly that
the tier's own engine is on another machine rather than handing the work to one nobody
assigned, and the Engines page's test-run button says whose machine the engine is on. Tunnelling a single position to a runner is deliberately outside the
protocol — a runner carries whole runs.

**A browser tab is a runner too.** It speaks the same protocol over the same socket, and
three things bend around it rather than for it. It cannot set an `Authorization` header, so
`/runner/ws` also reads the bearer token out of `Sec-WebSocket-Protocol` behind a sentinel
(`runners.config.WS_SUBPROTOCOL`), which the accept echoes back; never out of the query
string, where a proxy would log it. Its engine is not a binary on any filesystem, so
`engines.path` carries a scheme — `wasm:stockfish-18` — and `services.engines.is_binary_path`
is the single answer to "may this host stat, split or start it", asked by `binary_present`,
`spec_for`, `probe_engine`, `sample_eval` and `command_for` alike. And it is expected to
vanish — a closed laptop, a locked phone, a background tab throttled past the detach window
— so `Runner.browser` is written from its `hello`, and `requeue_stale_runs` gives a run
orphaned by one its attempt back instead of spending it. A run that genuinely *fails* on a
browser engine goes through `fail_run` and costs an attempt like any other: the refund is
for the host going away, not for the work going wrong. The page itself is served
cross-origin isolated so a multi-threaded WASM build can have a `SharedArrayBuffer` — see
`api/web.py` for what `require-corp` costs.

**Two prefixes, deliberately.** `/runner` (singular) is the transport: it carries a
per-runner bearer token and is exempt from the session cookie. `/runners` (plural) is the
owner's CRUD over the same rows and is guarded like everything else — `AuthGuard`'s rule is
`path == prefix or path.startswith(prefix + "/")`, so the plural never falls under the
singular's exemption. Minting a token is the most privileged operation in the application;
it lives behind the same door as the rest of the database.

**The management surface.** `GET /runners` is the row and the live picture in one object:
`connected` and `last_seen_at` are columns, while `transport`, `busy`, `streams` and
`free_slots` are what the gateway knows about the link it is holding. That split is why the
`/runners` handlers are the rare `async def` ones — the gateway's dictionaries belong to the
event loop, so the live half is read there and only the database half goes to a thread.
`POST /runners` answers with the token and a paste-ready `runner.yaml` **once**; only a
SHA-256 is stored, so there is no second reading to offer, and a lost token is a revoke and
a new runner. `DELETE` closes the link with 4403, hands back what it was running with the
attempts refunded — the owner took the machine away, which is not a failed try — and deletes
the engine rows it advertised, because a runner-bound engine is an advertisement rather than
configuration. `GET /runners/status` is the one read the Engines page, the CLI and the
coach's `runners_status` share, so the three cannot drift into three accounts of the same
deployment; `GET /analysis/queue` splits the same backlog by destination, which is what
tells "the queue is long" from "the only machine with that engine is offline". A run with no
engine, or one on a *local* engine that has been switched off, counts as local work — that
is where the worker will look for its tier's engine. A run on a runner's engine stays that runner's
even while the runner is away: the local set claims with every remote engine excluded,
disabled ones included, so nothing here would ever drain it, and counting it as local would
show a backlog against a host that cannot touch it.

**What the coach can and cannot do.** `runners_status` is read-only and reads rows: the MCP
server may be a different process with no gateway to ask, which is the reason `connected` is
a column at all rather than a fact about a socket. Registering a runner means handling a
token, and that stays out of a chat transcript.

## Infinite analysis

An analysis board is a *stream session*: "search this FEN at multipv N until I stop you".
It is ephemeral in the same way the live session is — `services/streams.py` holds the
sessions in memory and **nothing is written to the database**, because a board is a slot on
an engine and a place to send pictures to, and losing one costs a click rather than a row.

**One driver, two backends.** `adapters/infinite.py` is the `go infinite` loop, written
once: a blocking driver a thread owns, merging the engine's per-multipv `info` lines into
one picture and handing it over no more often than `stream_snapshot_interval`. The local
backend (`workers/local_streams.py`) runs it on a slot out of the analysis workers' own
`EnginePool`; the remote one (`workers/runner_streams.py`) sends three frames down a
runner's socket and relays the snapshots back. The broker cannot tell them apart, and
neither can the browser: `runner_id` on the response is context, not a different kind of
session.

**Throttling belongs to the producer**, which is what keeps a runner from putting a flood
on the wire for this process to thin out. **Numbering belongs to the broker**: `seq` is
assigned here so a local board and a remote one are read the same way on `/events`, which
drops its oldest frames rather than growing without bound.

**A board outranks queue work.** On a runner, opening one reserves a slot through the
gateway, preempting the most recently started run if it has to — that run goes back to the
queue with its attempt refunded, because it was taken away rather than failed. A position
change is a stop-and-go on the same slot, never a teardown, so the engine cannot be lost to
the queue in the gap. And a slot nobody is using is a slot the queue should have back: the
reaper ends every session `stream_idle_seconds` after the last `/events` listener leaves.

## The HTTP API

`backend/api/` is a wrapper and nothing else. A handler reads its arguments, calls one
service function and returns what it got; the only database thing in the package is the
Session factory the dependency yields (`api/deps.py`), and no handler writes a query.

**Handlers are sync (`def`), not `async def`.** The Session is synchronous, so a handler
that awaited would block the loop for the length of its query. FastAPI runs a `def`
handler in its threadpool, which is where a blocking database call belongs. The exceptions
are the handlers that do no database work of their own and have an asyncio thing to await
instead: the import trigger, the `/events` socket, the runner transport, and `/streams`,
whose broker owns tasks rather than queries.

**Errors.** `api/errors.py` maps each typed service exception to a status code and a
stable name, and every response body is the same `ErrorResponse` shape — `error` (a name
a client can branch on), `detail` (words for a person) and `fields` on a validation
failure. The table is ordered most-specific-first and looked up along the exception's MRO,
so a new subclass of `EngineValidationError` is a 422 without anyone editing it. Two
catch-alls close the gap: `LookupError` is a 404, `ValueError` a 422, and anything else at
all is `{"error": "internal_error"}` with the exception type named and no traceback.

**Response models.** A model built from a service payload allows extra keys
(`schemas.Payload`): the documented fields are the contract, and a key the service adds —
a stats dimension's own buckets, a new field on a game card — still reaches the client
instead of being filtered out of the response. Request bodies are the opposite
(`schemas.Input`, `extra="forbid"`): a typo in a body is a 422, never a silently dropped
option.

**Imports are not request-shaped.** A first Lichess archive walk takes minutes, so
`POST /import/{source}` resolves the adapter (an unknown source is a 404 before anything
is written), starts `run_import` in a worker thread under its own transaction, and answers
`202` as soon as the `ImportJob` row exists — the id comes from the `import.started` event
the pipeline emits before the adapter's first call. `wait=true` runs it inline and answers
with the finished job instead, which is what the PGN paths and the tests use.
`POST /import/pgn/upload` takes the PGN as the raw request body rather than a multipart
form, so the API needs no form-parsing dependency.

**`/events`.** One WebSocket carrying three hooks: `analysis.subscribe` for run lifecycle,
the `progress=` callable each import is given, and `services.events.subscribe` for what
belongs to neither a run nor a job — `note.created` / `note.updated`, and `live.updated`.
`api/events.py` is the boundary between them — all are called from whichever thread
reached the transition, so `publish` bounces the event onto the loop the sockets live on
and returns immediately. Delivery is deliberately lossy: a socket that falls more than
`CLIENT_BACKLOG` events behind drops its oldest, and a dropped connection is not repaired.
The UI refetches on reconnect.

## The live session

`services/live.py` is one board held in memory, because there is one owner: the game and
ply the coach is showing, or an ad-hoc FEN with the moves played on top of it, plus arrows,
highlights and a comment. The MCP tools `show_game`, `show_position`, `make_move` and
`annotate` drive it and `GET /live` reads it; every mutation publishes `live.updated`
carrying the *whole* new state, so a socket that has the event never needs the route again.
The state lives on the server rather than in the socket, which is what makes a refresh or a
reconnect restore it: the page fetches `/live` once and follows the events.

Three rules hold it together. **It is ephemeral** — nothing here writes a `Game`, a
`Position` or a `MoveEval`, and the one query in the module reads a stored game only in
order to start from it, so the coach can play anything legal on the board without touching
what was actually played. **Legality is the board's** — `make_move` parses the move against
the position as it stands, so an MCP client can never put the browser in a position that
does not exist; playing the followed game's own next move advances `ply` and keeps the
board on that game, and anything else lands in `moves` as a departure from it. **Watching
is countable** — `EventBroker.listen` is every `/events` socket's one entry and exit, so it
is what increments and decrements the `viewer_count` that `get_live_state` reports, which
is how the coach knows whether anyone is actually looking at the board.

The state is process-wide, which is the whole of its storage: one owner, one board, nothing
to migrate and nothing to clean up. That makes the process boundary the feature's one rule:
the browser sees what the coach does only when the MCP tools and the `/events` sockets run
in one process. `blunderbase serve` arranges exactly that — it always mounts the
streamable-HTTP transport at `/mcp` (behind the bearer guard) inside the API app, so a
coach connected there drives the board the browser is watching. The
standalone transports still exist (`blunderbase mcp` for stdio, `--transport http` for its
own uvicorn app), but each is its own process with its own board and no viewers — fine for
querying the database, wrong for live mode. Point the coach at the served `/mcp` when the
board should follow.

**Binding.** `settings.host` defaults to `127.0.0.1`, and `blunderbase serve` binds what
it says. It is no longer what keeps the database private — see below.

## Authentication

The app is deployable on the open internet, so "one owner on loopback" stopped being a
policy and became an open database. There is still exactly one user: no user table, no
registration, and the `Credential` row *is* the account. Its absence is the setup-required
state, which is what the first-run screen routes on.

**Nothing is stored in the clear.** The password is `hashlib.scrypt` (stdlib, no new
dependency) over a per-credential random salt, with `n`, `r` and `p` written onto the row
so they can be raised later without invalidating the credential that exists; verification
is `hmac.compare_digest` against the row's own parameters. A **session token is hashed
too** — the cookie carries 32 random bytes and the database carries their SHA-256, so a
stolen database is not a stolen session and there is nothing in `auth_sessions` worth
reading. Expiry is 30 days, sliding, but the write only happens once a day: a slide per
request would be a write per request.

**Failures are counted.** Five consecutive wrong passwords lock the credential for five
seconds, doubling per further failure to a five-minute cap. The cap is the interesting
part: the counter is shared with the MCP bearer check, so a stranger hammering `/mcp`
must not be able to lock the owner out of their own browser indefinitely.

**One guard, in front of everything.** `api/auth.py` is ASGI middleware rather than a
dependency, so a route added later is guarded by having been added and the `/events`
WebSocket is refused by the same rule as everything else (accepted, then closed with
`4401`, because closing before the accept would reject the handshake with a bare 403 the
page learns nothing from). It is installed *before* `install_web`, which puts it inside
`WebApp` and `ApiPrefix` in the stack: a static file is answered by the web layer and
never reaches it, and the paths it matches have already had `/api` stripped. So the
exemption list is short and all in one place:

| Exempt | Why |
|---|---|
| `/health` | the container's healthcheck has no cookie jar, and runs before setup |
| `/auth/*` | a locked door needs a handle |
| `/mcp` | its own bearer guard, in front of the protocol itself |
| the built web app and `index.html` | the page has to load in order to show the login screen |

An unauthenticated call is always JSON, never a redirect — the client is a `fetch`, and a
302 to a page it cannot render is worse than a status it can branch on. Before anyone has
chosen a password the body says `setup_required` rather than `unauthorized`, which is how
the UI knows which screen to show. The check is a database read, so it goes out to a
worker thread rather than blocking the loop, the same place a `def` handler's queries run.

**The MCP bearer token is the password, or a key minted for the client.** One credential,
two front doors: a deployment set up through the browser has a remote transport without
anyone exporting anything. Keys (`services/mcp_keys.py`, the `mcp_keys` table) follow the
runner-token design — SHA-256 stored, shown once, a row per client so revoking one does not
sign out every browser — and `services.auth.verify_bearer` tries a key before the
password so a key never spends a failed attempt on the password's limiter.
`BLUNDERBASE_MCP_BEARER_KEY` is one more accepted token, checked first and without a
database read, which is what keeps existing automation working while the rest changes
underneath. `/mcp` is
mounted unconditionally — key or no key, password or none yet — because "is there a
password" is a row rather than a setting, and a row can change while the server is serving.
The route is added in the lifespan (after the migration) rather than in `create_app`, since
the lifespan is the only place that can open the task group the transport's sessions live
in and it runs exactly once. Until a password exists the bearer guard answers 401 to
everyone; the first request after first-run setup is the first one it lets through, with no
restart.

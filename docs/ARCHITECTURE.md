# Architecture

Decisions made in phase 1 that everything later has to live with. The product design
lives in `docs/superpowers/specs/`; this file is only about the shape of the code.

## One service layer, three consumers

```
backend/
  adapters/   # network- and process-facing: lichess, chesscom, pgn_import, stockfish, maia, pool
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
analysis workers are asyncio tasks, and they will do their database work in a worker
thread (`asyncio.to_thread` / `run_in_executor`) rather than through an async Session.

Why:

- The expensive thing in an analysis run is the engine subprocess, not the database. A run
  buffers its `MoveEval` rows in memory and commits them once at the end, so the write
  lock is held for milliseconds. Async DB drivers buy concurrency we do not need.
- SQLite's asyncio support is a thread pool underneath in any case, so an async Session
  would be the same threads with more machinery.
- The predecessor ran this exact pattern in production against the same workload, and
  Alembic, the FastAPI dependency style and the test fixtures are all simpler for it.
- The PostgreSQL escape hatch is unaffected: `psycopg` is a synchronous driver by default.

Practical consequence: a `Session` belongs to one thread. `backend.db.session` pools with
the default `QueuePool`, so every Session gets its own connection; never share one across
threads, and never hold one open across an `await`.

## SQLite now, PostgreSQL if it is ever needed

SQLite in WAL mode is the primary store. `BLUNDERBASE_DATABASE_URL` is the seam: set it to
a SQLAlchemy URL and everything — the app, the CLI, Alembic — talks to that instead of the
file at `BLUNDERBASE_DB_PATH`. The rules that keep the escape hatch open:

- Access through SQLAlchemy only — no raw SQL that is not portable, no SQLite-only column
  types, no `INSERT OR REPLACE`.
- Enums are plain `VARCHAR` columns validated in Python (`backend.db.types.EnumString`
  over the `StrEnum`s in `backend.db.enums`). No native PostgreSQL enum type, which would
  need its own migration to gain a member, and no `CHECK` constraint, which SQLite and
  PostgreSQL would recreate differently.
- Timestamps are stored as naive UTC through `backend.db.types.UtcDateTime` and read back
  as aware UTC. SQLite carries no zone and PostgreSQL's `timestamptz` would read a naive
  value in the session's zone, so the conversion is done in Python on both.
- Parsed move lists, clock times, multi-PV lines, Maia policies, note tags and per-game
  import errors are `sqlalchemy.JSON` columns — `JSON` on SQLite, `JSON` on PostgreSQL.
- Migrations run with `render_as_batch=True`, so SQLite's missing `ALTER` is handled by
  table copy while PostgreSQL takes the direct path.

WAL, `foreign_keys=ON` and a busy timeout are set by a `connect` event installed in
`backend.db.session.create_db_engine`, and only when the engine's dialect is SQLite. The
listener is bound to the engine instance rather than to the `Engine` class, so a
PostgreSQL engine in the same process never sees it.

## Source-adapter registration

`backend.services.import_service.SOURCES` maps a source name to the dotted
`module:attribute` path of its adapter's entry point:

```python
SOURCES = {
    "lichess": "backend.adapters.lichess:run",
    "chesscom": "backend.adapters.chesscom:run",
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
- **Enqueues the quick tier.** A `queued` `AnalysisRun` per imported game, against the
  enabled engine whose `default_tier` is `quick`, else any enabled UCI engine. No engine
  means no run — an import must never fail because the engine list is empty.

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
deep request someone is waiting on jumps the FIFO), mark it `running`, and on completion
write every `MoveEval` and the terminal status in one commit. A crash writes `failed` with
the engine's stderr and buys one retry (`attempts` < `MAX_ATTEMPTS`). Re-analysis is
always a new run; old runs are never overwritten.

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
zone) are not things SQLite and PostgreSQL compute the same way. The queries fetch narrow
tuples under SQL filters; the bucketing happens in Python. Same reason `notes` matches
tags after the read: `notes.tags` is a portable JSON column, and searching inside one is
spelled differently on each back end.

Two conventions worth knowing: a `limit` of 0 means "no limit" throughout, and payload
builders drop `None` keys, because a chat model pays for every one of them.

The explorer is a `GamePosition` index walk, never a PGN scan. A tree is one query over
the position's join rows; the "where do I leave book" walk follows the most-played
continuation one position at a time, computing the next position from the move rather than
searching for it, so a transposition into the same line is followed correctly. Book means
the owner's own book — there is no reference database by design — so the walk stops at the
first move they have played in only one game.

## Testing

`tests/conftest.py` gives every later test the same two starting points: `session`, an
in-memory SQLite database built from the models with a `StaticPool` (so one connection is
shared across Sessions and threads and the database survives), and `settings`, a
`tmp_path` file database for anything that needs real Alembic migrations. Engine adapters
are tested against scripted fake UCI processes; tests that need a real Stockfish or Maia
binary carry the `engine` marker and are excluded from the default run.

Set `BLUNDERBASE_TEST_DATABASE_URL` and both of those fixtures point at that server
instead, which is how the whole suite — migrations included — runs against PostgreSQL; CI
runs it both ways. The handful of assertions that are about SQLite itself (WAL mode, the
busy timeout) carry the `sqlite` marker and are skipped on the other back end.

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
  binary declared, and tiers that degrade. `engine_for_tier` returns `None`,
  `tier_status(tier)` explains why in words a UI can show, and only
  `require_engine_for_tier` raises — as `TierUnavailableError`, never as whatever the
  process layer threw. It imports the adapters inside its functions so that listing engines
  does not pull python-chess into the server.

## Analysis

An `AnalysisRun` row *is* the queue. There is no broker, no Redis and no Celery: a run is
enqueued by writing a row, claimed by a conditional `UPDATE`, and survives a restart
because it never lived anywhere else. `services/analysis.py` owns every rule and does it
all synchronously; `workers/analysis_queue.py` owns nothing but the asyncio plumbing.

**Claiming.** `claim_next_run` reads the top candidate by `(priority DESC, created_at,
id)` and then updates it `WHERE id = ? AND status = 'queued'`. A second worker's update
matches no row and it moves on to the next candidate. `SELECT … FOR UPDATE SKIP LOCKED`
would have been the PostgreSQL answer, but SQLite has no row locks at all, and the queue
has to behave identically on both.

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
moment `analysis_concurrency` is 1. Maia is asked only about the owner's own moves (its
question is "what would a human of this rating have played"), at the rating levels
`maia_rating_offsets` puts around the owner's rating in that game, clamped to what the
build declares it can answer. No Maia engine, or a Maia that will not answer, degrades:
the evaluation is still worth having, and the reason is recorded on the run.

**Classification** is win-percentage based, à la Lichess:
`win% = 100 / (1 + exp(-0.00368208 × cp))` with the centipawn score clamped to ±1000 and a
mate in N read as `(21 - min(10, N))` pawns. Both readings of a move are taken in the
mover's own frame, so `win_loss` is what that player gave away. The thresholds
(`inaccuracy` / `mistake` / `blunder`, default 10 / 20 / 30 points) are configuration.
Playing the engine's own first choice is checked before them: a top move that still shows
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
`run_id`, `game_id`, `fen`, `tier`, `status`, `engine_id`, `priority`, `attempts` and
`at`, plus `evals` on done, `error` / `stderr` / `will_retry` on failed, and `done` /
`total` on progress. Events are emitted from whichever thread reached the transition, so
the WebSocket layer has to bounce them onto its own loop. A subscriber that raises is
ignored — it must never be able to fail a run. `analysis.queued` waits for the transaction
that created the run to commit — the import pipeline enqueues the quick pass inside the
one that stores the game — so a rolled-back import never announces a run id that does not
exist.

**Where the workers run.** The FastAPI lifespan starts and stops a set
(`analysis_workers = false` turns that off), and `blunderbase analyze` starts the same set
headless, drains the queue and exits. Each set owns its own engine pool, so stopping one
really does stop the processes it started.

## The HTTP API

`backend/api/` is a wrapper and nothing else. A handler reads its arguments, calls one
service function and returns what it got; the only database thing in the package is the
Session factory the dependency yields (`api/deps.py`), and no handler writes a query.

**Handlers are sync (`def`), not `async def`.** The Session is synchronous, so a handler
that awaited would block the loop for the length of its query. FastAPI runs a `def`
handler in its threadpool, which is where a blocking database call belongs. The two
exceptions are the ones that do no database work of their own: the import trigger and the
`/events` socket.

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
in one process. `blunderbase serve` arranges exactly that — when `BLUNDERBASE_MCP_BEARER_KEY`
is set it mounts the streamable-HTTP transport at `/mcp` (behind the bearer guard) inside
the API app, so a coach connected there drives the board the browser is watching. The
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

**The MCP bearer key is the password.** One credential, two front doors: a deployment set
up through the browser has a remote transport without anyone exporting anything.
`BLUNDERBASE_MCP_BEARER_KEY` is the override — set, it is the only token accepted, which
is what keeps existing automation working while the password changes underneath. `/mcp` is
mounted when either exists, and because "is there a password" is a row rather than a
setting, the answer is taken in the lifespan (after the migration) rather than in
`create_app`: a password chosen through the UI reaches `/mcp` at the next restart.

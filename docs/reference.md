# Reference

The details that used to live in the README: authentication, engines, configuration,
the CLI, releases and testing. Deployment is in [deploy.md](deploy.md), remote runners
in [runners.md](runners.md), the system design in [ARCHITECTURE.md](ARCHITECTURE.md).

## Signing in

One user, one password, no registration. **The first person to open a fresh deployment
chooses the password** — until then every API call answers `401 {"error":
"setup_required"}` and the UI shows the setup screen instead of the login one. After
that, signing in sets an HTTP-only `blunderbase_session` cookie that slides over 30 days,
and every route is behind it except `/health`, `/auth/*`, `/mcp` (which has its own bearer
guard) and the web app's own files — the page has to load in order to show a login form.
Five wrong passwords in a row close the door for a few seconds, doubling to five minutes.

**The MCP bearer token is that same password, or a key you mint for the client.** Nothing
extra to configure: set up the deployment in the browser and the coach connects with what
you already typed. Once more than one client wants in, mint a key per client on
**Assistant**: `bb_mcp_…`, stored as a SHA-256, shown exactly once, and revocable on
its own — deleting a key signs out that one client instead of every browser and the other
coaches. The list shows when each key was last used, so a forgotten one is easy to spot.

`/mcp` accepts, in this order: `BLUNDERBASE_MCP_BEARER_KEY` when set (an extra accepted
token, not a replacement — it is how automation and the compose files keep working while
everything else changes), then a stored key, then the password. `/mcp` is always mounted
and answers 401 to everyone until one of the three exists — so a password chosen in the
browser reaches the coach immediately, with no restart.

```bash
uv run blunderbase set-password    # bootstrap or reset headless; asked twice, never echoed
```

Only the hash is ever stored — `hashlib.scrypt` over a per-credential random salt, with
the cost parameters kept beside it so they can be raised later. Session tokens are stored
hashed too, so a copy of the database is not a way in. A password change signs every other
browser out.

## Engines

Engines are rows, not configuration: on **Engines**, give one a path (a file, a
command line, or a name on `PATH`), and Blunderbase probes the binary, reads the options
it declares and validates what you set against them. The owner assigns one engine to each
of Quick, Deep and Human moves; nothing falls back. If the engine assigned to a role is
switched off, deleted or on a machine that is not connected, that role does not run and
says which engine and why — no other engine quietly takes over.

The page has two tabs. **Engines** opens with "what runs what" — one row each for Quick,
Deep and Human moves, naming the engine assigned to it and, when it cannot run, saying why
in words. Below it is the roster and one engine's whole card. **Machines** (`?tab=machines`,
a link you can be sent to) is the runners, this browser as a runner, and their tokens. An
engine advertises only what kind of thing it is — a UCI engine or a human-move model — and
never claims a role, so a runner's yaml cannot decide what its engines are used for. The
first engine of a kind to be registered does take the roles it fits, which is what makes a
fresh install and a first-time runner work without a visit to the form; it never takes one
that is already assigned.

The image ships **Stockfish** at `/usr/games/stockfish`, and `stockfish` on `PATH` reaches
it — either spelling works in the path field. **Maia** is an lc0 build with its own
weights and is deliberately not bundled: mount it into the container and register the
path. No Maia degrades rather than fails — you lose the human-move predictions, not the
evaluation.

## Opening names

The explorer names a position from a vendored copy of
[lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) — 3,810
openings, **CC0-1.0**, taken at commit `4b86227` (2026-08-04). It lives as
`backend/data/openings.tsv` (`epd`, `eco`, `name`) with the licence text beside it as
`backend/data/openings.COPYING.txt`, and it is read by `backend/adapters/openings.py`.

Upstream ships no EPDs — its `dist/` build is a CI artifact — so the keys are derived here
by replaying each opening's PGN. `uv run python scripts/build_openings.py` regenerates the
table from the pinned commit (`--ref master` for what is current, `--source <dir>` for a
local checkout); bump `UPSTREAM_REF` in the script and the commit above together.

The book is shallow — most openings are named three to five plies in and none past
seventeen — so `/explorer` takes the line it was reached by (`?line=e2e4,e7e5`) and names
the deepest ancestor the book knows, reporting which ply that was. Where the book knows
nothing, the web app falls back to the ECO tags on the owner's own games.

## Configuration

Every setting is an environment variable with a `BLUNDERBASE_` prefix
(`backend/config.py` is the whole list, with defaults and why).

| Variable | Default | |
|---|---|---|
| `BLUNDERBASE_DB_PATH` | `<root>/data/blunderbase.db` | the SQLite file (`/data/blunderbase.db` in the image) |
| `BLUNDERBASE_DATA_DIR` | `<root>/data` | everything written that is not the database |
| `BLUNDERBASE_WEB_DIST` | `<root>/web/dist` | the built web app; a directory that is not there is simply not served |
| `BLUNDERBASE_CROSS_ORIGIN_ISOLATION` | `true` | serve the page with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, which is what a browser wants before it will give a tab a `SharedArrayBuffer` — and without one an engine running in the browser is single-threaded. The cost is that every **cross-origin** subresource must opt in with CORP or be blocked; the build loads none today. Turn it off for a proxy that rewrites the headers, or a page that has to load an asset from somewhere else |
| `BLUNDERBASE_HOST` `BLUNDERBASE_PORT` | `127.0.0.1` `8765` | what `serve` binds |
| `BLUNDERBASE_MCP_BEARER_KEY` | — | one more token `/mcp` accepts, beside the minted keys and the owner's password; for compose files and automation |
| `BLUNDERBASE_ANALYSIS_CONCURRENCY` | cores − 2 | engine processes at once, across every tier |
| `BLUNDERBASE_ANALYSIS_WORKERS` | `true` | off for a deployment that drains the queue from `blunderbase analyze` elsewhere |

The engine budgets, the classification thresholds and everything about the Maia pass are
**not** variables. They are stored in the database, edited under **Analysis → Engine
passes** and **Analysis → Maia** (`GET`/`PUT /api/settings`,
`backend/services/app_settings.py`), and read where they are used, so a change takes
effect on the next thing you click rather than the next restart.
Unset means the default in that table, not a null.

| Setting | Default | |
|---|---|---|
| `maia_target_elo` | `2000` | the single rating every Maia question is asked at — the rating you are playing towards, clamped to 1100–2000. Analysis bakes it into every ply it asks about and the analysis board queries it live, so nothing ever asks about two different humans |
| `maia_on_quick` `maia_on_deep` | `1` `0` | whether a pass of that tier also asks the human-move model. Read when a run is queued, like the budgets. The Maia half is 40-70% of a quick pass, and a deep pass would recompute the policy the quick one already stored, so deep is off — use the fill button to add levels to a game that only ever had a deep pass |
| `maia_both_sides` | `1` | ask Maia about every ply, both colours. `0` asks about your own moves only and halves what the pass costs; you lose "what will a human opposite me fall into", which is a question about the positions your opponent moves in. Read per plan, not at enqueue |
| `quick_nodes` `deep_nodes` `deep_multipv` | `250000` `2000000` `4` | the per-position budget of each tier, and the lines a deep pass keeps. Read when a run is queued, so they size the next run rather than the queue |
| `inaccuracy_threshold` `mistake_threshold` `blunder_threshold` | `5` `10` `15` | win-percentage points lost by the mover — Lichess's own cuts on the same curve. The three have to rise; a set of them that does not is the one change refused rather than clamped |

Everything else out of range is clamped rather than refused, so what a save answers with is
what is in force. Budgets and thresholds apply to runs from then on; a game already
analysed keeps the numbers it was analysed with until a fresh pass runs over it.

## Deleting games

Games go from the library screen: the ✕ at the end of a row, or a selection and **Delete**
in the footer. A game takes its analysis, the notes written about it and the variations
kept off it; notes about a *position* stay, and so does the sync history — the cursor is
what stops the next sync starting over.

Deleting a game deletes the only record of it, and the importer deduplicates by looking in
the games table, so a deleted game would otherwise come straight back: chess.com re-reads
the archive month that is still being played on every sync. Each deleted game therefore
leaves a row in `deleted_games` — the source and its ID, plus the content hash that catches
the same game arriving as a PGN with no ID — and any import that meets it again leaves it
alone and counts it as **previously deleted**, apart from the games it skipped as
duplicates.

A sync normally starts where the last one stopped — Lichess and FICS resume from a stored
cursor, chess.com re-reads the month still being played. **From the beginning**, in the
strip above the sources table, ignores that cursor and reads the whole archive (`since=all`
on the API and the CLI, which every account source understands). It is safe to press: games
already in the library are skipped as duplicates, and deleted games are refused by the
record below rather than quietly restored.

**Library → Manage → Deleted games** lists those records and is the only way back:
forgetting one lets the next import store that game again, as a new game with no analysis
and no notes. The card is not shown until something has been deleted. Resetting the whole
library writes no records at all — a reset means starting over, and a library of them would
block the re-import that follows.

## Export, backup and restore

**Library → Manage → Export PGN** downloads every stored game in one
`blunderbase-library.pgn`. Original PGN headers, comments and variations are preserved;
Blunderbase notes are comments and saved lines are variations. This is the portable copy
for chess software. It is not a lossless application backup: PGN cannot carry engine
evaluations, accounts, analysis settings or import cursors.

**Library → Manage → Download backup** creates the lossless, integrity-checked SQLite
copy. It includes games, annotations, analysis, accounts and settings, as well as
installation-local credentials and engine configuration. Store it like a password: hashes
and API-key hashes are not plaintext, but the file is still private. A backup may be taken
while Blunderbase is running; SQLite's online backup API includes all committed WAL
transactions in one consistent snapshot.
Restoration is deliberately not available in the running web app: it replaces the database
under the process and therefore remains an offline CLI operation.

```bash
uv run blunderbase db backup /safe/place/blunderbase-2026-09-01.db
# ... on the replacement installation, with Blunderbase stopped:
uv run blunderbase db restore /safe/place/blunderbase-2026-09-01.db --force
uv run blunderbase db upgrade
```

Both commands run SQLite's full integrity check, require a Blunderbase schema revision,
and print the byte count, revision and SHA-256. The backup and restore SHA-256 values must
match. Restore verifies the input before touching the configured database, installs it by
atomic rename, and refuses to replace an existing database without `--force`. Stop every
process using that database before restore; then start Blunderbase and confirm the Library
count. `db upgrade` is safe when restoring an older release and is a no-op at the current
revision.

For Docker, copy the verified backup out of the named volume rather than leaving the only
copy beside the live database:

```bash
docker exec blunderbase blunderbase db backup /data/blunderbase-backup.db
docker cp blunderbase:/data/blunderbase-backup.db ./blunderbase-backup.db

docker compose -f docker/docker-compose.yml stop blunderbase
docker cp ./blunderbase-backup.db blunderbase:/data/restore.db
docker compose -f docker/docker-compose.yml run --rm --no-deps \
  --entrypoint blunderbase blunderbase db restore /data/restore.db --force
docker compose -f docker/docker-compose.yml up -d blunderbase
```

## Commands

`uv run blunderbase …` — `serve`, `import <lichess|chesscom|fics|pgn> …`,
`accounts <list|add|reconcile>`, `analyze` (queue a
tier and drain it in this process), `mcp [--transport stdio|http]`, `set-password`,
`db upgrade`, `db backup`, `db restore`, `db rebuild-cards`, `db rebuild-stats`,
`db rebuild-book`, and
`demo create`. The
queue is `analysis_runs` rows rather than a broker, so `blunderbase analyze` is safe to
run while the server is up, and nothing is lost across a restart.

`db rebuild-cards` and `db rebuild-stats` recompute what a game keeps precomputed about its
own analysis — the card the games table draws, and the per-game summary every stats
dimension adds up. Neither is ever required: a finished run rewrites both for its own game,
and what is missing is computed the slow way on the way out. They are for a library
analysed before those columns existed, and `serve` already runs the summary sweep in the
background at boot, so the command is only for doing it now and watching it finish.

`db rebuild-book` is the same bargain for the opening explorer: it folds the continuations
of every position enough games reach to be worth writing down, and marks the rest as
deliberately left out. A position the book does not describe is folded live exactly as it
always was, so this buys speed rather than correctness — and `serve` runs this sweep in the
background too.

`accounts add lichess <username>` names a username as one of yours and claims the games
already stored under it — that is what fills in the colour, opponent and ratings of an
archive imported before any account said which player was you. `accounts reconcile` runs
the same repair for every account; it is idempotent, and never revises a game whose side
is already known.

`demo create` reads a varied sample of analyzed games from `BLUNDERBASE_DB_PATH` and writes
`<data-dir>/demo.db`. Use `--games N` to size it, `--as-of YYYY-MM-DD` to pin the fake date
range, `--from` or `--output` to choose either file, and `--force` to explicitly replace an
old output. It reconstructs PGNs without comments and fabricates all identifying metadata;
credentials and personal notes are never copied. Run the result as an ordinary deployment:

```bash
uv run blunderbase demo create --games 72
BLUNDERBASE_DB_PATH=data/demo.db uv run blunderbase serve
```

## Cutting a release

```bash
make release v=0.2.0        # bump, commit, tag
make release v=0.2.0 DRY=1  # print what that would do, change nothing
```

The version lives in two places, `pyproject.toml` and `web/package.json`, and the target
moves both plus `uv.lock` in one `chore: release vX.Y.Z` commit, then adds an annotated
`vX.Y.Z` tag. Everything else reads one of those two: `blunderbase --version` via
`importlib.metadata`, the sidebar footer via Vite's `define`.

It refuses to run on a dirty tree, off `main`, on a version that is not `X.Y.Z`
(optionally `X.Y.Z-rc.1`), or when the tag already exists. Nothing is pushed until you
publish it:

```bash
make publish
```

Publishing pushes main and the tag, waits for that commit's main CI, then creates the
GitHub release. The release builds the image once and publishes
`ghcr.io/philphilphil/blunderbase:0.2.0`, `:0.2`, `latest`, and `sha-<short>`.
If that build fails, dispatch `release.yml` with the existing tag to rebuild and deploy it;
dispatching it without a tag only redeploys the current `latest`.

## Testing

```bash
make test                                       # uv run pytest + pnpm test
uv run pytest -m slow                           # the seven that wait on a real clock
uv run pytest -m engine                         # the suite that wants a real binary
uv run pytest -n0                               # back on one process, for a breakpoint
```

Two markers are deselected from the default run, so that the run you type between edits
answers in seconds. **`engine`** wants a real Stockfish or Maia; the adapters are otherwise
covered by scripted fake UCI processes, so the default run needs no binary at all.
**`slow`** is seven tests that wait on a wall clock rather than on an event — a reconnect
window running out, a shutdown grace period — and were forty of the suite's hundred-odd
seconds. Worth running by hand after touching `backend/runners/`.

The default run also goes across your cores (`-n auto`, in `pyproject.toml`): the tests
share nothing but a temporary SQLite file apiece. Together with the markers that takes the
backend suite from about 140 seconds to under 20. Use `-n0` when you want a breakpoint.

CI runs both: the default suite and `-m slow`. `make publish` waits for both before opening
the release, so the tag that ships is a tag both passed on. `engine` runs nowhere but your
machine.

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

## Commands

`uv run blunderbase …` — `serve`, `import <lichess|chesscom|pgn> …`,
`accounts <list|add|reconcile>`, `analyze` (queue a
tier and drain it in this process), `mcp [--transport stdio|http]`, `set-password`,
`db upgrade`. The
queue is `analysis_runs` rows rather than a broker, so `blunderbase analyze` is safe to
run while the server is up, and nothing is lost across a restart.

`accounts add lichess <username>` names a username as one of yours and claims the games
already stored under it — that is what fills in the colour, opponent and ratings of an
archive imported before any account said which player was you. `accounts reconcile` runs
the same repair for every account; it is idempotent, and never revises a game whose side
is already known.

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
(optionally `X.Y.Z-rc.1`), or when the tag already exists. Nothing is pushed — publish it
yourself:

```bash
git push origin main --follow-tags
```

That tag push builds the image again and publishes
`ghcr.io/philphilphil/blunderbase:0.2.0` and `:0.2`, on top of the `latest` and
`sha-<short>` the main push publishes.

## Testing

```bash
make test                                       # uv run pytest + pnpm test
uv run pytest -m engine                         # the suite that wants a real binary
```

Engine adapters are covered by scripted fake UCI processes, so the default run needs no
binary. CI lints, runs the whole suite, then builds and pushes the image from `main`.

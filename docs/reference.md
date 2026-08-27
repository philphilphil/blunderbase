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

**The MCP bearer key is that same password.** Nothing extra to configure: set up the
deployment in the browser and the coach connects with what you already typed. Changing the
password changes the key. `BLUNDERBASE_MCP_BEARER_KEY` stays an override — set it and it
is the only token `/mcp` accepts, which is how automation and the compose files keep
working while the password changes underneath. `/mcp` is always mounted and answers 401
to everyone until one of the two exists — so a password chosen in the browser reaches the
coach immediately, with no restart.

```bash
uv run blunderbase set-password    # bootstrap or reset headless; asked twice, never echoed
```

Only the hash is ever stored — `hashlib.scrypt` over a per-credential random salt, with
the cost parameters kept beside it so they can be raised later. Session tokens are stored
hashed too, so a copy of the database is not a way in. A password change signs every other
browser out.

## Engines

Engines are rows, not configuration: **Settings → Engines**, give it a path (a file, a
command line, or a name on `PATH`), and Blunderbase probes the binary, reads the options
it declares and validates what you set against them. Tiers point at engine IDs, so which
engine runs the quick pass and which runs the deep one is a UI choice.

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
| `BLUNDERBASE_DATABASE_URL` | — | a full SQLAlchemy URL, and the only seam the PostgreSQL escape hatch needs |
| `BLUNDERBASE_DATA_DIR` | `<root>/data` | everything written that is not the database |
| `BLUNDERBASE_WEB_DIST` | `<root>/web/dist` | the built web app; a directory that is not there is simply not served |
| `BLUNDERBASE_HOST` `BLUNDERBASE_PORT` | `127.0.0.1` `8765` | what `serve` binds |
| `BLUNDERBASE_MCP_BEARER_KEY` | — | overrides the password as `/mcp`'s bearer key; unset, `/mcp` accepts the owner's password as soon as there is one |
| `BLUNDERBASE_ANALYSIS_CONCURRENCY` | cores − 2 | engine processes at once, across every tier |
| `BLUNDERBASE_ANALYSIS_WORKERS` | `true` | off for a deployment that drains the queue from `blunderbase analyze` elsewhere |

The engine budgets, the classification thresholds and the Maia levels are **not**
variables. They are app settings: stored in the database, edited on the Settings page
(`GET`/`PUT /api/settings`, `backend/services/app_settings.py`), and read where they are
used, so a change takes effect on the next thing you click rather than the next restart.
Unset means the default in that table, not a null.

| Setting | Default | |
|---|---|---|
| `maia_target_elo` | — | the single rating every Maia question is asked at, clamped to 1100–2000; set, analysis bakes it into every ply of both sides and the analysis board queries it live. Cleared, Maia is asked about your own moves only, at one level centred on your rating in that game |
| `quick_nodes` `deep_nodes` `deep_multipv` | `250000` `2000000` `4` | the per-position budget of each tier, and the lines a deep pass keeps. Read when a run is queued, so they size the next run rather than the queue |
| `inaccuracy_threshold` `mistake_threshold` `blunder_threshold` | `5` `10` `15` | win-percentage points lost by the mover — Lichess's own cuts on the same curve. The three have to rise; a set of them that does not is the one change refused rather than clamped |
| `default_owner_rating` | `1500` | the rating to centre Maia on where the game carries none — an OTB PGN, an unrated game |

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
BLUNDERBASE_TEST_DATABASE_URL=postgresql+psycopg://… uv run pytest
```

Engine adapters are covered by scripted fake UCI processes, so the default run needs no
binary. CI runs the whole suite against SQLite and against PostgreSQL — the escape hatch
is only honest if the tests go through it — then builds and pushes the image from `main`.

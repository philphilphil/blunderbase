# Configuration

Every setting is an environment variable with a `BLUNDERBASE_` prefix. Set them in the
compose file's `environment:` block, in the shell that starts the process, or however your
supervisor does it.

A variable that is present but empty means *unset*: a commented-out line somebody
uncommented and left blank falls back to the default rather than refusing to start.

Not everything is a variable. The engine budgets, the classification thresholds, the Maia
rating, the automatic-sync interval and the Lichess explorer token are stored in the
database and edited in the app, because they are the ones you change as your play changes.
They take effect on the next thing you click, not on the next restart. See
[Analysis](../guide/analysis.md) and [Settings](../guide/settings.md).

## Paths

| Variable | Default | What it does |
|---|---|---|
| `BLUNDERBASE_ROOT` | The installation directory | What every relative path below is resolved against |
| `BLUNDERBASE_DATA_DIR` | `<root>/data` | Everything written that is not the database: uploaded PGN files, downloaded engines and weights. `/data` in the Docker image |
| `BLUNDERBASE_DB_PATH` | `<data dir>/blunderbase.db` | The SQLite file. `/data/blunderbase.db` in the Docker image |
| `BLUNDERBASE_WEB_DIST` | `<root>/web/dist` | The built web app, served by the same process. A directory that is not there is simply not served |
| `BLUNDERBASE_MANUAL_DIR` | `<root>/manual-site` | This manual, served at `/manual` without a login so it matches the version that is running and works with no way out to the internet. A directory that is not there is simply not served |

## Runtime and access

| Variable | Default | What it does |
|---|---|---|
| `BLUNDERBASE_RUNTIME_MODE` | `server` | `server`, `desktop` or `demo`. `desktop` is the native shell's mode and needs `BLUNDERBASE_DESKTOP_TOKEN`. `demo` is the public, read-only mode: no password, no `/mcp`, every write answers `403 read_only`, and runners only with tokens the source library already had. Only ever for a database `blunderbase demo create` built |
| `BLUNDERBASE_DESKTOP_TOKEN` | empty | The per-launch secret the desktop shell authenticates its own window with. 64 lowercase hexadecimal characters, and required in `desktop` mode. The native application sets it; you do not |
| `BLUNDERBASE_MCP_BEARER_KEY` | empty | One more token `/mcp` accepts, beside the keys minted on Assistant and the owner's password. For compose files and automation |
| `BLUNDERBASE_CROSS_ORIGIN_ISOLATION` | `true` | Serve the page with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, which is what a browser wants before it gives a tab a `SharedArrayBuffer` — and without one an engine running in the browser is single-threaded. The cost is that every cross-origin subresource must opt in with `Cross-Origin-Resource-Policy` or be blocked; the build loads none. Turn it off behind a proxy that rewrites those headers, or for a page that has to load an asset from somewhere else |

## Network

| Variable | Default | What it does |
|---|---|---|
| `BLUNDERBASE_HOST` | `127.0.0.1` | What `serve` binds. The Docker image starts with `0.0.0.0` |
| `BLUNDERBASE_PORT` | `8765` | The port `serve` binds. `blunderbase mcp --transport http` uses this plus one |
| `BLUNDERBASE_PUBLIC_URL` | empty | How this installation is reached from outside. Written into the `runner.yaml` the create-runner flow hands over; empty falls back to the requesting origin. Set it to the proxy's URL. See [Deploy](deploy.md) |

## Analysis

| Variable | Default | What it does |
|---|---|---|
| `BLUNDERBASE_ANALYSIS_CONCURRENCY` | The machine's cores minus two, never below 1 | Engine processes running at once, shared across tiers. This caps CPU, not connections |
| `BLUNDERBASE_ANALYSIS_WORKERS` | `true` | Whether this process runs the analysis workers itself. Turn it off for an installation that drives the queue from `blunderbase analyze` on another schedule, and for the read-only demo |
| `BLUNDERBASE_ANALYSIS_POLL_SECONDS` | `1.0` | How long an idle worker waits before looking at the queue again |
| `BLUNDERBASE_AUTO_SYNC_POLL_SECONDS` | `60.0` | How often the scheduled import looks at the clock. The interval itself is an application setting, off by default, so this only decides how late a sync can be |

## The analysis board

The live, continuously updating board. See [Analysis](../guide/analysis.md).

| Variable | Default | What it does |
|---|---|---|
| `BLUNDERBASE_STREAM_SNAPSHOT_INTERVAL` | `0.5` | How often, in seconds, a running search publishes a new snapshot |
| `BLUNDERBASE_STREAM_IDLE_SECONDS` | `30.0` | How long a session survives with nobody listening before it frees its slot |
| `BLUNDERBASE_STREAM_MAX_SESSIONS` | `3` | Analysis boards at once. One per surface: the game board, the live board and the companion application |

## Runners

These are read by the **server**, about the runners connected to it. The runner process
reads its own set, listed below. See [Remote runners](runners.md).

| Variable | Default | What it does |
|---|---|---|
| `BLUNDERBASE_RUNNER_HEARTBEAT_SECONDS` | `10.0` | How often the server pings a connected runner |
| `BLUNDERBASE_RUNNER_POLL_SECONDS` | `5.0` | How often a runner that has fallen back to HTTP comes back for work |
| `BLUNDERBASE_RUNNER_STALE_SWEEP_SECONDS` | `20.0` | How often the server sweeps for runs a runner abandoned |

Every one of these has a default, so an installation with no runners registered behaves
exactly as it did before runners existed.

## Read by the runner process

Set these where `blunderbase-runner` runs, not on the server. Each beats the same key in
`runner.yaml`.

| Variable | What it does |
|---|---|
| `BLUNDERBASE_RUNNER_CONFIG` | The `runner.yaml` to read when `--config` is not given |
| `BLUNDERBASE_RUNNER_SERVER` | The server URL to dial |
| `BLUNDERBASE_RUNNER_TOKEN` | The runner's token |
| `BLUNDERBASE_RUNNER_NAME` | The runner's name |
| `BLUNDERBASE_RUNNER_SLOTS` | Engine jobs and analysis boards at once |

## Not ours

`FORWARDED_ALLOW_IPS` belongs to uvicorn, the server underneath. It decides which addresses
may be trusted for `X-Forwarded-Proto` and its siblings, and defaults to `127.0.0.1`. A
proxy in another container needs its address here for the app to know the request arrived
over TLS. See [Deploy](deploy.md#settings-worth-knowing).

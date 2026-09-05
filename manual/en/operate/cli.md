# Command line

Two commands are installed: `blunderbase`, the application, and `blunderbase-runner`, the
[remote runner](runners.md).

In Docker, prefix anything below with `docker exec -it blunderbase`, or run it as a one-off:

```bash
docker exec -it blunderbase blunderbase engines list
```

Both read the same [configuration](configuration.md) as the server, so
`BLUNDERBASE_DB_PATH` decides which library a command touches.

```console
$ blunderbase --version
```

## serve

Run the HTTP API, the web app, the `/events` socket, `/mcp` and the analysis workers.

```console
$ blunderbase serve --host 0.0.0.0 --port 8765
```

| Flag | Default | What it does |
|---|---|---|
| `--host` | `BLUNDERBASE_HOST` | The address to bind |
| `--port` | `BLUNDERBASE_PORT` | The port to bind |
| `--reload` | off | Restart on a source change |

## import

Import games from one source. `pgn` reads a file; the others sync an account.

```console
$ blunderbase import lichess yourname
$ blunderbase import pgn archive.pgn --not-mine
```

The source is `lichess`, `chesscom`, `fics` or `pgn`. The second argument is the account to
sync, or the file to read.

| Flag | What it does |
|---|---|
| `--username` | The account to sync, instead of the positional argument |
| `--path` | The PGN file to read, instead of the positional argument |
| `--since` | Resume from this cursor instead of the stored one. `all` reads the whole archive |
| `--max-games N` | Stop after N games |
| `--not-mine` | The PGN holds somebody else's games: store them for study, count them in no statistic |

Stop a running import with Ctrl-C. Everything already imported stays, and the next import
picks up from there. See [Library](../guide/library.md#import).

## accounts

The usernames that make a game yours.

```console
$ blunderbase accounts list
$ blunderbase accounts add lichess yourname
$ blunderbase accounts reconcile
```

| Command | What it does |
|---|---|
| `blunderbase accounts list` | Every account and the games attributed to it |
| `blunderbase accounts add <platform> <username>` | Register an account and claim the games it has already played. The platform is `lichess`, `chesscom`, `fics` or `otb` |
| `blunderbase accounts reconcile` | Re-run owner attribution over the games already stored |

`reconcile` is idempotent and never revises a game whose side is already known. It is what
fills in the colour, opponent and ratings of an archive imported before any account said
which player was you.

## runners

The machines allowed to run engine work. Full guide: [Remote runners](runners.md).

```console
$ blunderbase runners list
$ blunderbase runners create gpu-box --slots 8
$ blunderbase runners revoke gpu-box
```

| Command | What it does |
|---|---|
| `blunderbase runners list` | Every runner, what it advertises and its backlog |
| `blunderbase runners create <name>` | Register a runner and print its token and `runner.yaml`, once |
| `blunderbase runners revoke <name>` | Delete a runner, its token and the engines it advertised |

`create` takes:

| Flag | Default | What it does |
|---|---|---|
| `--slots N` | `1` | Engine jobs at once |
| `--server` | `BLUNDERBASE_PUBLIC_URL` | How the runner reaches this server |

## engines

The engine binaries on **this** machine. Full guide: [Engines](engines.md).

```console
$ blunderbase engines list
$ blunderbase engines add sf-local stockfish --option Threads=4 --role quick --role deep
$ blunderbase engines remove sf-local
```

| Command | What it does |
|---|---|
| `blunderbase engines list` | Every engine row, where it lives and what it serves |
| `blunderbase engines add <name> <path>` | Register a binary on this host and, optionally, give it its roles |
| `blunderbase engines remove <name>` | Delete an engine row and unqueue what only it could have run |

`add` takes a path that is a file, a command line with arguments, or a name on `PATH`, and:

| Flag | Default | What it does |
|---|---|---|
| `--kind` | `uci` | `uci` or `maia` |
| `--option NAME=VALUE` | — | A UCI option, validated against what the binary declares. Repeatable |
| `--role` | — | `quick`, `deep` or `human`, taken from whatever holds it. Repeatable. Without it, only unassigned roles are filled |
| `--replace` | off | Update the engine of this name instead of refusing, and enable it |
| `--disabled` | off | Register it without switching it on |

## analyze

Queue engine analysis and drain the queue in this process. The queue is rows in the
database rather than a broker, so this is safe to run while the server is up and nothing is
lost across a restart.

```console
$ blunderbase analyze --tier deep --limit 50
$ blunderbase analyze --fen "rn1qkb1r/..." --nodes 4000000
```

| Flag | Default | What it does |
|---|---|---|
| `--game-id N` | every pending game | Analyse one game |
| `--tier` | `quick` | `quick` or `deep` |
| `--fen` | — | Analyse one position instead of a game |
| `--ply-range START:END` | the whole game | The half-moves a deep pass should look at, end exclusive |
| `--multipv N` | the stored setting | Lines to keep |
| `--nodes N` | the stored setting | The per-position budget |
| `--limit N` | — | Queue at most N games |
| `--queue-only` | off | Enqueue without running the workers |
| `--timeout` | `3600` | Give up waiting after this many seconds |

## mcp

Run the MCP server on its own. `serve` already mounts `/mcp`, so this is for a
local client that wants a process of its own over stdio.

```console
$ blunderbase mcp
$ blunderbase mcp --transport http
```

| Flag | Default | What it does |
|---|---|---|
| `--transport` | `stdio` | `stdio` for a local client; `http` needs `BLUNDERBASE_MCP_BEARER_KEY` |
| `--host` | `BLUNDERBASE_HOST` | The address to bind, for `http` |
| `--port` | `BLUNDERBASE_PORT` plus one | The port to bind, for `http` |

See [Your AI assistant](../guide/coach.md).

## set-password

Set or replace the owner's password, which is also an accepted MCP bearer token. Asked
twice, never echoed.

```console
$ blunderbase set-password
```

## db

Database maintenance. Backup and restore are [Backup and restore](backup.md).

```console
$ blunderbase db upgrade
$ blunderbase db backup /safe/place/blunderbase-2026-09-01.db
$ blunderbase db restore /safe/place/blunderbase-2026-09-01.db --force
```

| Command | What it does |
|---|---|
| `blunderbase db upgrade` | Apply pending migrations. Safe when restoring an older release, and a no-op at the current revision |
| `blunderbase db backup <output>` | Write an integrity-checked copy of the complete database. `--force` replaces an existing output file |
| `blunderbase db restore <input>` | Replace the database with an integrity-checked backup. `--force` is required to replace an existing database |
| `blunderbase db rebuild-cards` | Recompute the stored card of every analysed game |
| `blunderbase db rebuild-stats` | Recompute the stored stat summary of every analysed game |
| `blunderbase db rebuild-book` | Recompute the explorer's precomputed opening book over every position |

The three `rebuild` commands are never required. A finished analysis run rewrites what it
touched, and anything missing is computed the slow way on the way out. `serve` runs the
stats and book sweeps in the background at start-up, so these are for doing it now and
watching it finish — after importing a large archive, or on a library analysed before those
columns existed.

## demo

Build an anonymous database to serve read-only. See
[A read-only public demo](deploy.md#a-read-only-public-demo).

```console
$ blunderbase demo create --games 3000
```

`blunderbase demo create` reads a varied sample of analysed games from the configured
library and writes a separate database. It reconstructs PGN text without comments and
fabricates every identifying detail; credentials and personal notes are never copied. Every
game arrives with a completed Quick pass and the result carries no engine row, so nothing
ever has to run on the machine serving it.

| Flag | Default | What it does |
|---|---|---|
| `--from` | `BLUNDERBASE_DB_PATH` | The source library |
| `--output` | `<data dir>/demo.db` | The new demo database |
| `--games N` | `3000` | How many games to take |
| `--as-of YYYY-MM-DD` | today | The newest fake game date |
| `--force` | off | Replace an existing output database |
| `--runners` | off | Copy the runner rows — name, slots and the token's hash, nothing else — so a runner that dials into the source library dials into the demo with the token it already has |

## blunderbase-runner

Run chess engines for a Blunderbase server on this machine. The configuration file and
every key in it are in [Remote runners](runners.md).

```console
$ blunderbase-runner --config runner.yaml --check
$ blunderbase-runner --config runner.yaml
```

| Flag | What it does |
|---|---|
| `--version` | Print the version and exit |
| `--config PATH` | The `runner.yaml` to read. Defaults to `BLUNDERBASE_RUNNER_CONFIG`, and failing that the environment alone |
| `--check` | Probe every engine, open one connection, print what was accepted, and exit. Do not run it on a timer: it takes a running runner over |
| `--log-level` | `debug`, `info`, `warning` or `error`. Overrides `log_level` in the file |

Exit codes: `0` stopped as asked, `1` the configuration is wrong or no engine could be
started, `2` the server refused this runner's protocol version.

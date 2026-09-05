# Remote runners

A **runner** is a second Blunderbase process on a machine with cores to spare. It has no
database and serves no page. It dials *out* to your server, says which engines it has, and
is handed whole analysis jobs and analysis boards. Nothing about a finished run says where
it happened.

Use one when the machine running Blunderbase is not the machine you want doing the
searching.

## 1. Register the runner on the server

On the server:

```console
$ blunderbase runners create gpu-box --slots 8
runner 'gpu-box' registered with 8 slot(s)
This token is shown once. Save the yaml below as runner.yaml on that machine:

# blunderbase runner — blunderbase-runner --config runner.yaml
# The token below is shown once. Keep this file readable only by the runner.
server: "https://blunderbase.example.com"
token: "bb_rnr_kY3…"
name: "gpu-box"
slots: 8
engines:
  # One entry per engine on THIS machine. Edit the paths before starting.
  - name: sf-remote
    path: /usr/games/stockfish
    options:
      Threads: 8
```

**Add a remote runner** under **Compute capacity** on the Engines page does the same thing
and answers with the same yaml. Either way the token is handed over once and never again: only its SHA-256 is stored.
A lost token is a revoke and a new runner, which costs nothing.

`--server` overrides the URL written into the yaml. Without it the command uses
`BLUNDERBASE_PUBLIC_URL`, and failing that the address the server process binds. Set
`BLUNDERBASE_PUBLIC_URL` on an installation behind a proxy — the server cannot otherwise
know what it is called from outside. See [Deploy](deploy.md#settings-worth-knowing).

## 2. Write `runner.yaml` on the other machine

Every key, with its default.

### Top level

| Key | Default | What it is |
|---|---|---|
| `server` | required | The `http` or `https` URL of your Blunderbase. The `ws`/`wss` URL is derived from it |
| `token` | required | From `runners create`, shown once |
| `name` | required | Informational — the token is the identity |
| `slots` | `1` | Engine jobs plus analysis boards at once |
| `verify_tls` | `true` | Whether the server's certificate is verified |
| `poll_seconds` | `5.0` | How often the HTTP fallback asks for work |
| `log_level` | `info` | `debug`, `info`, `warning` or `error` |
| `reconnect` | see below | How hard the runner tries to get back |
| `engines` | `[]` | One entry per binary on this machine |

### `reconnect`

| Key | Default | What it is |
|---|---|---|
| `initial_seconds` | `1.0` | Backoff floor, with jitter |
| `max_seconds` | `60.0` | Backoff ceiling |
| `websocket_failures` | `3` | Failures *to connect* before the runner falls back to polling |
| `retry_websocket_seconds` | `60.0` | How often a polling runner retries the socket |

### An entry under `engines`

| Key | Default | What it is |
|---|---|---|
| `name` | required | Unique on this machine; becomes the engine's name on the server |
| `path` | required | The path on **this** machine; a file or a full command line |
| `kind` | `uci` | `uci` or `maia` |
| `options` | `{}` | UCI options, validated at start-up against what the binary declares |
| `streams` | `true` for `uci` | Whether this engine may drive an analysis board. A Maia never streams, however this is written |
| `instances` | one process per slot | How many copies of this binary may run at once |
| `tier` | — | Accepted and ignored. A file written before roles existed still starts |

A whole file:

```yaml
# required
server: https://blunderbase.example.com
token: bb_rnr_…
name: gpu-box

# optional
slots: 4
verify_tls: true
poll_seconds: 5.0
log_level: info

reconnect:
  initial_seconds: 1.0
  max_seconds: 60.0
  websocket_failures: 3
  retry_websocket_seconds: 60.0

engines:
  - name: sf-remote
    path: /usr/games/stockfish
    kind: uci
    options:
      Threads: 8
      Hash: 4096
    streams: true
    instances: 2

  - name: maia3
    path: /engines/maia3/bin/maia3-5m
    kind: maia
    instances: 1   # one GPU process shared by all slots
```

`instances` is the one thing an engine can say about how it is *run*. Without it, every
slot that wants this engine gets its own process, which is right for a CPU binary and wrong
for anything holding a single accelerator: a Maia on one GPU wants `instances: 1`, so the
slots queue on one process instead of starting a second and running the card out of memory.
It can only lower the number of processes, never raise it above `slots`.

**An unrecognised key is refused by name rather than ignored.** A typo in a slot count is a
mistake, not a preference, and the refusal names the field and the file it came from.

A runner advertises what it *has* and claims nothing about what it is *for*. Which engine
serves Quick, Deep and Human moves is assigned on the [Engines](engines.md) page.

Four values can come from the environment instead of the file, and beat it, so a token need
not live in something that gets copied around:

| Variable | Replaces |
|---|---|
| `BLUNDERBASE_RUNNER_CONFIG` | The path to `runner.yaml` when `--config` is not given |
| `BLUNDERBASE_RUNNER_SERVER` | `server` |
| `BLUNDERBASE_RUNNER_TOKEN` | `token` |
| `BLUNDERBASE_RUNNER_NAME` | `name` |
| `BLUNDERBASE_RUNNER_SLOTS` | `slots` |

With no file at all, those variables are the whole configuration, which is what a container
that mounts nothing does.

## 3. Start it

```console
$ blunderbase-runner --config runner.yaml --check
sf-remote: accepted as engine 7
$ blunderbase-runner --config runner.yaml
```

`--check` probes every binary, opens one connection, prints what the server accepted, and
exits. Run it before starting the real thing, **not on a timer**: it opens a second
connection with the same token, and a second connection takes the runner over.

Exit codes:

| Code | Meaning |
|---|---|
| `0` | The runner was asked to stop and did |
| `1` | The configuration is wrong, or not one engine could be started |
| `2` | The server refused this runner's protocol version — upgrade the runner to the server's release |

`SIGINT` and `SIGTERM` ask for a clean stop rather than killing a search mid-frame.

## As a container

A runner is the same image as the server, with a different command, no ports and no volumes
but the yaml. There is a sample compose file,
[`docker-compose.runner.yml`](https://github.com/philphilphil/blunderbase/blob/main/docker/docker-compose.runner.yml),
in the repository. Put it and `runner.yaml` in the same directory and start it:

```console
$ BLUNDERBASE_RUNNER_TOKEN=bb_rnr_… docker compose -f docker-compose.runner.yml up -d
```

The image ships Stockfish at `/usr/games/stockfish`. A Maia build and its weights are yours
to mount — uncomment the `./engines` volume and register the path as `kind: maia`.

Disable the container's healthcheck if you copy the service elsewhere: it curls an API a
runner does not serve, so `docker compose ps` would read "unhealthy" for a runner that is
working perfectly. Watch the log lines instead.

**Put TLS in front of the server.** The token is a bearer credential on every frame.
[Deploy](deploy.md) has a Caddyfile and an nginx site that do it; `server:` is then the
`https` URL, and the socket is derived from it.

## Watching it work

- `blunderbase runners list` — one line per runner: connected or not, its slots, its
  advertised engines, and how much of the backlog only it can do.
- **Compute capacity** on the Engines page — this host and every runner, each with the
  engines it advertises. That is where a runner-bound engine's machine is named.
- The analysis queue, split by destination. A queue that is not moving because the machine
  with that engine is offline looks exactly like a long queue until you look here.
- An MCP client has a read-only `runners_status` tool, which is the same picture. Minting and
  revoking stay out of the chat: they are token handling.

## When it does not connect

| What you see | What it is |
|---|---|
| exit `1`, "server is required" | The file or the environment is incomplete; the message names the field and the file |
| exit `1`, a probe failure | The `path` of an engine is wrong on *that* machine |
| exit `2` | The server speaks a different protocol version — upgrade the runner |
| close code `4401`, then exit | The token is not a registered runner's; mint a new one |
| close code `4403` | The runner was revoked while it was connected |
| close code `4409` | A second connection with the same token took it over — usually a `--check` run, or two copies of the container |
| close code `4426` | The two halves do not speak the same runner protocol; the process exits `2` |
| close code `4429` | This token has been refused often enough that the server has shut its door on it. Dialling again only holds the door shut — fix the token and wait. Ten failures start a backoff that doubles from one second to a minute |
| the log says "polling" | The socket failed three times. The runner is still working, over HTTP, and retries the socket every minute |

## Revoking

```console
$ blunderbase runners revoke gpu-box
```

**Revoke** on the runner's card under **Compute capacity** does the same. Either way the
token stops working and the engines it
advertised are deleted.

Revoking from the app also closes the open link and hands back whatever the runner was
running, with the attempt refunded — a machine you took away did not fail. The command-line
version is not the server process, so it cannot close a link it does not hold: it deletes
the engines, the runner is given no further work, and the link ends at its next reconnect.

Runs that were in flight are queued again either way. The database is the queue; runners are
expendable.

## One run, one machine

A run's evaluation and its human-move pass execute in the same process, so both engines have
to be on the same host — *for a run that asks for both*.

A search engine on a machine with no Maia, in an installation whose only Maia is elsewhere,
is refused when you queue the analysis, naming both machines. A run queued with no Maia pass
at all has one pass and so one host, and is never refused for this. An installation with no
Maia anywhere is unaffected: the pass simply does not happen.

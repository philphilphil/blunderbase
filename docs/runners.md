# Running engines on another machine

A **runner** is a second Blunderbase process on a machine with cores to spare. It has no
database and serves no page: it dials *out* to the server, says which engines it has, and is
handed whole analysis jobs and analysis boards. Nothing about a finished run says where it
happened.

This page is the operator's reference — the yaml, the container, and what to do when it does
not connect. `docs/ARCHITECTURE.md` is why it is built this way.

## 1. Register the runner on the server

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
    tier: deep
    options:
      Threads: 8
```

`POST /runners` is the same thing over HTTP, and answers with the same yaml. Either way the
token is handed over once and never again: only its SHA-256 is stored. A lost token is a
revoke and a new runner, which costs nothing.

`--server` overrides the URL written into the yaml; without it the command uses
`BLUNDERBASE_PUBLIC_URL`, and failing that the address this process binds. Set
`BLUNDERBASE_PUBLIC_URL` on a deployment behind a proxy — the server cannot otherwise know
what it is called from outside.

## 2. Write `runner.yaml` on the other machine

Every key, with its default:

```yaml
# required
server: https://blunderbase.example.com   # http(s); the ws(s) URL is derived from it
token: bb_rnr_…                           # from `runners create`, shown once
name: gpu-box                             # informational — the token is the identity

# optional
slots: 4                  # default 1 — engine jobs plus analysis boards at once
verify_tls: true          # default true
poll_seconds: 5.0         # default 5.0 — how often the HTTP fallback asks for work
log_level: info           # debug | info | warning | error

reconnect:
  initial_seconds: 1.0            # default 1.0  — backoff floor, with jitter
  max_seconds: 60.0               # default 60.0 — backoff ceiling
  websocket_failures: 3           # default 3    — failures *to connect* before polling
  retry_websocket_seconds: 60.0   # default 60.0 — how often polling retries the socket

engines:
  - name: sf-remote               # required, unique here; this becomes the Engine row's name
    path: /usr/games/stockfish    # required; the path on THIS machine
    kind: uci                     # uci | maia, default uci
    tier: deep                    # quick | deep — the default-tier hint, as on the Engines page
    options:                      # validated against what the binary declares, at startup
      Threads: 8
      Hash: 4096
    streams: true                 # default true for uci; a Maia never streams
```

An unrecognised key is refused by name rather than ignored — a typo in a slot count is a
mistake, not a preference. Four values can come from the environment instead, and beat the
file, so a token need not live in something that gets copied around:
`BLUNDERBASE_RUNNER_CONFIG` (the path to this file), `_SERVER`, `_TOKEN`, `_NAME`, `_SLOTS`.

## 3. Start it

```console
$ blunderbase-runner --config runner.yaml --check
sf-remote: accepted as engine 7
$ blunderbase-runner --config runner.yaml
```

`--check` probes every binary, opens one connection, prints what the server accepted and
exits — `0` clean, `1` a configuration or probe failure, `2` a protocol version this server
will not speak. Run it before starting the real thing, not on a timer: it opens a second
connection with the same token, and a second connection takes the runner over.

## As a container

`docker-compose.runner.yml` in the repository root is the same thing as a container: the
same image, a different command, no ports and no volumes but the yaml.

```console
$ cp runner.yaml ./runner.yaml          # beside the compose file
$ BLUNDERBASE_RUNNER_TOKEN=bb_rnr_… docker compose -f docker-compose.runner.yml up -d
```

The image ships Stockfish at `/usr/games/stockfish`. A Maia build and its weights are yours
to mount — uncomment the `./engines` volume and register the path as `kind: maia`.

**Put TLS in front of the server.** The token is a bearer credential on every frame;
`docs/deploy.md` is a Caddyfile and an nginx site that do it, and `server:` is then the
`https` URL with the socket derived from it.

## Watching it work

- `blunderbase runners list` — one line per runner: connected or not, its slots, its
  advertised engines, and how much of the backlog only it can do.
- `GET /analysis/queue` — the same backlog split by destination. A queue that is not moving
  because the machine with that engine is offline looks exactly like a long queue until you
  read this.
- `GET /runners/status` — this host and every runner in one answer, each with the engines it
  advertises. That is where a runner-bound engine's machine is named; the row itself is
  read-only, because its truth is the yaml over there — `PATCH /engines/{id}` refuses it,
  and so does the test-run button, rather than starting whatever *this* host has at that
  path.
- The coach has a read-only `runners_status` tool, which is the same picture from the
  database. Minting and revoking stay out of the chat: they are token handling.

## When it does not connect

| What you see | What it is |
|---|---|
| exit `1`, "server is required" | the yaml (or the environment) is incomplete; the message names the field and the file |
| exit `1`, a probe failure | the `path` of an engine is wrong on *that* machine |
| exit `2` | the server speaks a different protocol version — upgrade the runner to the server's release |
| close code 4401, then exit | the token is not a registered runner's; mint a new one |
| close code 4403 | the runner was revoked while it was connected |
| close code 4409 | a second connection with the same token took it over — usually a `--check` run, or two copies of the container |
| the log says "polling" | the socket failed three times; the runner is still working, over HTTP, and keeps retrying the socket every minute |

## Revoking

```console
$ blunderbase runners revoke gpu-box
```

or `DELETE /runners/{id}`, which is what the web UI calls. Either way the token stops working
and the engines it advertised are deleted. The API call also closes the open link and hands
back whatever it was running, with the attempt refunded — a machine the owner took away did
not fail. The CLI, which is not the server process, cannot close a link it does not hold: it
deletes the engines, so the runner is given no further work, and the link ends at its next
reconnect.

Runs that were in flight are queued again either way. The database is the queue; runners are
expendable.

## One run, one machine

A run's evaluation and its human-move (Maia) passes execute in the same process, so both
engines have to be on the same host. A search engine on a machine with no Maia, in a
deployment whose only Maia is elsewhere, is refused when you queue the analysis, naming both
machines. A deployment with no Maia at all is unaffected: the pass simply does not happen,
exactly as before runners existed.

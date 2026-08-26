<p align="center">
  <img src="docs/design/brand/logo.png" alt="" width="104" height="104">
</p>

<h1 align="center">Blunderbase</h1>

<p align="center">
  Personal chess database with full agent support. Every game you have played, every
  position pre-analysed by an engine, and an MCP server that hands the lot to your AI as
  your coach.
</p>

---

Single-user and self-hosted. It imports your games (Lichess, chess.com, PGN upload, manual
OTB entry), replays each one into positions, and runs a Stockfish pass over every game as
it arrives — so by the time you or the coach ask a question, the engine truth is already
in the database. Two equal front doors read it: a web app, and an MCP server that turns
your regular assistant into a coach with your whole history in reach.

The bet is that deep analysis is too slow to run inside a chat turn. Blunderbase
pre-computes it and stores it; the MCP tools query facts — "my Najdorfs where the eval
dropped more than 1.5 in the middlegame, and what Maia says a 1700 would have played" —
and the model narrates. It never freestyles chess analysis.

`api/` and `mcp/` never touch the database: both are thin wrappers over `services/`, which
is the only place a "blunder", a "recent game" or a stat is defined. That invariant is
what stops the browser and the coach from disagreeing. See `docs/ARCHITECTURE.md`.

## Screens

**Dashboard** — recent games, rating graphs, queue status, worst recent moments.
**Games** — dense filterable table over everything imported. **Game view** — board, move
list, eval graph, classification markers, Maia's human-move overlays, engine lines, deep
re-analysis on demand, notes sidebar. **Explorer** — your own opening tree: frequencies,
scores, average eval drop, where you leave book (your book — there is no reference
database by design). **Stats** — blunders by phase, piece and time control, time-trouble
loss, trends. **Import** — accounts, sync history, PGN upload, manual entry board.
**Settings → Engines** — add a binary, probe it, edit its UCI options, test-run it.
**Live** — the board the coach is driving, following its MCP calls move by move.

## The coach

| Tool | Answers |
|---|---|
| `get_last_games` `get_worst_recent_moments` `compare_periods` | "check my last two games", "what should I train?", "am I getting better at X?" |
| `search_games` `get_game` `find_positions` `get_player_profile` | the query surface: filters, one game with its evals, "have I been here before?", ratings and volume |
| `opening_explorer` `get_stats` | the personal tree and every aggregation dimension |
| `request_analysis` `get_analysis_status` `analyze_position` | enqueue a deep pass, poll it, or evaluate one FEN inside the turn |
| `save_note` `search_notes` | the coach's own memory: "what were we working on?" |
| `show_game` `show_position` `make_move` `annotate` `get_live_state` | live mode — the coach drives the board in your browser, and knows whether anyone is watching |

Payloads are compact and token-conscious: summaries first, drill-down on request. Local
clients get stdio; remote clients get streamable HTTP at `/mcp` behind one bearer key —
which is your password, unless `BLUNDERBASE_MCP_BEARER_KEY` overrides it (see
[Signing in](#signing-in)).

```bash
claude mcp add blunderbase -- uv run --directory /path/to/blunderbase blunderbase mcp
claude mcp add --transport http blunderbase https://blunderbase.example/mcp \
  --header "Authorization: Bearer <your password, or BLUNDERBASE_MCP_BEARER_KEY>"
```

## Run it

```bash
make install          # uv sync + pnpm install
make run              # migrations, API + /mcp on :8765, Vite :5273
make mcp-key          # the URL and header a remote MCP client needs
```

Needs Python 3.12+, uv, Node 22+, pnpm. `make run` mints a bearer key into `data/mcp.key`
on first use. In development the page comes from Vite, which proxies `/api` and `/events`
to the backend.

Deployed, it is one container on one port: the API, the built web app, the `/events`
socket and `/mcp` are all served by the same uvicorn.

```bash
docker run -d --name blunderbase -p 8765:8765 -v blunderbase-data:/data \
  -e BLUNDERBASE_MCP_BEARER_KEY="$(openssl rand -hex 32)" \
  ghcr.io/philphilphil/blunderbase:latest
```

Or `docker compose up -d` with the bearer key in a `.env` beside `docker-compose.yml`.
Put a TLS terminator in front of anything reachable from elsewhere: the session cookie is
`Secure` on any host that is not loopback, so plain HTTP on a LAN address will not keep
you signed in. `docs/deploy.md` has a Caddyfile and an nginx site that front all four
surfaces correctly — the page, `/api`, the `/events` socket and `/mcp`, which needs its
`Authorization` header passed through, its stream unbuffered and its path not redirected.
The database, uploaded PGNs and any engine you download from the UI live in `/data`; back
that volume up and you have backed up everything.

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

## Running an engine on another machine

A **runner** is a second process on a machine with cores to spare. It has no database and
no web app: it dials out to Blunderbase, says which engines it has, and is handed whole
analysis jobs. The engines it advertises appear on the Engines page bound to its name, and
a run is a run whether it happened here or there.

```bash
blunderbase runners create gpu-box --slots 8   # on the server — the token is shown once
```

That prints a paste-ready `runner.yaml` with the token already in it. On the other machine,
edit the engine paths and start it:

```bash
blunderbase-runner --config runner.yaml --check   # probe the engines, test the link, exit
blunderbase-runner --config runner.yaml
```

```yaml
server: https://blunderbase.example.com   # ws(s) is derived from this
token: bb_rnr_…                           # or $BLUNDERBASE_RUNNER_TOKEN, which wins
name: gpu-box
slots: 8                                  # engine jobs at once

engines:
  - name: sf-remote
    path: /usr/games/stockfish
    tier: deep
    options:
      Threads: 8
```

`docker-compose.runner.yml` is the same thing as a container. The link carries a bearer
token, so put HTTPS/WSS in front of the server (`docs/deploy.md`).
`docs/runners.md` is the full reference: every yaml key, the compose walk-through, what
`blunderbase runners list/create/revoke` do, and what each refusal means.

Two things worth knowing. The socket is the transport and HTTP polling is the fallback,
picked up automatically after a few failures and dropped again when the socket comes back.
And a run's engine and its Maia model must be on **one** machine — the two passes share a
process — so a runner that should do human-move predictions needs its own Maia; asking for
a pass across two hosts is refused when you queue it, with both machines named.

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
| `BLUNDERBASE_QUICK_NODES` `BLUNDERBASE_DEEP_NODES` `BLUNDERBASE_DEEP_MULTIPV` | `250000` `2000000` `4` | the per-position budget of each tier |
| `BLUNDERBASE_INACCURACY_THRESHOLD` `…_MISTAKE_…` `…_BLUNDER_…` | `10` `20` `30` | win-percentage points lost by the mover, à la Lichess |
| `BLUNDERBASE_MAIA_RATING_OFFSETS` | `-100,0,100` | the levels Maia is asked about, around your rating in that game |

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

## License

No `LICENSE` file yet, so all rights are reserved by default until one is added. The image
ships Debian's Stockfish package (GPL-3.0), unmodified and separately licensed.

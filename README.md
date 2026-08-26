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
clients get stdio; remote clients get streamable HTTP at `/mcp` behind one bearer key.

```bash
claude mcp add blunderbase -- uv run --directory /path/to/blunderbase blunderbase mcp
claude mcp add --transport http blunderbase https://blunderbase.example/mcp \
  --header "Authorization: Bearer $BLUNDERBASE_MCP_BEARER_KEY"
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
socket and — when a key is set — `/mcp` are all served by the same uvicorn.

```bash
docker run -d --name blunderbase -p 8765:8765 -v blunderbase-data:/data \
  -e BLUNDERBASE_MCP_BEARER_KEY="$(openssl rand -hex 32)" \
  ghcr.io/philphilphil/blunderbase:latest
```

Or `docker compose up -d` with the bearer key in a `.env` beside `docker-compose.yml`.
**The API carries no auth of its own** — the key guards the MCP transport only, so publish
the port on loopback and put a TLS terminator in front of anything reachable from
elsewhere (`docker-compose.traefik.yml` is one such setup). The database, uploaded PGNs
and any engine you download from the UI live in `/data`; back that volume up and you have
backed up everything.

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
| `BLUNDERBASE_MCP_BEARER_KEY` | — | set it and `/mcp` is served, behind it; empty means no remote transport at all |
| `BLUNDERBASE_ANALYSIS_CONCURRENCY` | cores − 2 | engine processes at once, across every tier |
| `BLUNDERBASE_ANALYSIS_WORKERS` | `true` | off for a deployment that drains the queue from `blunderbase analyze` elsewhere |
| `BLUNDERBASE_QUICK_NODES` `BLUNDERBASE_DEEP_NODES` `BLUNDERBASE_DEEP_MULTIPV` | `250000` `2000000` `4` | the per-position budget of each tier |
| `BLUNDERBASE_INACCURACY_THRESHOLD` `…_MISTAKE_…` `…_BLUNDER_…` | `10` `20` `30` | win-percentage points lost by the mover, à la Lichess |
| `BLUNDERBASE_MAIA_RATING_OFFSETS` | `-100,0,100` | the levels Maia is asked about, around your rating in that game |

## Commands

`uv run blunderbase …` — `serve`, `import <lichess|chesscom|pgn> …`, `analyze` (queue a
tier and drain it in this process), `mcp [--transport stdio|http]`, `db upgrade`. The
queue is `analysis_runs` rows rather than a broker, so `blunderbase analyze` is safe to
run while the server is up, and nothing is lost across a restart.

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

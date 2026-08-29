<p align="center">
  <img src="docs/design/brand/logo.png" alt="" width="104" height="104">
</p>

<h1 align="center">Blunderbase</h1>

<p align="center">
  Personal chess database<br/>
</p>

---

Blunderbase imports your games, runs Stockfish over every one as it arrives, and stores
the results. Browse them in the web app — or connect your AI agent over MCP and it
becomes a coach with your whole chess history in reach.

<!-- screenshots
<p align="center">
  <img src="docs/media/dashboard.png" alt="Dashboard" width="400" />
  <img src="docs/media/game_view.png" alt="Game view" width="400" />
</p>
-->

## How It Works

1. **Import your games**: sync Lichess and chess.com accounts, upload PGNs, or enter OTB games by hand
2. **Analysis happens up front**: every game gets a Stockfish pass on arrival, deep re-analysis on demand — the engine truth is in the database before you ask
3. **Browse or ask**: the web app and the MCP coach read the same store — "my Najdorfs where the eval dropped 1.5 in the middlegame" is one question away

## Features

- Automatic Stockfish analysis of every imported game, with blunder/mistake/inaccuracy classification
- MCP server that turns Claude (or any MCP agent) into a coach over your games
- Maia human-move predictions: what a player at the rating you are aiming for would have played
- Personal opening explorer — your tree, your scores, where you leave your own book
- Stats: blunders by phase, piece and time control, time-trouble losses, trends
- Live mode: the coach drives a board in your browser, move by move
- Bring your own engines, including on other machines via [remote runners](docs/runners.md)
- Single-user, self-hostable via Docker — one container, one port

## MCP

Blunderbase exposes an [MCP](https://modelcontextprotocol.io/) server so your agent can
query games, stats and positions, request deep analysis, keep coaching notes, and drive
the live board. Payloads are compact and token-conscious; the model narrates stored
engine facts and never freestyles chess analysis.

```bash
claude mcp add blunderbase -- uv run --directory /path/to/blunderbase blunderbase mcp
claude mcp add --transport http blunderbase https://blunderbase.example/mcp \
  --header "Authorization: Bearer <a key from Settings → MCP, or your password>"
```

The bearer token is your password, or better, a key minted per client on **Settings →
MCP** — stored hashed, shown once, revocable without touching the password. See
[docs/reference.md](docs/reference.md#signing-in).

**Examples:**
```
You:   "Check my last two games"
Coach: get_last_games → get_game → narrates the two evals worth talking about

You:   "What should I train?"
Coach: get_worst_recent_moments → get_stats → a plan grounded in your actual blunders
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Python 3.12, FastAPI, SQLAlchemy + Alembic |
| Frontend | React 19 + TypeScript + Vite, shadcn/Radix, Tailwind CSS 4 |
| Database | SQLite in WAL mode — one file, `BLUNDERBASE_DB_PATH` |
| Chess | Stockfish (any UCI engine), Maia via lc0, chessground + chessops |
| MCP | Built into the backend — stdio for local clients, streamable HTTP at `/mcp` |

## Quick Start

Prerequisites: Python 3.12+, uv, Node 22+, pnpm

```bash
make install          # uv sync + pnpm install
make run              # migrations, API + /mcp on :8765, Vite on :5273
```

Or as a container:

```bash
docker run -d --name blunderbase -p 8765:8765 -v blunderbase-data:/data \
  ghcr.io/philphilphil/blunderbase:latest
```

The first person to open a fresh deployment chooses the password; that password is also
an MCP bearer token, until you mint per-client keys on Settings → MCP. Back up the `/data` volume and you have backed up everything.
For TLS termination and reverse-proxy examples see [docs/deploy.md](docs/deploy.md).

## Project Structure

```
backend/
  api/              — FastAPI routes, auth, SPA serving
  mcp/              — MCP server (stdio + streamable HTTP)
  services/         — the only place a "blunder" or a stat is defined
  adapters/         — Lichess, chess.com, UCI engines, Maia
web/                — React SPA
tests/              — pytest
docs/               — deploy.md, runners.md, reference.md, ARCHITECTURE.md
```

`api/` and `mcp/` never touch the database: both are thin wrappers over `services/`,
which is what stops the browser and the coach from disagreeing. Details in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); auth, engines, configuration, the CLI,
releases and testing are in [docs/reference.md](docs/reference.md).

## License

No `LICENSE` file yet, so all rights are reserved by default until one is added. The image
ships Debian's Stockfish package (GPL-3.0), unmodified and separately licensed. It also
ships `@lichess-org/stockfish-web` — Stockfish compiled to WebAssembly, declared
`AGPL-3.0-or-later` by its npm package and distributed with the GNU GPL v3 as its LICENSE
file — together with the neural network it loads. Both are unmodified and separately
licensed too, and both are served as their own files in the web output rather than bundled
into any JavaScript of ours.

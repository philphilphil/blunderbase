<p align="center">
  <img src="docs/design/brand/logo.png" alt="" width="104" height="104">
</p>

<h1 align="center">Blunderbase</h1>

<p align="center">
  Personal chess database<br/>
</p>

---

## Features
- Import games from lichess, chess.com and PGNs
- Analyze your games with or without an engine
- Support for maia3 at multiple ELO's to see what humans would have played
- Take notes on positions
- Awesome Engine-Line visualizer 
- Full MCP support to discuss games with an AI-Agent and a shared live board
- Remote-Engine-Runner to use your copmanies idling inference server CPUs for your hobbies 
- Opening explorer with win-stats over your own games
- Fully self-hostable, easiest via docker

<!-- screenshots
<p align="center">
  <img src="docs/media/dashboard.png" alt="Dashboard" width="400" />
  <img src="docs/media/game_view.png" alt="Game view" width="400" />
</p>
-->

## MCP

Blunderbase exposes an [MCP](https://modelcontextprotocol.io/) server so your agent can
query games, stats and positions, request deep analysis, keep coaching notes, and drive
the live board. Payloads are compact and token-conscious; the model narrates stored
engine facts and never freestyles chess analysis.

```bash
claude mcp add blunderbase -- uv run --directory /path/to/blunderbase blunderbase mcp
claude mcp add --transport http blunderbase https://blunderbase.example/mcp \
  --header "Authorization: Bearer <a key from Assistant, or your password>"
```

The bearer token is your password, or better, a key minted per client on **Assistant** —
stored hashed, shown once, revocable without touching the password. See
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
an MCP bearer token, until you mint per-client keys on Assistant. Back up the `/data` volume and you have backed up everything.
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

[MIT](LICENSE). The image
ships Debian's Stockfish package (GPL-3.0), unmodified and separately licensed. It also
ships `@lichess-org/stockfish-web` — Stockfish compiled to WebAssembly, declared
`AGPL-3.0-or-later` by its npm package and distributed with the GNU GPL v3 as its LICENSE
file — together with the neural network it loads. Both are unmodified and separately
licensed too, and both are served as their own files in the web output rather than bundled
into any JavaScript of ours.

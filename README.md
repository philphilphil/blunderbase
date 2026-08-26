# Blunderbase

A personal chess database with an AI coach as its centerpiece.

Blunderbase imports every game the owner plays (Lichess, chess.com, PGN, manual
OTB entry), stores deep pre-computed engine analyses (Stockfish + Maia), and
exposes all of it through two equal front doors: a web app and an MCP server.

## Getting started

```sh
uv sync
uv run alembic upgrade head
uv run blunderbase serve
```

## Layout

```
backend/
  adapters/   # network- and process-facing: lichess, chesscom, pgn, stockfish, maia, pool
  db/         # SQLAlchemy 2 models, engine/session factory, Alembic wiring
  services/   # ALL business logic
  workers/    # background analysis queue
  api/        # FastAPI — thin HTTP wrappers over services
  mcp/        # MCP server — thin tool wrappers over the SAME services
  cli.py
```

See `docs/ARCHITECTURE.md` for the invariants and `docs/superpowers/specs/` for
the design spec.

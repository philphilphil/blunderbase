# Blunderbase — Design Spec

*2026-08-25 · Status: draft for review*

## What this is

Blunderbase is a personal chess database with an AI coach as its centerpiece.
It imports all of the owner's games (Lichess, chess.com, PGN, manual OTB entry),
stores deep pre-computed engine analyses (Stockfish + Maia), and exposes
everything through two equal front doors:

1. A modern web app — game browser, flagship game view, personal opening
   explorer, statistics dashboards.
2. An MCP server — so the owner's regular AI assistant acts as their chess
   coach with instant access to every game, analysis, stat, and its own
   persistent notes.

The key bet: deep engine analysis is too slow to run live in a chat turn, so
Blunderbase pre-computes and stores it. The coach queries facts ("all my
Najdorf games where my eval dropped >1.5 in the middlegame, with what Maia says
a 1700 would have played"); the LLM narrates and plans. The MCP serves engine
truth; the model never freestyles chess analysis.

## Decisions log

| Decision | Choice | Why |
|---|---|---|
| Name | Blunderbase | Chess slang + "-base" database naming; owner accepts collision with an obscure backgammon DB of the same name |
| Repo | Fresh repo `blunderbase` | Full pivot; predecessor `agent-chess-coach` is archived untouched. Only its four adapter files (`lichess.py`, `stockfish.py`, `maia.py`, `pool.py`) are ported, each re-reviewed on the way in. Nothing else is carried over — no schema, routes, puzzle/SRS/LLM code, or web code |
| Backend | Python 3.12 · FastAPI · SQLAlchemy 2 · Alembic · python-chess · official `mcp` SDK | Best chess + ML ecosystem; proven engine pipeline ports over |
| Database | SQLite (WAL) with a PG escape hatch | Personal-scale data (~few GB, ~10M rows) is comfortable in SQLite; engine concurrency ≠ write concurrency (workers batch-commit per run, ms-long locks). Rules: SQLAlchemy-only access, no SQLite-isms, migrations kept PG-compatible. Multi-machine analysis workers would be the trigger to switch |
| Frontend | React 19 · Vite · TypeScript · chessground · Tailwind 4 · shadcn/ui | chessground is Lichess's own board (definitive chess UI lib); one styling system |
| UI process | Claude Design first | Visual direction + key screens designed before frontend implementation; En Croissant is the floor, not the target |
| Old features | Puzzles/SRS dropped entirely | The coach's brain lives in the external AI; Blunderbase is the database and evidence layer |

## Architecture

One Python package, one database, three consumers of a shared service layer:

```
backend/
  adapters/      # ported: lichess.py, stockfish.py, maia.py, pool.py
                 # new: chesscom.py, pgn_import.py
  db/            # games-first schema, Alembic from revision 0001
  services/      # ALL business logic: import, analysis, explorer, stats, notes
  workers/       # background analysis queue (tiered passes)
  api/           # FastAPI — thin HTTP wrappers over services
  mcp/           # MCP server — thin tool wrappers over the SAME services
  cli.py         # import / analyze / serve commands
web/             # React app
```

Invariant: `api/` and `mcp/` never touch the DB directly. Both call
`services/`, so the coach and the UI can never disagree about what a
"blunder" or a stat means.

## Data model

- **Game** — source (`lichess | chesscom | pgn | manual`), source ID (dedup
  key), players, owner's color, result, time control, ratings, ECO/opening,
  date, raw PGN, parsed move list (UCI + SAN), clock times when available.
- **Position** — normalized FEN reached in any game (unique by zobrist/FEN
  key). Join table **GamePosition**(game, ply, position) makes the explorer
  and "you've been here before" queries a lookup, not a PGN scan.
- **AnalysisRun** — one engine pass over one game: engine ref, tier
  (`quick | deep`), depth/nodes/multipv config, status
  (`queued | running | done | failed`), timestamps, captured stderr on
  failure. Re-analysis = new run; old runs are kept.
- **MoveEval** — per-ply rows of a run: eval before/after, best line(s),
  classification (blunder / mistake / inaccuracy), Maia policy (predicted
  human move + probability per rating level).
- **Note** — coach-written memory: free text + structured tags, attached to a
  game, a position, or standalone (session summaries, training focuses).
  Timestamped, queryable.
- **ImportJob** — per-source sync bookkeeping (cursor, counts, per-game errors).
- **Account** — the owner's usernames per platform (defines which side is
  "you"; all coaching stats hang on this).
- **Engine** — name, binary path, type (UCI / Maia weights), UCI options,
  enabled flag, tier defaults. Managed from the UI, not a config file.

Move classification uses win%-based thresholds (à la Lichess) rather than raw
centipawns, so middlegame swings aren't overweighted; thresholds configurable.

## Import

- **Lichess** — full-archive NDJSON export API, `since` cursor in ImportJob;
  incremental after first run; rate-limit aware.
- **Chess.com** — monthly-archive endpoints; enumerate `/games/archives`,
  fetch new months, re-fetch current month. Cursor = last archive + count.
- **PGN upload** — multi-game files via UI or CLI.
- **Manual/OTB** — enter moves on a board in the UI + minimal metadata form;
  stored as `manual` game with generated PGN.

Shared pipeline: parse → dedup → extract positions → store → enqueue
quick-tier analysis. Dedup by source ID where present, else a hash of
moves + date + players (the same game can arrive twice, e.g. a PGN export of
an already-synced Lichess game). Failed games are recorded per-game in the
ImportJob and listed in the UI; a bad game never aborts a sync.

## Analysis pipeline

- **Worker model** — asyncio worker pool inside the FastAPI process, wrapping
  the ported engine pool. Queue = `AnalysisRun` rows in the DB (survives
  restarts; no Redis/Celery).
- **Quick tier** (automatic on import) — single-PV Stockfish at fixed nodes
  per position: full eval curve, move classifications, Maia predictions at
  2–3 rating levels around the owner's rating.
- **Deep tier** (on demand from UI or coach) — multi-PV (3–5 lines), high
  node budget, optional ply range ("analyze the endgame deeply"). Stored as a
  new run, never overwriting the quick pass.
- **Scheduling** — quick jobs FIFO; deep jobs jump the queue (someone is
  waiting). Concurrency capped by config (default cores−2, shared across
  engine processes). Workers buffer a run's MoveEvals and commit once per run
  (this is what keeps SQLite's single-writer model a non-issue).
- **Failure** — crashed engine ⇒ run `failed` with stderr captured, slot
  released, one retry; the game stays browsable with whatever tiers it has.
- **Engine management UI** — Settings → Engines: add a binary, or one-click
  download (latest Stockfish + Maia weights, verified, into the app data
  dir); edit UCI options with live validation (probe the engine, read its
  declared options); enable/disable; test-run button showing a sample eval.
  Tiers reference engine IDs, so engine-per-tier is a UI choice. Adding Leela
  later = adapter + UI entry, no schema change.

## MCP coach surface

Transport: stdio for local clients; streamable HTTP with a bearer key for
remote (claude.ai). All tools return compact structured JSON with
token-conscious defaults — summaries first, drill-down on request.

Convenience tools mirror how the owner actually talks to a coach
("check my last two games") — common phrases get first-class tools:

- `get_last_games(amount, platform?, time_control?)` — newest first; compact
  cards: result, color, opponent+rating, opening, eval-curve data, worst 2–3
  moments with classifications.
- `get_worst_recent_moments(days | amount)` — recent blunders ranked by eval
  swing, with position + the better move ("what should I train?").
- `compare_periods(then, now)` — same stats dimension across two windows
  ("am I getting better at X?").

Query:
- `search_games(filters)` — date range, source, color, ECO, result, time
  control, opponent, has-blunders, deep-analyzed, free text.
- `get_game(id, ply_range?)` — moves, evals, classifications, Maia
  predictions, notes.
- `find_positions(fen | motif filters)` — "have I been here before?", with
  game context and outcomes.
- `get_player_profile()` — ratings over time, volume, platforms.

Stats & explorer:
- `opening_explorer(from_fen | eco, color)` — personal tree: frequencies,
  scores, avg eval drop, where the owner leaves book.
- `get_stats(dimension)` — blunders by phase/piece/motif, performance by time
  control/time of day, time-trouble eval loss, trends.

Analysis:
- `request_analysis(game_id | fen, tier, ply_range?)` — enqueue deep pass →
  run ID.
- `get_analysis_status(run_id)`.
- `analyze_position(fen, budget)` — synchronous bounded-budget eval for
  mid-conversation "what if" lines.

Memory:
- `save_note(text, tags, game_id? | fen?)`.
- `search_notes(query | tags | date)` — a new session starts with "what were
  we working on?".

## Live session (coach-driven UI)

The owner works split-screen: Blunderbase in the browser, the AI coach in a
chat next to it. Two behaviors make that seamless:

- **Auto-refresh** — the frontend subscribes to `/events` and refetches on
  events. The event set includes import progress, analysis run lifecycle,
  and `note.created / note.updated`, so a note the coach saves via MCP
  appears in the open UI within a second.
- **Live mode** — a single server-side live-session state: current game/ply
  or ad-hoc FEN, arrows/highlights, a coach comment, updated via MCP tools
  and broadcast over the same WebSocket. A `/live` page (or "follow coach"
  toggle on the game view) renders it and animates incoming moves; refresh
  or reconnect restores the last state (it lives on the server, not in the
  socket).

MCP tools: `show_game(game_id, ply)`, `show_position(fen)`,
`make_move(uci)` (advances the live board), `annotate(arrows, squares,
text)`, `get_live_state()` (includes whether any browser is currently
subscribed). Invariant: live moves are ephemeral analysis-board state —
MCP driving the board never mutates stored games. No auth of its own: the
session cookie the rest of the API needs covers `/live` and `/events`, and
the bearer key guards remote MCP.

## HTTP API & Web UI

API: thin service wrappers — `/games`, `/games/{id}`, `/import/{source}`,
`/analysis`, `/explorer`, `/stats`, `/engines`, `/notes`; one WebSocket
`/events` pushing import progress and run completion. Localhost binding by
default.

**Superseded (2026-08-26):** this said the bearer key only guarded the MCP
transport and the API bound to loopback. The app is deployable on the open
internet now, so every route and `/events` are behind a single-user session
cookie — `/health`, `/auth/*`, `/mcp` and the static page excepted — and the
MCP bearer key is the owner's password unless the environment overrides it.
See `docs/ARCHITECTURE.md`.

UI must look awesome — it is an acceptance criterion, not a nice-to-have.
Process: key screens are designed in Claude Design before frontend
implementation; implementation follows that design system. Dark-first,
dense-but-calm; En Croissant's showcase is the visual floor.

Pages:
- **Dashboard** — recent games strip, rating graphs, queue status, worst
  recent moments cards.
- **Games** — dense filterable/sortable table, infinite scroll, source badges.
- **Game view (flagship)** — board + move list + eval graph, classification
  markers, Maia human-move overlays, deep-analysis trigger, engine lines
  panel, notes sidebar.
- **Explorer** — board left, personal move-tree stats right, line breadcrumb.
- **Stats** — the aggregation dashboards.
- **Import** — connect accounts, sync status/history, PGN upload, manual
  entry board.
- **Settings → Engines** — engine management (above).

## Error handling

- Import: per-game failure records, sync never aborts; API errors surface in
  ImportJob history and the Import page.
- Analysis: failed runs keep stderr, retry once, never block browsing.
- MCP: tools return structured errors (unknown ID, bad FEN, queue full) —
  never stack traces; long operations are async by design (enqueue + poll).
- API: FastAPI exception handlers → typed error responses; WebSocket drops
  are recoverable (UI refetches on reconnect).
- Engines: probe on add (bad binary rejected at setup, not at analysis time);
  a disabled/missing engine degrades its tier with a visible warning, never a
  crash.

## Testing

- **Services & importers** — pytest against fixture PGNs/NDJSON (happy path,
  malformed games, dedup collisions, cursor resume). In-memory SQLite per
  test; the suite also runs against PG in CI to keep the escape hatch honest.
- **Engine adapters** — unit tests with a scripted fake UCI process;
  a marked integration suite (`-m engine`) runs against real Stockfish/Maia
  binaries locally.
- **MCP tools** — contract tests: each tool called through the MCP server
  in-process, asserting schema and token-conscious payload shapes.
- **API** — httpx TestClient over the service layer with seeded fixtures.
- **Web** — vitest component tests for move list / eval graph / board glue;
  one Playwright smoke flow (import PGN → see game → view analysis) against
  a seeded backend.

## Build order (each phase = its own plan)

1. Skeleton: repo scaffolding, DB schema + migrations, service layer stubs,
   CLI serve.
2. Import: PGN + Lichess first (fixtures exist), then chess.com, manual entry
   last (needs UI).
3. Analysis: port adapters, worker queue, quick tier end-to-end, then deep
   tier.
4. MCP server: convenience + query tools first (usable coach immediately),
   then stats, analysis triggers, notes.
5. Web UI: Claude Design pass, then Dashboard → Game view → Games →
   Explorer → Stats → Import → Engines.

Order rationale: after phase 4 the product thesis (AI coach over your real
games) is testable in daily use before any UI exists.

## Non-goals (v1)

- Multi-user. (Single-user auth arrived on 2026-08-26 — one password, chosen
  on first run, guarding the whole API and reused as the MCP bearer key —
  because the app became deployable on the open internet. Accounts, roles and
  sharing remain out of scope.)
- Playing chess (no play-vs-engine mode; Lichess exists).
- Puzzles/SRS (dropped from predecessor; may return later as a DB consumer).
- Reference databases of other people's games (personal games only, v1).
- Mobile.

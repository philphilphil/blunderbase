# Frontend implementation notes

Source: Claude Design project "Blunderbase design spec"
(claude.ai/design/p/ea601f62-a04a-463a-b9af-034180c85645). Files in this
directory are local snapshots pulled 2026-08-25.

## Decisions

- **Layout: Option 1a "Studio"** (chosen by Phil) — four columns: paired move
  table with glyph badges · board with Maia overlay · filled eval area chart ·
  notes/MCP column with recurring-mistake cards. Option 1b is not implemented.
  The "Component states" section (1c) applies to the chosen layout.
- Palette/typography come from the design file: dark-first, bg `#08090b`,
  accent teal `#3ecfd6`, purple `#c9b0ff` for Maia/deep-tier, fonts Geist +
  Geist Mono.
- **Brand**: `brand/logo.png` (+ favicon, apple-touch-icon) — the predecessor's
  pawn-robot logo with the band recolored from blue to the teal accent.

## Scope

Designed (Turn 1 + Turn 2, all on the 1a direction): **Game view** (flagship),
**Dashboard** (2a), **Games library** (2b), **Opening explorer** (2c),
**Stats** (2d). Frontend v1 builds all of these plus **Import** and
**Settings → Engines**, which have no dedicated design turn — derive them
from the established system (same shell, cards, tables, badges).

Libraries, not wheel-reinvention: chessground (board), Recharts via shadcn/ui
chart components (eval graph, rating graphs, stats dashboards); custom SVG
only for tiny sparklines/board-overlay glyphs where a chart lib doesn't fit.

## Live behavior (spec addition, backend follow-up pending)

- Frontend subscribes to WebSocket `/events` and refetches on events
  (import progress, analysis run lifecycle, note created/updated) — MCP
  writes appear in the open UI without manual refresh.
- **Live mode**: server-side live-session state (current game/ply or ad-hoc
  FEN, arrows/highlights, coach comment) driven by MCP tools
  (`show_game`, `show_position`, `make_move`, `annotate`, `get_live_state`);
  a `/live` route (or "follow coach" toggle on the game view) renders it and
  animates incoming moves. Live moves are ephemeral analysis-board state —
  never mutate stored games. Reconnect/refresh restores last state.

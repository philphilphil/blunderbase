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
  pawn-robot logo with the band recolored from blue to the teal accent. It is
  drawn for a light ground, so the dark theme inverts it in CSS
  (`dark:[filter:invert(1)_hue-rotate(180deg)]`) rather than shipping a second
  asset; the light theme uses it as-is.
- **120 % is the base scale** (owner feedback, 2026-08-26). The design file's
  sizes are read at 120 % browser zoom, so that is what the app ships at:
  `web/src/index.css` sets `html { font-size: 120% }` and every length in the
  code base is a `rem`/`em` or a Tailwind scale utility, which makes that one
  declaration the only knob. No `zoom`, no `transform`. A design-file pixel is
  written as `px / 16` rem — the design's 13px body text is `0.8125rem`, its
  524px board column `32.75rem`.
  - Media-query breakpoints are deliberately *not* scaled: `rem` inside a media
    query resolves against the browser's initial font size, so `xl:` still means
    1280 physical pixels and the two-column Stats grid still appears at 1440.
  - Recharts is the one thing that does not go through CSS — its axis widths,
    tick margins and chart margins are plain SVG user units. `web/src/lib/ui/scale.ts`
    carries those at the same factor (`scalePx`) and gives chart type the same
    `rem` treatment as everything else (`rem`); `scale.test.ts` pins the constant
    to what `index.css` says, and fails if a `px` length reappears in a Tailwind
    arbitrary value.
  - Design 1a's column floors moved from 420/280 to `24rem`/`16rem` so the four
    columns still fit 1440 at the new scale — on screen that is 461/307 px, both
    *wider* than the design's floors were at 100 %. `scale.test.ts` guards the
    budget.
- **Themes: dark / light / system** (owner feedback, 2026-08-26). This supersedes
  the earlier dark-only decision.
  - **Dark is unchanged and stays the flagship look** — the design file's palette
    to the hex — and it is the default for a fresh install. Picking `system` is
    how the owner opts into following the OS.
  - **Light is derived from the same design language**, not a second palette. The
    neutral ramp is inverted *by contrast rank*, so a token that was the quietest
    label in the dark is still the quietest label in the light: `#08090b` ground →
    `#f4f6f8`, `#e7eaef` text → `#12161c`, `#646c78` → `#626a75`, `#252b33`
    borders → the `#d1d8e0`/`#bcc5cf` pair. The teal and purple keep their
    identity and are darkened only as far as contrast demands: `#3ecfd6` →
    `#0a7b82` (4.65:1 on the page ground), `#c9b0ff` → `#7b4cd8` (5.01:1).
    Text tokens down through `--bb-dim-2` clear WCAG AA (≥4.5:1) on both the page
    and card grounds; `--bb-faint`/`--bb-faint-2` are decorative (rules, chart
    grid, disabled) and run at the same low contrast the dark theme gives them.
    Board squares and the chart palette have light variants of their own.
  - **Every colour resolves through the token layer.** `web/src/index.css` is the
    only file in `web/` that names a hex: `:root` holds the dark palette (so any
    context without a class — jsdom, a stylesheet opened alone — still gets the
    flagship look) and `:root.light` restates the same `--bb-*` names. Components
    use Tailwind utilities or `var(--bb-*)`; board-overlay tints are
    `color-mix(in srgb, var(--bb-accent) …%, transparent)` so chessground follows
    the theme with no second stylesheet.
  - **Mechanism**: a resolved `dark`/`light` class plus `data-theme="<preference>"`
    on `<html>`, a three-state toggle in the titlebar, the preference in
    `localStorage` under `blunderbase.theme`, and `system` following
    `prefers-color-scheme` live. An inline script in `index.html` applies the
    stored preference before the first paint, so there is no flash of the wrong
    theme; `web/src/lib/ui/theme.tsx` owns the same rules and exports the script's
    source, which `theme.test.tsx` checks the two stay in step on.

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

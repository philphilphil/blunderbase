# Frontend implementation notes

Source: Claude Design project "Blunderbase design spec"
(claude.ai/design/p/ea601f62-a04a-463a-b9af-034180c85645). Files in this
directory are local snapshots pulled 2026-08-25.

## Decisions

- **Visual direction: the restrained desktop-tool pass**
  (`prototypes/human-theme-lab.html`, accepted 2026-09-01). This supersedes the
  palette and the panel idiom below; the *layout* decisions (1a "Studio", the
  overview's two columns, the game screen's pane matrix) are unchanged, and the
  prototype was drawn against the real screens' existing geometry rather than
  proposing a new one. What changed:
  - **Panels are panes, not cards.** A region is bounded by a rule and by a change
    of surface, never by a floating rounded box. `--bb-panel` is *chrome* — the
    titlebar, the rail, a pane's title strip, the workspace's footer — and sits a
    shade apart from the canvas (`--bb-surface`) the content stands on, darker in
    the light theme and lighter in the dark one. Boundaries between panes are
    `--bb-edge-strong`; boundaries inside one are `--bb-hairline` or `--bb-line`.
  - **The radius scale was pulled in** to 3/4/5/6 design pixels, so a control is
    rounded and a region is not. The old `rounded-xl`/`rounded-2xl` card radii are
    now barely more than `rounded-md`, which is what flattened the screens the
    rebuild did not touch by hand.
  - **The neutral ramp is grey, not blue-black**, and the accent is a muted blue
    (`#83b7e3` dark, `#245f9e` light) rather than the flagship teal — a bright
    accent is what made the app read as a dashboard. Maia keeps its purple, and
    blunder/mistake keep their saturated hues. Token *names* are unchanged, so
    `accent-teal` is still the accent's class; only its value moved.
  - **The overview is sections, not cards**: a heading over a rule
    (`components/shell/Section.tsx`), with the page's own heading and actions
    spanning both columns above them.
  - **The game screen is one workspace**: a full-width `GameHeaderBar`, then the
    board flush left and a pane matrix to its right whose four title strips —
    Maia, the engine, Moves/Flagged, Book/Notes — sit on one line. The real
    `EvalGraph` is unchanged in behaviour; only its frame is.
  - The three-state theme mechanism, the pre-paint bootstrap and the token layer
    are unchanged — see "Themes" below, which still describes how it works.
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
  - **Mechanism** (unchanged by the 2026-09-01 direction; the hexes above are the
    superseded ones): a resolved `dark`/`light` class plus `data-theme="<preference>"`
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
**Engines**, which has no dedicated design turn — derive it
from the established system (same shell, cards, tables, badges).

Libraries, not wheel-reinvention: chessground (board), Recharts via shadcn/ui
chart components (eval graph, rating graphs, stats dashboards); custom SVG
only for tiny sparklines/board-overlay glyphs where a chart lib doesn't fit.

## Deferred

Places the frontend knowingly departs from the design file because the data
model behind it does not exist. Each ships the closest thing that is true;
none of them is a layout problem, so none is fixable in `web/`.

- **`Acc` and `ACPL`** (design 2b's table, 2c's results card and move tree, 2d's
  KPI row, 2a's game cards) — nothing in the pipeline computes an accuracy score
  or centipawn loss; `services/stats.py` aggregates win percentage given away.
  The slots carry that instead (`Worst`, `Win % given away`, `Blunder rate`), so
  the columns read in real units rather than invented ones. Needs a backend
  accuracy/ACPL model.
- **The `Standard · d32` tier** (design 1a's header, 1c's tier row) —
  `db/enums.py: Tier` is `quick | deep`, so the teal middle badge has nothing to
  render for. Adding it is a backend scope change (a third budget, its own engine
  binding and queue priority), not a badge.
- **The `Variations` and `Book` move-list tabs** (design 1a) — `/games/{id}`
  sends a flat move list with no variation tree and takes none, and `Book` is the
  per-position question `/explorer` already answers on a screen with a board to
  walk it. The slot carries `Flagged`; the design's `PGN` affordance is
  implemented. Rationale in `MoveList.tsx`'s docblock.
- **The sidebar footer's `2.4 GB / 3.8 GB`** (every design frame) — no endpoint
  reports disk usage. The same three-line treatment carries deep-analysis
  coverage of the library, which is the "how full is this database" question the
  API can answer. Rationale in `SideNav.tsx`'s docblock.

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

## Line preview

Hovering an engine line answers "how does this go", not just "what's the first
move" — prototyped in `prototypes/line-preview.html`, planned in
`prototypes/line-preview-plan.md`. Three gestures: hovering the **row** draws
the whole line (layered arrows, a plan overlay, a ghost playthrough, or a peek
board, per the row mode); hovering a **token** in the line scrubs the board to
the position after that move; **wheel** over the row steps through it.
Row modes: **arrows** layers every ply, thinner and fainter with depth;
**overlay** ghosts each piece onto where the line leaves it, with a trail
behind it — the plan, not the sequence; **play** auto-plays the line at a
tempo and snaps back; **peek** pops up a small board with the end position,
leaving the main board alone; **off** draws nothing. Arrows use
`previewWhite1..4` (stepped off `--bb-accent`) for White's moves and
`previewBlack1..4` (stepped off `--bb-deep`) for Black's — deliberately not
Maia purple, so a preview never reads as a claim about what a human would
play. The preferences (row mode, scrub, depth, colours, playthrough tempo)
live in `localStorage`, not `AppSettings` — they are a reading habit for this
browser, not a fact about the deployment, and screen size and taste are per
device (the line-preview control beside a live analysis panel).

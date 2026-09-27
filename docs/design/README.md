# Frontend implementation notes

Source: Claude Design project "Blunderbase design spec"
(claude.ai/design/p/ea601f62-a04a-463a-b9af-034180c85645). Files in this
directory are local snapshots pulled 2026-08-25.

## Decisions

- **Compute: Engines and Machines as two pages**
  (`prototypes/compute-pages.html`, built 2026-09-12; plan and what differs from the
  prototype in `docs/compute.md`). The Engines page's inventory and its capacity grid become two rail
  rows under a `Compute` heading: *Engines* is what is installed (roles, the list with
  `Threads` and `Hash` on the row, the editor, adding), *Machines* is where it runs (one
  card per host with the two "how much at once" numbers editable for this server, a
  budget line that adds threads × processes up against the cores, and the runner
  lifecycle). Search slots leaves the correspondence settings for the server's card, and
  the queue's concurrency joins it as a setting with the env var as an override.
- **Notes screen: a flat list, in one of two views**
  (`prototypes/notes-screen.html`, chosen 2026-09-02). The grouping by game is gone —
  a game is where a note was *written*, not what it is about, `/games` is already the
  index of games, and at 1.5 notes per noted game the headings forced a row break each
  and left the columns two-thirds empty, which is what made the screen look wrong. Time
  orders it instead, cut into date rules that cost a line rather than a row. Two views
  behind a segmented control at the head of the filter row: **Stream**, two notes to a row
  with the board beside the words and every note whole, and **Sheet**, a denser grid with
  the board on top and the text clamped. The stream's cap is on the column (46rem, about
  ninety characters) and not on the page, so a wide monitor buys a second column rather
  than a longer line. Both write, and the choice is a per-browser preference rather than
  a URL parameter. The prototype's third and fourth options — a two-pane reading desk, and
  shelves grouped by tag — are not built; the desk is the answer to a note count this
  library does not have yet.
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
    rounded and a region is not. Which radius goes where is now part of the control
    standard below.
  - **The neutral ramp is grey, not blue-black**, and the accent is a muted blue
    (`#83b7e3` dark, `#245f9e` light) rather than the flagship teal — a bright
    accent is what made the app read as a dashboard. Maia keeps its purple, and
    blunder/mistake keep their saturated hues. Token *names* are unchanged, so
    `accent-teal` is still the accent's class; only its value moved.
  - **The overview is sections, not cards**: a heading over a rule
    (`components/shell/Section.tsx`).
  - **The titlebar is the page's heading** (owner, 2026-09-27). A screen used to be
    named three times: the rail's highlighted row, the titlebar crumb, and an in-page
    `h1` with a subtitle under it. The `h1` and its subtitle are gone from every screen.
    The last crumb is the page's name, a step brighter than the way there. The page's
    buttons go through `SetPageChrome`'s `actions` and follow the crumb from `md` up, so
    the bar reads in two halves: the page on the left, the app on the right. Below `md`
    the shell puts them in one row under the bar (`AppShell`'s `PhoneActions`), and the
    titlebar keeps only the last crumb. The (?) left the bar for the rail's footer, as
    **Manual** beside the GitHub link: it is the app's help, not the page's command.
    Subtitles that explained a page were dropped, since the manual is for that. Live facts went
    where they belong: the games count is the table footer's, and a full notes page
    says so under its last note. Only the game screen was already built this way.
  - **The game screen is one workspace**: a full-width `GameHeaderBar`, then the
    board flush left and a pane matrix to its right whose four title strips —
    Maia, the engine, Moves/Flagged, Book/Notes — sit on one line. The real
    `EvalGraph` is unchanged in behaviour; only its frame is.
  - The three-state theme mechanism, the pre-paint bootstrap and the token layer
    are unchanged — see "Themes" below, which still describes how it works.
- **Polish pass: one type scale, one control standard** (2026-09-26). A pass inside
  the restrained direction above, not a new one: same panes, rail, tokens and
  components, with the ad-hoc sizes, the hand-copied button strings and the four
  different "selected" tints folded into the rules below.
  - **Type scale.** Six named sizes, defined once as `--text-*` in a plain
    `@theme` block in `web/src/index.css`, so Tailwind generates `text-<name>`.
    Sizes are design px; rendered size is × 1.2 (the root scale).

    | utility | size / line-height | weight | default colour | used for |
    |---|---|---|---|---|
    | `text-meta` | 0.625rem / 0.875rem (10) | 400 | `dim`, `dim-2` | depth/nps/nodes, "analysed …" stamps, counts in tab strips, table column heads (uppercase, tracking .06em). The floor: nothing is set smaller. |
    | `text-label` | 0.6875rem / 1rem (11) | 400–500 | `soft` (controls), `dim` (captions) | xs controls, chips, segments, form labels, clocks, eval chips, a section's detail, legends |
    | `text-data` | 0.75rem / 1rem (12) | 400 | `body` | table cells, list rows, sm/default button labels, engine and book lines, notes, tooltips |
    | `text-lead` | 0.8125rem / 1.25rem (13, the body size) | 500–600 | `ink` | player names, move-list SAN, the note composer |
    | `text-heading` | 0.875rem / 1.25rem (14) | 600 | `ink` | a section's h2, the game header's opening, dialog titles |
    | `text-value` | 0.9375rem / 1.25rem (15) | 500 | `ink`, mono | key numbers: a chart's current rating, a trend's value |

    There is no page-title size, because there is no page title (see "The titlebar is
    the page's heading" below). `web/src/lib/utils.ts` extends tailwind-merge with the
    same six names. Without
    that, `cn()` reads `text-meta` as a colour and silently drops it, or the colour
    beside it; `utils.test.ts` pins the merge. Do not name a size after a colour alias
    (`body`, `soft`, `line` …).

    Notation has no utilities of its own: the move list is `font-mono text-lead`,
    engine/Maia/live lines, variations and book rows are `font-mono text-data`, and an
    eval chip is `font-mono text-label font-semibold tabular`. Everything else (nav,
    labels, tabs, buttons, names, openings) is Geist sans, and a UI label is never mono.
    A value that has to line up gets `font-mono` (which already brings tabular
    figures) or `tabular`.
  - **The text ladder.** `bright`/`ink` for primary data (names, SAN, the first line,
    key values, the active tab or selection); `ink-2`/`body` for primary content;
    `soft` for idle control text and secondary data; `dim`/`dim-2` for metadata only;
    `faint` for decoration and tertiary marks only (separators, parentheses,
    placeholders); `faint-2` for disabled and "passed" tokens only. A control's idle
    text is never below `soft`, and essential data is never below `body`.
  - **Controls** (`components/ui/button.tsx`). Sizes: `xs` (h-6, `text-label`,
    size-3 icons — the pane-title strips), `sm` (h-7, `text-data`, size-3.5 icons —
    the standard toolbar, control-row and footer button), `default` (h-8,
    `text-data` — forms and dialogs), `lg` (h-9, `text-lead`), and the squares
    `icon` (size-8), `icon-sm` (size-7) and `icon-xs` (size-6), each with a size-4
    icon. The base carries no font size or gap: each size sets its own, because a
    bare `buttonVariants(...)` string never passes through tailwind-merge. Variants:
    `default` is the filled accent, at most one per region (Sync all, Resume, Save);
    `secondary` is *the* tool button (`border-edge bg-elevated text-body`), which
    replaced eight hand-copied class strings; `outline` and `ghost` are its quieter
    neighbours; `destructive` and `link` as they were. `Segmented`
    (`routes/stats/kit/states.tsx`) is h-7 to sit beside an `sm` button, `FilterChip`
    (`components/ui/chip.tsx`) h-6, both sans. An error message is `.bb-error`: a
    blunder-red frame and left bar around `body` text, never red text on a red tint,
    which falls under AA on the light panel.
  - **One selected state.** `bg-selected text-ink`, plus `border-accent-teal/45`
    where the element has a border, and the accent on a pressed toggle's icon. A
    `Button` gets it from `aria-pressed` (on `secondary`, `outline` and `ghost`, never
    the filled `default`); `Segmented`, `FilterChip` and the rail use the same pair. A
    selected list or table row adds a bar down its left edge
    (`shadow-[inset_0.125rem_0_0_var(--bb-accent)]`). The move list's current move is
    `bg-selected text-bright` with an inset accent ring; the pair under the cursor is
    `--bb-row-active`, a blue-grey that does not read as hover. Pane tabs keep their own
    idiom (the surface pushed up into the strip, `paneTabs.ts`). The accent tints
    (`bg-accent-teal/10`, `/8`) are retired as selection. Blue means selection and
    interaction; strong colour is kept for evaluation, results, classification glyphs,
    errors and Maia's purple.
  - **One hover**: `hover:bg-raised`. `--bb-raised` reads on the canvas and on the
    chrome in both themes (dark 1.30:1 / 1.16:1, light 1.22:1 / 1.10:1).
  - **Radii.** Controls, menus and popovers `rounded-md` (4px); inline data badges
    (classification, counts, run and status chips) `rounded-sm` (3px); dialogs may keep
    `rounded-xl` (5px); regions and panes none.
- **Layout: Option 1a "Studio"** (chosen by Phil) — four columns: paired move
  table with glyph badges · board with Maia overlay · filled eval area chart ·
  notes/MCP column with recurring-mistake cards. Option 1b is not implemented.
  The "Component states" section (1c) applies to the chosen layout.
- Palette/typography come from the design file: dark-first, bg `#08090b`,
  accent teal `#3ecfd6`, purple `#c9b0ff` for Maia and for runs a person asked for, fonts Geist +
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
  - **Dark stays the flagship look** and is the default for a fresh install; its
    values are the 2026-09-01 direction's, retuned by the 2026-09-26 polish pass
    (panel, hover, selected, the cursor row and `dim-3`), not the design file's hex.
    Picking `system` is how the owner opts into following the OS.
  - **Light is derived from the same design language**, not a second palette. The
    neutral ramp is inverted *by contrast rank*, so a token that was the quietest
    label in the dark is still the quietest label in the light: `#08090b` ground →
    `#f4f6f8`, `#e7eaef` text → `#12161c`, `#646c78` → `#626a75`, `#252b33`
    borders → the `#d1d8e0`/`#bcc5cf` pair. The teal and purple keep their
    identity and are darkened only as far as contrast demands: `#3ecfd6` →
    `#0a7b82` (4.65:1 on the page ground), `#c9b0ff` → `#7b4cd8` (5.01:1).
    Text tokens down through `--bb-dim-2` clear WCAG AA (≥4.5:1) on both the
    canvas and the chrome. Light, since 2026-09-26: `dim-2` #6d6d69 is 5.02:1 on
    `--bb-surface` and 4.51:1 on `--bb-panel`, `dim` 5.32 / 4.78, `dim-3` 5.65 /
    5.08, `soft-2` 6.00 / 5.39 — spaced about 1.06:1 apart so the ramp is still a
    hierarchy. Dark: `dim-2` 5.43 / 4.81, `dim` 6.08 / 5.39. `--bb-faint` is 4.49:1
    (dark) and 4.40:1 (light) on the canvas and below AA on the chrome (3.98 / 3.96),
    so it and `--bb-faint-2` are decoration and disabled only (rules, chart grid,
    separators). Accent text on `--bb-selected` is 4.53:1 dark and 4.93:1 light.
    Board squares and the chart palette have light variants of their own.
  - **Every colour resolves through the token layer.** `web/src/index.css` is the
    only file in `web/src/` whose styles name a hex, with one exception: the
    browser's `theme-color` cannot read a CSS variable, so the two `--bb-panel`
    values are copied into `web/index.html` (the meta tag and the pre-paint script)
    and `web/src/lib/ui/theme.tsx` (`THEME_COLOR`). The manual's
    `manual/en/assets/manual.css` copies the surface and text tokens it uses for the
    same reason. When one of those tokens changes, the copies change with it.
    `:root` holds the dark palette (so any
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
- **The `Standard · d32` tier name** (design 1a's header, 1c's tier row) — there
  are no named tiers to print: a game has the import pass and any runs a person
  asked for, each with its own limit. The header's `RunBadge` prints what the run
  was instead — `d24 · 2 lines`, `10s · 2 lines`, `500k · 2 lines` — in the deep
  token for a requested run and neutral for the import pass. The design's name
  half (`Standard`) is the part left out.
- **The `Variations` and `Book` move-list tabs** (design 1a) — `/games/{id}`
  sends a flat move list with no variation tree and takes none, and `Book` is the
  per-position question `/explorer` already answers on a screen with a board to
  walk it. The slot carries `Flagged`; the design's `PGN` affordance is
  implemented. Rationale in `MoveList.tsx`'s docblock.
- **The sidebar footer's `2.4 GB / 3.8 GB`** (every design frame) — no endpoint
  reports disk usage. The same three-line treatment once carried analysis
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

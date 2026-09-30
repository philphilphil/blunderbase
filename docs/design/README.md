# Frontend implementation notes

Source: Claude Design project "Blunderbase design spec"
(claude.ai/design/p/ea601f62-a04a-463a-b9af-034180c85645). Files in this
directory are local snapshots pulled 2026-08-25.

## Decisions

- **Clarity pass (owner, 2026-09-29)** (`prototypes/clarity/`). The owner turned down an
  Apple-look redesign but wanted its clarity in this design: "navigation is way more
  clear, tabs are visible as tabs, buttons, everything is clear". Nothing of the look
  moved (palette, type scale, density, the pane idiom, the board and the charts); the
  control grammar did. The principles:
  1. One mark means "you are here", and nothing else looks like it: accent text on a quiet
     grey pill (`--bb-nav-current`). The blue fill is never location.
  2. The page name is a title, and the page's commands stand apart from it.
  3. A raised face means "press me", and only a pressable thing has one. A sunk field
     means "type here"; a border alone is a chip; nothing at all is data.
  4. Each kind of control has its own silhouette (tab, one-of-N, button group, picker,
     menu, switch, chip, link, readout), so the shape tells the kind before the word.
  5. Each state has its own channel (see "One state, one channel" below).
  6. One filled button per region, last in its group; a disabled button loses its face.
  7. The rail holds the app, the bar holds the page.
  8. One name per place: the lit rail row, the title, the palette and the manual agree.
  9. Keep the look: the new tokens are neutral greys and one shade.

  The four taste decisions were all taken as **A**: a pane tab is a **folder tab** (the
  pane's surface pushed into the strip with a 2px accent top edge, D1-A); a chosen segment
  is a **neutral raised thumb** in a sunken track (D2-A); **the rail carries the app and
  the bar carries the page** (D3-A); and **up to two collections are pinned in the rail**
  under Collections (D4-A). The spec with every contrast figure is the prototype's
  `clarity.css`; the controls are described under "Controls" below.

  What the pass settled on the game screen:
  - **Maia's compare is a value of the level picker** ("All levels, side by side"), not the
    26×18 bordered toggle that sat beside the label and that nobody could name: "which
    level" and "all of them" answer one question, and folding it in gave the Maia column
    its width back. A level the position has no data for is offered disabled.
  - **Live is started from its own pane.** An idle Live tab offers Start in the pane, and
    while the search runs a Stop tool stands *beside* the tabs, never in one: a tab only
    shows a pane and never starts or stops anything.
  - **The engine strip's order is tabs │ facts … │ tools.** The facts (engine, MPV, the
    limit) say what the pane shows and are the only part that yields; the tools after the
    rule (Arrows, **Analyse…**) keep their place. Under 22rem of strip (the pane at 1280)
    the Arrows picker drops its word and then the MPV readout goes, so **Analyse…** is
    never the thing pushed off.
  - **The game's dialogs end in `DialogFooter`** (`components/engine-dialog/DialogFrame`:
    Analyse…, Practise…, Collections): Cancel as a tool button, then the one filled
    primary, last. Cancel had been an outline in one dialog and a ghost in the next.
  - **"Add to library" is the control row's one filled button** on a model game's screen
    (a game opened from the explorer's references, `StudioActions`): it is the one
    affirmative act there, and everything else on the row is a tool button.
  - **The PGN region on Import has its own Skip evaluation**, deliberately independent of
    the accounts' box: each region says for itself whether what it brings in is analysed,
    beside the button that brings it in.
  - **One Flip everywhere**: the `FlipVertical2` mirror and the word "Flip" on every board
    (game, explorer, repertoire, Live; icon alone where a strip has no room, as the game's
    player row and correspondence). An arrow pair is a swap, and ⇅ is the picker's mark.

  And across the app:
  - **Place names are joined by `›`**, in the UI and in the manual (`Compute › Engines`),
    the trail's own separator; `→` is left for moves and ranges.
  - **A popover hangs from the edge its picker stands at** (`FilterPopover align="end"`
    for a picker at the right of its region: the Dashboard's Speed, the explorer's
    filters), so it never covers the next column or runs off the window.
  - **A sideways-scrolling table fades its right edge** while more is off to that side
    (`lib/ui/useMoreRight.ts`): the Games table and the explorer's move tables.
  - **Speeds are names**, capitalised and in one order, bullet to correspondence, on every
    picker and chip; the Dashboard's list carries each speed's game count.
  - **German writes an ellipsis after a word with a space** ("Analysieren …"), in the
    catalog and the manual alike.
- **Game collections: named, coloured groups of games** (issue #37,
  `prototypes/organize-collections.html`, chosen 2026-09-26 over
  `prototypes/organize-tags.html` and `prototypes/organize-folders.html`). A collection holds
  games rather than a query, a game can be in several, and it lives on the server, so it
  reaches the phone and MCP where a saved filter never did. It gets a tinted chip on the rows
  and in the game header (colour keys from the token palette: `accent`, `good`, `otb`,
  `way-back`, `mistake`, `info`, `blunder`) and an **Add to…** checklist in the library's
  footer and behind the game page's ⋯ (half-ticked when only part of the selection is in).
  Revised 2026-09-27: collections are their own rail entry after Games, `/collections`, a
  grid of cards (colour, name, count, description, the owner's score line, the rule, last
  played) that each open `/games?collection=…&whose=all`; on Games a collection is a plain
  filter chip — no title, score line or Clear of its own — and the rail fold and the
  "collection page" mode of the library are gone. Games get in by hand or by a rule, and a
  rule is a subset of the library's own filter vocabulary (plus `rated`, which the library
  gained for it) matched against new imports only, so taking a game out by hand sticks.
  **Set apart was deliberately not built.** The prototype's per-collection switch that hid a
  collection's games from the library, the dashboard and Stats, and the Stats strip that
  announced it, are left out: a collection never hides games, and it is a filter dimension
  everywhere instead — the library, Stats and the explorer can each be narrowed to one. The
  switch may come back together with a rework of the reference-games (`whose`) feature,
  which is the library's existing answer to "games that should not count".
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
  - **The titlebar is the page's heading** (owner, 2026-09-27; reshaped by the clarity
    pass, 2026-09-29). A screen used to be named three times: the rail's highlighted row,
    the titlebar crumb, and an in-page `h1` with a subtitle under it. The `h1` and its
    subtitle are gone from every screen. The bar's last crumb is the page's title, in
    `text-heading` (the bar's `h1`, never a link), and every crumb before it is a place,
    so it is a link (`text-data text-soft`, ink and underlined on hover) with a `›`
    between: `Library › Import`, `Games › Blunders`, `Collections › League 2026`. A thing
    that is not a place (the game's date) is not a crumb. The page's buttons go through
    `SetPageChrome`'s `actions` and stand **right-aligned**, then a `bg-line` rule (only
    when there are actions), then the **Hide engine** switch, the one global left in the
    bar because it must be reachable before a game is opened. The bar's left padding is
    the page gutter (`pl-6`), so the title sits over the column it names.
  - **The frame: the rail carries the app, the bar carries the page** (clarity D3-A).
    From `md` the shell is a two-column grid: the 200px rail full height (52px folded, the
    fold kept in `blunderbase.navCollapsed`), and a column of the 42px bar over the page.
    The rail's first row is the brand (mark, name, the flat Demo tint on the public demo)
    at 42px with its own `edge-strong` rule, so the band and its rule still cross the
    window; then a field-shaped **Search everything ⌘K**; then the destinations (no
    heading over the first group, `Data & compute` in sentence case over the second); then
    a three-row foot: the status line (the engines as one link to Compute › Engines, the
    queue as an unboxed readout), the account row (an initials disc and the name, its menu
    opening upward, where Appearance, Language and Keyboard shortcuts now live), and the
    utility row (fold, Manual, GitHub, the connection dot, the version). Only the middle
    scrolls, and at 1440×900 with any one fold open it does not. On a phone the bar spans
    the window with ☰ (or a `‹ Parent` back link on a detail page, `SetPageChrome`'s
    `back`), the title, the switch without its word, and search as an icon; the page's
    actions stand in a row under it (`PhoneActions`); the drawer is the rail in the same
    order, without the fold control.
  - **One "you are here", on the leaf** (clarity). The rail marks the deepest current
    place, and only it: `bg-nav-current` with `text-accent-teal font-medium` and an accent
    icon. Its parent (Library over Import, Stats over its report, Games over a saved cut)
    stays plain `text-ink`; folded to icons, the parent lights instead. Idle rows are
    unchanged (`text-soft`, `size-3.5 text-dim` icons) and hover changes the text only: a
    hover fill was a second lit row. A route fold is at most four rows, the last of them
    `More (n) ›` to its page when there are more, and never hides the lit row (four rows
    plus `More` overflowed the 900px rail on Games; `shell/fit.mjs` in the clarity shots
    measured it). Row titles carry the page's shortcut
    ("Games ⌘2"), as the palette's page rows do.
  - **Pinned collections** (clarity D4-A). The first two collections, in the Collections
    page's order, always sit under the Collections row (one while correspondence mode is
    on, none when there are none), at the fold's indent without its rule, each marked by
    its square swatch where a saved filter has a round dot. A row opens
    `/games?collection=<id>&whose=all`; while Games shows exactly that, the row is the lit
    leaf, Collections its parent, Games unlit, and the title reads `Collections › <name>`.
    The rail and the title both ask `web/src/lib/libraryPlace.ts`, so they cannot disagree.
    The **Manual** link sits in the rail's utility row: it is the app's help, not the
    page's command. Subtitles that explained a page were dropped, since the manual is for
    that. Live facts went where they belong: the games count is the table footer's, and a
    full notes page says so under its last note.
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

    There is no page-title size: the bar's title reuses `text-heading` (see "The titlebar
    is the page's heading" above). Nothing else sets a font size: no `text-[…rem]` and none
    of Tailwind's stock `text-xs` … `text-xl`. `scale.test.ts` fails on either, except for
    the short list of things that are not text in this sense (the captured-piece
    figurines, the two Stats display numerals), each named there with its reason.
    `web/src/lib/utils.ts` extends tailwind-merge with the
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
    bare `buttonVariants(...)` string never passes through tailwind-merge (the export
    runs `cn` itself since the clarity pass). Variants, as the clarity pass (2026-09-29)
    left them:
    - `default`, the filled accent: the one action a region exists for, at most one per
      region and last in its group (Sync all, Save, Queue analysis, a dialog's OK). Never
      `aria-pressed`.
    - `secondary`, *the* tool button and every other command (toolbar, control row,
      footer, card, Cancel): a **face**, `bg-control` on a `control-edge` border with a 1px
      inner bottom shade (`shadow-face`). Hover lifts it (`control-hover`), mouse-down
      sinks it (`raised-2`, shade dropped), `aria-pressed` lights it (below). The icon
      squares take `control-edge-strong`, since without a label the edge is the whole
      signal (≥ 3:1).
    - `ghost`: icon actions in table rows, note cards and pane strips, where a face would
      be noise. No ghost *text* buttons.
    - `destructive-outline`: the red command in a toolbar (Delete, Reset library), a face
      with a blunder border and text, last after a gap. `destructive`, filled red, is only
      a confirmation dialog's confirm button.
    - `link`: prose only; a link that goes somewhere is `TextLink`.
    - `outline` is **retired**: it is `secondary`'s exact string for one release, and
      `lib/ui/grammar.test.ts` fails on a new use.
    - **Disabled is one look** for every faced variant: the silhouette without the face
      (transparent, `edge` border, `faint-2` text, icon at 70 %). It keeps pointer events,
      so the cursor says not-allowed and the `title` can say why; hover and active are
      `not-disabled:` (a router `Link` takes these classes too, and `:enabled` never
      matches an `<a>`). A Radix tooltip on a disabled button wraps it in a span
      (`TooltipTrigger` does it).

    The other controls, one component each in `components/ui/`, each a shape of its own:
    - **`Segmented`** (`segmented.tsx`): one value out of two to five short options, all
      visible (a window, a colour, Mine / Others / All, a view, a theme). A sunken
      `bg-void` track with the chosen option as a **raised neutral thumb** (`bg-control`,
      `shadow-thumb`), no dividers, sans, never wrapping; a `radiogroup` with the arrow
      keys choosing. `ViewToggle` wraps it. Neutral, because a setting's value is not a
      selection of data.
    - **`ButtonGroup`** (`button-group.tsx`): "do one of these" (⏮ ◀ ▶ ⏭, flag and explorer
      navigation). Attached faces under one outline, never a sunken track.
    - **`PickerButton`** (`picker-button.tsx`): a value from a list (the Games and Notes
      filters, Speed, Rows, the Maia level). A face reading "Label" or "Label: value" and
      ending in `ChevronsUpDown` inside the button; lit blue while set (it narrows), with
      a `×` segment in the same outline; `size="strip"` has no face until hovered, focused
      or open. "Label: value" is one run of text with a word space after the colon.
      **`PickerSelect`** (`native-select.tsx`) is its look over a transparent native
      `<select>` for toolbars and strips (the Maia level and the live engine too, with
      `display` for a face richer than the option's words); nothing rebuilds it by hand.
      The shared outline is `pickerLook` (`picker-look.ts`). **`NativeSelect`** is a plain
      field for forms.
      **`SpeedPicker`** (`components/filters/`) is the one Speed control: "Speed: All" or
      "Speed: Blitz, Rapid" over a checklist, on the Dashboard, Stats and the Explorer.
    - **`ActionMenu`** (`action-menu.tsx`): a list of commands, a labelled face ending in
      `ChevronDown` (⌄, never ⇅) or the `⋯` square; `role=menu`, arrows, Escape.
    - **`Switch`** (`switch.tsx`): a mode or setting that persists (Hide engine, vs
      previous window, Sync automatically). Muted on purpose: a pale accent track and an
      accent thumb, never the saturated iOS pill. `routes/engines/Toggle.tsx` renders it.
    - **`Checkbox`** (`checkbox.tsx`): drawn as a field (an outlined `bg-field` box on the
      strong edge), on and mixed as the accent fill with a glyph.
    - **`FilterChip`** (`chip.tsx`, h-6): "any of these" for a few short values (rating
      bands, tags). A border with no face; on always carries a ✓, and the blue fill only
      while the set is narrowed (`narrowed={false}` when every member is on).
    - **`TextLink`** (`text-link.tsx`): navigation and nothing else. Accent with a `›`
      (`↗` external); `tone="quiet"` for metadata repeated down a list; `placement=
      "inline"` underlined at rest inside a sentence. Accent text means link.
    - **`Badge`** and **`Readout`** (`badge.tsx`): facts. No border in any variant, no
      face, not focusable; a tint at most.
    - **`Pager`** (`pager.tsx`): faced ‹ › around a flat mono "1 / 231".
    - **Fields** (`input.tsx`, `textarea.tsx`): `Input`, `SearchInput` (a leading
      magnifier and a scoped placeholder), `Textarea`. Sunk: `bg-field` with a 1px inner
      top shade (`shadow-field`), the inverse of a face; focus is the accent border and
      the ring.
    - **Tables and rows**: `SortableHead` (`table.tsx`) is a column head whose whole cell
      sorts, and `SortButton` is its button alone for a div grid (the Games table), `end`
      for a right-aligned figure column; `ui/row.ts` gives non-table lists `TableRow`'s
      states.
    - **Pane tabs**: `PaneTabList` / `PaneTab` (`routes/game/components/PaneTabList.tsx`,
      classes in `paneTabs.ts`): sibling `role=tab` buttons in a `tablist`, the chosen one
      a folder tab with a 2px accent top edge hung 1px below the strip's top. A tab never
      has a face, a box or the blue fill.

    An error message is `.bb-error`: a blunder-red frame and left bar around `body` text,
    never red text on a red tint, which falls under AA on the light panel.
  - **One state, one channel** (was "One selected state"; the clarity pass split it,
    because one blue fill had been doing five jobs and so carried no hierarchy):
    - **Location** is accent text on the `--bb-nav-current` pill, in the rail only.
    - **A chosen value** is the raised neutral thumb of a `Segmented`.
    - **On and selection** is the blue fill: `bg-selected text-ink`, plus
      `border-accent-teal/45` where there is a border and the accent on the icon, with a
      face's shade dropped (pushed in). A `Button` gets it from `aria-pressed` (never the
      filled `default`); a set `PickerButton`, a `FilterChip` in a narrowed set, a
      selected row (plus `shadow-row-bar`, the 2px inset accent bar, unchanged on hover)
      take it too. The move list's current move is `bg-selected text-bright` with an inset
      accent ring; the pair under the cursor is `--bb-row-active` plus the bar.
    - **Hover** is `raised` on rows, ghosts and idle tabs, `control-hover` on a face,
      text only on rail rows and idle segments. Never `hover:bg-selected`.
    - **Focus** is one solid 2px accent ring, 2px out (`:focus-visible` in `index.css`),
      pulled inside with `focus-visible:outline-offset-[-0.125rem]` where a strip clips
      it. Fields also turn their border accent. Never a fill, never a per-site ring.
    - **Primary** is the filled accent.
    - **Status** is green for alive (pulsing while working), grey waiting, orange
      degraded, red broken (`StatusDot`). Blue is interaction and choice only.

    `lib/ui/grammar.test.ts` fails on the patterns that bring a retired state back.
  - **One hover**: `hover:bg-raised`. `--bb-raised` reads on the canvas and on the
    chrome in both themes (dark 1.30:1 / 1.16:1, light 1.22:1 / 1.10:1). A face lifts to
    `--bb-control-hover` instead: in dark `raised` is darker than the face and would read
    as pressed.
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
  - **Control tokens** (the clarity pass, 2026-09-29), neutral greys and one shade, with
    aliases of the same name (`bg-control`, `border-control-edge`, `bg-field`,
    `bg-nav-current` …):

    | token | dark | light | for |
    |---|---|---|---|
    | `--bb-control` | `#3c3d3e` | `#ffffff` | a button's face; 1.27:1 on the panel (light 1.15), where `elevated` was 1.05 |
    | `--bb-control-hover` | `#444546` | `#f6f6f4` | a face under the pointer |
    | `--bb-control-edge` | `#5d5f5e` | `#aeaea9` | a labelled face's border and the segment thumb's (2.14:1; the label names it) |
    | `--bb-control-edge-strong` | `#777975` | `#828282` | where the edge is the whole signal: icon faces, the switch track, the checkbox (≥ 3:1) |
    | `--bb-control-shade` | `rgb(0 0 0 / 0.40)` | `rgb(0 0 0 / 0.14)` | a face's 1px inner bottom shade |
    | `--bb-field` | `#212222` | `#f3f3f0` | every field's fill, below the surface and the face in light |
    | `--bb-field-shade` | `rgb(0 0 0 / 0.25)` | `rgb(0 0 0 / 0.06)` | a field's 1px inner top shade |
    | `--bb-nav-current` | `#3a3b3c` | `#e2e2de` | the rail's "you are here" pill; accent text on it 5.26:1 / 5.04:1 |

    The light is five `@theme` shadow utilities, so no call site spells a shadow:
    `shadow-face` (raised), `shadow-field` (sunk), `shadow-thumb` (a chosen segment's edge
    and shade), `shadow-tab-on` (the folder tab's accent top edge) and `shadow-row-bar`
    (a selected row's inset accent bar). `lib/utils.ts` teaches tailwind-merge their
    names, so `cn('shadow-face', 'shadow-none')` keeps the override. The focus ring is
    solid accent now: 6.47:1 / 5.69:1 on the panel, where the old 55 % mix was 2.37:1 on
    the light panel and failed 3:1. The manual's `manual.css` copies none of these.
  - **Mechanism** (unchanged by the 2026-09-01 direction; the hexes above are the
    superseded ones): a resolved `dark`/`light` class plus `data-theme="<preference>"`
    on `<html>`, a three-state choice (the Settings menu's Appearance row since the
    clarity pass; it was in the titlebar), the preference in
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

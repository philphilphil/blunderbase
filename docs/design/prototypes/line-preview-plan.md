# Engine line preview — ideas, decisions and implementation plan

Status: **planned, not started** (2026-08-28). The interactive prototype is
`line-preview.html` next to this file — open it in a browser (or `python -m http.server`
in this folder; pieces load from the lichess CDN, with glyph fallback).

## The idea

Hovering an engine line should show *how the line goes*, not just its first move. Five
ways to do that were prototyped; they answer different questions and hang off different
gestures, so the user gets full control and can combine them rather than pick one.

| Gesture | Question | Options |
|---|---|---|
| Hover the **row** | where does this line go? | **Layered arrows** (every ply, thinner/fainter with depth, numbered) · **Future overlay** (ghost pieces where they end up, trails, capture crosses, current pieces dimmed) · **Ghost playthrough** (auto-plays at a tempo, arrow one move ahead, snaps back) · **Peek board** (mini board popover with the end position) · off |
| Hover a **token** in the PV | what does it look like after this move? | **Scrub** — board shows the position after that move, look-ahead arrows for the next 0–4 plies; played tokens dim |
| **Wheel** over the row | step through it | always on for play/peek/scrub |
| **Click** a token | enter the line | existing `playLine(pv, index)` |

Defaults: arrows (depth 6) + scrub (look-ahead 2) — zero motion, nothing surprising.
Playthrough opt-in (accidental hovers), overlay is the discoverable "wow".

Assessment from playing with the prototype:
- Scrub is the winner for the panel: no timers, text and board always agree.
- Future overlay is the differentiator — shows the *plan*, not the move sequence. Also
  the natural way for the MCP coach to illustrate an idea later ("show this as a plan").
- Layered arrows fine to ~6 plies, mush beyond → depth cap.
- Playthrough needs a start delay; keep opt-in.
- Peek is safe, good for MultiPV side-by-side, but what other tools already do.

## Facts that shape the implementation

- chessground 10.1.1 `DrawShape` (`web/node_modules/@lichess-org/chessground/dist/draw.d.ts`)
  already supports `label` (badge text on an arrow), `piece` (ghost piece at a square, with
  `scale`), `modifiers.lineWidth`, `customSvg` and `below`. **No custom SVG layer needed**;
  the whole preview is `setAutoShapes`. Trails = chain of thin arrows; capture cross =
  `customSvg`.
- Today's hover plumbing is one UCI string: `InfiniteAnalysisPanel.onHoverMove`
  (`components/analysis/InfiniteAnalysisPanel.tsx:223`) → `GamePage.hoverMove`
  (`routes/game/GamePage.tsx:176`) → one `paleAccent` arrow in `BoardPanel`
  (`routes/game/components/BoardPanel.tsx:153`). `MaiaPanel` uses the same prop for single
  moves and keeps it; the live page passes nothing.
- The board already shows off-line positions via `branch`/`analysis` → `boardPosition`
  (`GamePage.tsx:356`). Scrub/playthrough need a *transient* position that must not enter
  the branch — so not `setBranch`.
- `sanLine` in `lib/analysis/streamModel.ts` replays a PV with chessops (stops at the first
  illegal move) — the replay for the preview does the same, once per snapshot.
- Preferences are per browser: `localStorage + useSyncExternalStore` idiom from
  `routes/engines/expertMode.ts`. Screen size and taste are per device; server
  `AppSettings` is for the owner's data.
- Wheel handling to copy: `BoardPanel.tsx` (`WHEEL_STEP` accumulation, non-passive
  listener, ctrlKey = pinch zoom).
- Colour decision: black-side arrows use `--bb-deep` (lavender), **not** Maia purple, so a
  preview never reads as a Maia claim. White-side = accent teal.

## Plan

### 1. `web/src/lib/board/linePreview.ts` — pure model (+ tests)

```ts
export type RowPreview = 'arrows' | 'overlay' | 'play' | 'peek' | 'off'
export interface LinePreviewPrefs {
  row: RowPreview            // default 'arrows'
  scrub: boolean             // token hover, default true
  lookahead: 0|1|2|3|4       // default 2
  depth: number              // 1–18, default 6
  badges: boolean            // default true
  labels: 'move' | 'ply'     // default 'move'  ("7…" vs "8")
  bySide: boolean            // default true
  fade: boolean              // default true
  play: { tempo: number; delay: number; loop: boolean; ahead: boolean }  // 450, 250, false, true
  overlay: { dim: boolean }  // default true
}
export interface PreviewState { line: number; ply: number | null }   // null = row only

/** chessops replay, once per snapshot, memoised by fen + pv.join(' '). */
export function replayLine(fen: string, pv: string[]): {
  fens: string[]                                   // fens[0] = start
  moves: { uci: string; from: string; to: string; piece: Role; captured?: string }[]
}
export function previewShapes(replay, prefs, state, startPly: number): DrawShape[]
/** scrub/play: the position to show instead of the board's; otherwise null. */
export function previewFen(replay, prefs, state): string | null
```

- Brushes (`components/board/brushes.ts`): `previewWhite` (accent) / `previewBlack`
  (`--bb-deep`), each in 3–4 stepped opacity variants (`previewWhite2`, `…3`) since a
  chessground brush carries its opacity; width fade via `modifiers.lineWidth`.
- Labels use `formatVariation`'s numbering so `7…` matches the move list.
- Overlay: `piece` shape at the destination (`scale: 0.8`), thin arrows as trails between
  the squares a piece visits, `customSvg` cross where something is captured; "dim current
  pieces" = a class on the board wrapper + one rule in `index.css`
  (`.bb-preview-dim piece { opacity: .35 }`).
- Arrows mode draws deepest ply first so early plies paint on top.
- Tests: replay stops at an illegal move; castling / en passant / promotion; shape counts
  per mode; label numbering (start ply odd/even); depth cap; look-ahead clamp at line end.

### 2. `web/src/lib/board/linePreviewPrefs.ts` — the store

Copy `routes/engines/expertMode.ts`: one JSON key `blunderbase.linePreview`,
`useLinePreviewPrefs()` / `setLinePreviewPrefs(patch)`, field-by-field validation on read
so a stale or hand-edited value falls back to defaults. Test the fallback and the
`storage` event.

### 3. `InfiniteAnalysisPanel` — tokens instead of a string

- Render the PV as tokens (`<span data-ply>`, `whitespace-nowrap`), move numbers dim as
  now; keep the one-line truncate + `title`.
- New prop `onHoverLine?: (state: (PreviewState & { pv: string[] }) | null) => void`.
  Row `mouseenter` → `{line, ply: null}`; token `mouseenter` → `{line, ply}` (only when
  `prefs.scrub`); leaving the tokens but staying in the row → `ply: null`; leaving the
  row → `null`.
- Wheel over a row (non-passive, `WHEEL_STEP` accumulation like `BoardPanel`) →
  `onStepPreview(±1)` when row mode is play/peek or scrub is on.
- Click a token → `onPlayLine(pv, index)` (new prop; `GamePage.playLine` already does
  this — clears hover, keeps the old branch, sets cursor after the clicked move).
- `onHoverMove` stays for the live page and Maia; the game page passes `onHoverLine`.
- Header gets a small mode chip (`arrows / overlay / play / peek / off`) bound to the
  prefs store — the quick switch without leaving the game.
- Update the existing hover test (`InfiniteAnalysisPanel.test.tsx:191`), add token,
  wheel and click tests.

### 4. `GamePage` + `BoardPanel` — the transient preview

- `GamePage`: `const [preview, setPreview] = useState<{pv; line; ply} | null>()`.
  A `useLinePreview(fen, preview, prefs)` hook (in `lib/board/`) owns the playthrough
  timer (delay → tempo ticks → optional loop) and returns `{ fen | null, shapes, ply }`.
  Cleared on `playLine`, `playMove`, seek, and when the snapshot's PV for that line changes
  (compare `pv.join(' ')`) so a live-updating engine never scrubs a stale line.
- `BoardPanel`: new props `previewFen?: string | null`, `previewShapes?: DrawShape[]`.
  With `previewFen` set: `Board` gets that FEN, `lastMove` from the replay, and the standing
  hints (engine/Maia arrows and marks) are suppressed — they describe the real position.
  Shapes go through `Board`'s existing `shapes` prop. `hoverMove` keeps working for Maia.
  Eval bar and Maia card stay on the real position.
- A hairline label over the board (`Board` `children` slot) reading `after 10.O-O-O` so a
  scrubbed board is never mistaken for the game.
- Peek: `components/board/MiniBoard.tsx` inside a Radix HoverCard/Popover anchored to the
  row, fed the preview FEN; main board keeps the single first-move arrow. Lives in the panel.

### 5. Settings → "Board" card

New `Card` in `routes/settings/SettingsPage.tsx`: row-hover mode `select`, scrub toggle +
look-ahead, depth range, badges + label-style segmented control, colour by side, fade,
playthrough tempo/delay/loop/ahead (shown when `row === 'play'`), dim pieces (when
`overlay`). Native `select`/`input[type=range]` per the frontend conventions. One test that
a change round-trips to `localStorage`.

### 6. Docs

- `docs/design/README.md`: short "line preview" section — the three gestures, the brushes,
  why per-device; link to the prototype.
- `CLAUDE.md` frontend conventions: `lib/board/linePreview.ts` is the only place preview
  shapes are computed.
- Keep `line-preview.html` as the design source.

### Order

1. §1 model + tests   2. §2 store   3. §3 panel   4. §4 wiring, hook, peek
5. §5 settings, §6 docs   6. `cd web && pnpm lint && pnpm typecheck && pnpm test`, then a
manual pass: five row modes × scrub on/off, wheel, click-to-enter, light theme.

~5 commits, ~900 lines with tests. Changelog line for the release: "Added engine line
previews on hover — arrows, plan overlay, playthrough, peek and scrubbing".

## Follow-ups (not in scope)

- Variation hover in the move list (same hook, different data source).
- MCP `show_plan` so the coach can render a line as a future overlay on `/live`.
- Per-ply eval / Maia-probability ribbon under the tokens; marker where the top two PVs
  diverge; Shift to freeze a preview.

import { plural, t } from '@lingui/core/macro'

import type { Classification, Source } from '@/lib/api/types'

import { formatNodes } from './evaluation'

/**
 * The glyph vocabulary from design 1c ("Eval badges — glyph"). It is wider than the
 * backend's `Classification` enum: `interesting` and `brilliant` exist in the design and
 * have no engine rule behind them yet, so nothing maps onto them automatically.
 */
export type Glyph = 'blunder' | 'mistake' | 'inaccuracy' | 'interesting' | 'best' | 'brilliant'

export interface GlyphStyle {
  glyph: string
  /**
   * The word for the glyph, in the reader's language. A getter rather than a stored
   * string: the tables below are module-level constants, so a value computed where they
   * are written would be frozen at import in whatever language was active then. Read on
   * access it is always the live catalog's, and every call site keeps taking a `string`.
   */
  readonly label: string
  /** Tailwind classes for the small square badge. */
  badgeClass: string
  /** Tailwind text colour for the move itself. */
  textClass: string
  /** The token reference, for chart marks and SVG overlays where a class will not do. */
  color: string
}

export const GLYPHS: Record<Glyph, GlyphStyle> = {
  blunder: {
    glyph: '??',
    get label() {
      return t`blunder`
    },
    badgeClass: 'bg-blunder text-blunder-ink',
    textClass: 'text-blunder',
    color: 'var(--bb-blunder)',
  },
  mistake: {
    glyph: '?',
    get label() {
      return t`mistake`
    },
    badgeClass: 'bg-mistake/16 text-mistake',
    textClass: 'text-mistake',
    color: 'var(--bb-mistake)',
  },
  inaccuracy: {
    glyph: '?!',
    get label() {
      return t`inaccuracy`
    },
    badgeClass: 'bg-inaccuracy/14 text-inaccuracy',
    textClass: 'text-inaccuracy',
    color: 'var(--bb-inaccuracy)',
  },
  interesting: {
    glyph: '!?',
    get label() {
      return t`interesting`
    },
    badgeClass: 'bg-info/14 text-info',
    textClass: 'text-info',
    color: 'var(--bb-info)',
  },
  best: {
    glyph: '!',
    get label() {
      return t`best`
    },
    badgeClass: 'bg-accent-teal/14 text-accent-teal',
    textClass: 'text-accent-teal',
    color: 'var(--bb-accent)',
  },
  brilliant: {
    glyph: '!!',
    get label() {
      return t`brilliant`
    },
    badgeClass: 'bg-brilliant/14 text-brilliant',
    textClass: 'text-brilliant',
    color: 'var(--bb-brilliant)',
  },
}

/**
 * The backend's classification as a glyph. `good` deliberately has none — an ordinary
 * move gets no badge in the design, which is what keeps the move list calm.
 */
export function glyphFor(classification: Classification | null | undefined): Glyph | null {
  switch (classification) {
    case 'blunder':
      return 'blunder'
    case 'mistake':
      return 'mistake'
    case 'inaccuracy':
      return 'inaccuracy'
    case 'best':
      return 'best'
    case 'good':
    default:
      return null
  }
}

export function glyphStyle(classification: Classification | null | undefined): GlyphStyle | null {
  const glyph = glyphFor(classification)
  return glyph ? GLYPHS[glyph] : null
}

/**
 * How many moves of a class a row has, as words: "3 blunders", "1 inaccuracy".
 *
 * A switch rather than the plural of `label` with an `s` glued on, because a language
 * that is not English does not build a plural that way — and even English wanted a
 * special case for "inaccuracies". One message per glyph is one thing a translator can
 * put both forms of.
 */
export function glyphCountLabel(glyph: Glyph, count: number): string {
  switch (glyph) {
    case 'blunder':
      return plural(count, { one: '# blunder', other: '# blunders' })
    case 'mistake':
      return plural(count, { one: '# mistake', other: '# mistakes' })
    case 'inaccuracy':
      return plural(count, { one: '# inaccuracy', other: '# inaccuracies' })
    case 'interesting':
      return plural(count, { one: '# interesting', other: '# interestings' })
    case 'best':
      return plural(count, { one: '# best', other: '# bests' })
    case 'brilliant':
      return plural(count, { one: '# brilliant', other: '# brilliants' })
  }
}

/** Whether a classification is one the UI flags — the move list tints only these rows. */
export function isFlagged(classification: Classification | null | undefined): boolean {
  return (
    classification === 'blunder' ||
    classification === 'mistake' ||
    classification === 'inaccuracy'
  )
}

// --- source badges (design 1c, "Source badges") ---------------------------

export interface SourceStyle {
  label: string
  dotClass: string
  chipClass: string
  color: string
}

export const SOURCE_STYLES: Record<Source, SourceStyle> = {
  lichess: {
    label: 'Lichess',
    dotClass: 'bg-info',
    chipClass: 'bg-chip-info border-chip-info-edge text-info',
    color: 'var(--bb-info)',
  },
  chesscom: {
    label: 'Chess.com',
    dotClass: 'bg-good',
    chipClass: 'bg-chip-good border-chip-good-edge text-good',
    color: 'var(--bb-good)',
  },
  fics: {
    label: 'FICS',
    dotClass: 'bg-mistake',
    chipClass: 'bg-chip-neutral border-edge-strong text-soft',
    color: 'var(--bb-mistake)',
  },
  manual: {
    label: 'OTB',
    dotClass: 'bg-otb',
    chipClass: 'bg-chip-otb border-chip-otb-edge text-otb',
    color: 'var(--bb-otb)',
  },
  pgn: {
    label: 'PGN',
    dotClass: 'bg-dim',
    chipClass: 'bg-chip-neutral border-edge-strong text-dim',
    color: 'var(--bb-dim)',
  },
  // A reference game from the masters archive: as quiet as a PGN, since it is one, and
  // told apart from it by its label rather than by a colour of its own.
  masters: {
    label: 'Masters',
    dotClass: 'bg-dim',
    chipClass: 'bg-chip-neutral border-edge-strong text-soft',
    color: 'var(--bb-dim)',
  },
  // A correspondence game started here. It belongs to no platform — there is no ICCF
  // adapter and no account to sync — so it carries the neutral chip and says only what it
  // is, the way `pgn` does.
  iccf: {
    label: 'ICCF',
    dotClass: 'bg-info',
    chipClass: 'bg-chip-neutral border-edge-strong text-soft',
    color: 'var(--bb-info)',
  },
}

// --- analysis runs (design 1c's run chips) -----------------------------------

/**
 * What a run chip is drawn from: the limit each move's search stopped at and the lines it
 * kept, plus whether somebody asked for it. The fields of `RunResponse`, `GameRunSummary`
 * and the `analysis.*` frames alike, so one label serves the queue, the game and the table.
 */
export interface RunShape {
  nodes?: number | null
  depth?: number | null
  seconds?: number | null
  multipv?: number | null
  requested?: boolean | null
  maia_only?: boolean | null
}

export type RunKind = 'requested' | 'import'

export interface RunStyle {
  chipClass: string
  color: string
}

/**
 * Two looks, not one per limit: what the owner needs to see at a glance is whether a run is
 * one they asked for — which is also the run that answers for a move — or the pass every
 * import gets. The limit is in the text. Requested runs keep the `deep` token the old Deep
 * chip wore, so a library analysed before one pass existed looks the way it did.
 */
export const RUN_STYLES: Record<RunKind, RunStyle> = {
  import: {
    chipClass: 'border-edge-strong bg-raised text-soft',
    color: 'var(--bb-muted)',
  },
  requested: {
    chipClass: 'border-deep/28 bg-deep/10 text-deep',
    color: 'var(--bb-deep)',
  },
}

export function runKind(run: RunShape): RunKind {
  return run.requested ? 'requested' : 'import'
}

/**
 * `d24 · 2 lines`, `10s · 2 lines`, `500k · 1 line` — a run as the dialog that queued it
 * would describe it. Depth before seconds before nodes, which only matters on a legacy row
 * that stored two: a requested run carries exactly one. A Maia fill searched nothing, so it
 * says so instead of printing the node budget it was queued with. A game card knows only
 * that a run happened and whether one was asked for, and says `Analysed` rather than
 * inventing a line count.
 */
export function runLabel(run: RunShape): string {
  if (run.maia_only) return t`Maia fill`
  const limit =
    run.depth != null
      ? t`d${run.depth}`
      : run.seconds != null
        ? t`${formatSeconds(run.seconds)}s`
        : run.nodes != null
          ? formatNodes(run.nodes)
          : null
  if (limit === null && run.multipv == null) return t`Analysed`
  const count = run.multipv ?? 1
  const lines = plural(count, { one: '# line', other: '# lines' })
  return limit === null ? lines : `${limit} · ${lines}`
}

function formatSeconds(seconds: number): string {
  return String(Math.round(seconds * 10) / 10)
}

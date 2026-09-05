import { plural, t } from '@lingui/core/macro'

import type { Classification, Source, Tier } from '@/lib/api/types'

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
}

// --- analysis tiers (design 1c, "Analysis tiers") -------------------------

export interface TierStyle {
  /** Read on access for the same reason `GlyphStyle.label` is. */
  readonly label: string
  chipClass: string
  color: string
}

export const TIER_STYLES: Record<Tier, TierStyle> = {
  quick: {
    get label() {
      return t`Quick`
    },
    chipClass: 'border-edge-strong bg-raised text-soft',
    color: 'var(--bb-muted)',
  },
  deep: {
    get label() {
      return t`Deep`
    },
    chipClass: 'border-deep/28 bg-deep/10 text-deep',
    color: 'var(--bb-deep)',
  },
}

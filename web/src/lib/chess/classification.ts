import type { Classification, Source, Tier } from '@/lib/api/types'

/**
 * The glyph vocabulary from design 1c ("Eval badges — glyph"). It is wider than the
 * backend's `Classification` enum: `interesting` and `brilliant` exist in the design and
 * have no engine rule behind them yet, so nothing maps onto them automatically.
 */
export type Glyph = 'blunder' | 'mistake' | 'inaccuracy' | 'interesting' | 'best' | 'brilliant'

export interface GlyphStyle {
  glyph: string
  label: string
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
    label: 'blunder',
    badgeClass: 'bg-blunder text-blunder-ink',
    textClass: 'text-blunder',
    color: 'var(--bb-blunder)',
  },
  mistake: {
    glyph: '?',
    label: 'mistake',
    badgeClass: 'bg-mistake/16 text-mistake',
    textClass: 'text-mistake',
    color: 'var(--bb-mistake)',
  },
  inaccuracy: {
    glyph: '?!',
    label: 'inaccuracy',
    badgeClass: 'bg-inaccuracy/14 text-inaccuracy',
    textClass: 'text-inaccuracy',
    color: 'var(--bb-inaccuracy)',
  },
  interesting: {
    glyph: '!?',
    label: 'interesting',
    badgeClass: 'bg-info/14 text-info',
    textClass: 'text-info',
    color: 'var(--bb-info)',
  },
  best: {
    glyph: '!',
    label: 'best',
    badgeClass: 'bg-accent-teal/14 text-accent-teal',
    textClass: 'text-accent-teal',
    color: 'var(--bb-accent)',
  },
  brilliant: {
    glyph: '!!',
    label: 'brilliant',
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
  label: string
  chipClass: string
  color: string
}

export const TIER_STYLES: Record<Tier, TierStyle> = {
  quick: {
    label: 'Quick',
    chipClass: 'border-edge-strong bg-raised text-soft',
    color: 'var(--bb-muted)',
  },
  deep: {
    label: 'Deep',
    chipClass: 'border-deep/28 bg-deep/10 text-deep',
    color: 'var(--bb-deep)',
  },
}

import type { DrawBrushes } from '@lichess-org/chessground/draw'

/**
 * Chessground's four brush names, recoloured to the Blunderbase palette, plus the ones
 * this app draws with by name.
 *
 * The four defaults matter because that is the vocabulary the MCP `annotate` tool speaks
 * (`backend/services/live.py`: `COLORS = ("green", "red", "blue", "yellow")`), so a coach
 * drawing a "red" arrow gets the design's red rather than Lichess's.
 */
export const BOARD_BRUSHES: DrawBrushes = {
  green: { key: 'g', color: 'var(--bb-good)', opacity: 0.9, lineWidth: 10 },
  red: { key: 'r', color: 'var(--bb-blunder)', opacity: 0.9, lineWidth: 10 },
  blue: { key: 'b', color: 'var(--bb-info)', opacity: 0.9, lineWidth: 10 },
  yellow: { key: 'y', color: 'var(--bb-inaccuracy)', opacity: 0.9, lineWidth: 10 },
  // The two Blunderbase-specific brushes: engine truth is teal, Maia/human is purple.
  accent: { key: 'a', color: 'var(--bb-accent)', opacity: 0.95, lineWidth: 10 },
  maia: { key: 'm', color: 'var(--bb-brilliant)', opacity: 0.9, lineWidth: 9 },
  // Muted variants, for the lines behind the one being shown.
  paleAccent: { key: 'pa', color: 'var(--bb-accent)', opacity: 0.45, lineWidth: 8 },
  paleMaia: { key: 'pm', color: 'var(--bb-brilliant)', opacity: 0.4, lineWidth: 8 },
}

export type BrushName = keyof typeof BOARD_BRUSHES & string

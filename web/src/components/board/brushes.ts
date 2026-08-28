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
  // The engine line preview (`lib/board/linePreview.ts`, which is the only place these
  // names are built). A chessground brush carries its own opacity, so an arrow that fades
  // with depth needs one brush per step rather than one brush and a number: `1` is the ply
  // nearest the position, `4` the deepest one still drawn. Black's side is `--bb-deep`
  // lavender and deliberately not Maia purple — a preview is the engine talking, and must
  // never read as a claim about what a human would play.
  previewWhite1: { key: 'w1', color: 'var(--bb-accent)', opacity: 0.95, lineWidth: 10 },
  previewWhite2: { key: 'w2', color: 'var(--bb-accent)', opacity: 0.72, lineWidth: 9 },
  previewWhite3: { key: 'w3', color: 'var(--bb-accent)', opacity: 0.5, lineWidth: 8 },
  previewWhite4: { key: 'w4', color: 'var(--bb-accent)', opacity: 0.32, lineWidth: 7 },
  previewBlack1: { key: 'k1', color: 'var(--bb-deep)', opacity: 0.95, lineWidth: 10 },
  previewBlack2: { key: 'k2', color: 'var(--bb-deep)', opacity: 0.72, lineWidth: 9 },
  previewBlack3: { key: 'k3', color: 'var(--bb-deep)', opacity: 0.5, lineWidth: 8 },
  previewBlack4: { key: 'k4', color: 'var(--bb-deep)', opacity: 0.32, lineWidth: 7 },
  // The overlay's trails: the route a piece took, drawn thin enough to stay behind the
  // ghost pieces that are the point of that mode.
  previewGhost: { key: 'pg', color: 'var(--bb-accent)', opacity: 0.4, lineWidth: 5 },
}

export type BrushName = keyof typeof BOARD_BRUSHES & string

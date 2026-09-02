import type { DrawBrushes } from '@lichess-org/chessground/draw'

/**
 * Chessground's four brush names, recoloured to the Blunderbase palette, plus the ones
 * this app draws with by name.
 *
 * **`lineWidth` is in 64ths of a square**, and the house width is **8** rather than
 * chessground's default 10. Ten is drawn for a board you look at from across a room; at the
 * size this app gives its board an arrow that wide is a bar across two squares, and three
 * of them at once was a diagram rather than an annotation. Everything is scaled off that 8,
 * so the whole board's arrow weight moves together if it is changed again. The arrowhead is
 * not a separate number — chessground sizes its marker off `lineWidth`.
 *
 * The four defaults matter because that is the vocabulary the MCP `annotate` tool speaks
 * (`backend/services/live.py`: `COLORS = ("green", "red", "blue", "yellow")`), so a coach
 * drawing a "red" arrow gets the design's red rather than Lichess's.
 */
export const BOARD_BRUSHES: DrawBrushes = {
  green: { key: 'g', color: 'var(--bb-good)', opacity: 0.9, lineWidth: 8 },
  red: { key: 'r', color: 'var(--bb-blunder)', opacity: 0.9, lineWidth: 8 },
  blue: { key: 'b', color: 'var(--bb-info)', opacity: 0.9, lineWidth: 8 },
  yellow: { key: 'y', color: 'var(--bb-inaccuracy)', opacity: 0.9, lineWidth: 8 },
  // The three standing board arrows, and the one rule about them: identical geometry,
  // different colour. Engine truth is blue, Maia/human is purple, and what the game actually
  // played is chalk — no hue at all, because it is a fact rather than a verdict. All three
  // come from the `--bb-arrow-*` family, which is the panel hues at about two thirds of
  // their saturation: an arrow lies on a slate board over a piece, and what reads as an
  // accent in a button reads as poster paint there. They are the same weight and the same
  // opacity on purpose: a thinner or fainter arrow reads as a weaker claim, and none of the
  // three is a weaker claim than the others.
  accent: { key: 'a', color: 'var(--bb-arrow-engine)', opacity: 0.95, lineWidth: 8 },
  maia: { key: 'm', color: 'var(--bb-arrow-maia)', opacity: 0.95, lineWidth: 8 },
  played: { key: 'pl', color: 'var(--bb-arrow-played)', opacity: 0.95, lineWidth: 8 },
  // The muted variant, for a line being pointed at behind whatever is standing. There is
  // no pale Maia any more: the standing arrows are all one weight now, and the only thing
  // still drawn quietly is the hover.
  paleAccent: { key: 'pa', color: 'var(--bb-arrow-engine)', opacity: 0.45, lineWidth: 7 },
  // The engine line preview (`lib/board/linePreview.ts`, which is the only place these
  // names are built). A chessground brush carries its own opacity, so an arrow that fades
  // with depth needs one brush per step rather than one brush and a number: `1` is the ply
  // nearest the position, `4` the deepest one still drawn. Black's side is the arrow
  // family's own lavender and deliberately not Maia's purple — a preview is the engine
  // talking, and must never read as a claim about what a human would play.
  previewWhite1: { key: 'w1', color: 'var(--bb-arrow-engine)', opacity: 0.95, lineWidth: 8 },
  previewWhite2: { key: 'w2', color: 'var(--bb-arrow-engine)', opacity: 0.72, lineWidth: 7 },
  previewWhite3: { key: 'w3', color: 'var(--bb-arrow-engine)', opacity: 0.5, lineWidth: 6 },
  previewWhite4: { key: 'w4', color: 'var(--bb-arrow-engine)', opacity: 0.32, lineWidth: 5 },
  previewBlack1: { key: 'k1', color: 'var(--bb-arrow-deep)', opacity: 0.95, lineWidth: 8 },
  previewBlack2: { key: 'k2', color: 'var(--bb-arrow-deep)', opacity: 0.72, lineWidth: 7 },
  previewBlack3: { key: 'k3', color: 'var(--bb-arrow-deep)', opacity: 0.5, lineWidth: 6 },
  previewBlack4: { key: 'k4', color: 'var(--bb-arrow-deep)', opacity: 0.32, lineWidth: 5 },
  // The overlay's trails: the route a piece took, drawn thin enough to stay behind the
  // ghost pieces that are the point of that mode.
  previewGhost: { key: 'pg', color: 'var(--bb-arrow-engine)', opacity: 0.4, lineWidth: 4 },
}

export type BrushName = keyof typeof BOARD_BRUSHES & string

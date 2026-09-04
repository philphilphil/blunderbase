/**
 * Where a coachmark stands next to the thing it is about.
 *
 * Pure geometry, and separate from the component for that reason: "the popover flipped to
 * the other side because it did not fit" is the only interesting behaviour here, and it is
 * a function of four rectangles rather than of anything on screen.
 *
 * Everything is in physical pixels, because that is what `getBoundingClientRect` and a
 * fixed-position inline style both speak. The root scale (`lib/ui/scale.ts`) is already in
 * the measured rect.
 */

export type Side = 'top' | 'right' | 'bottom' | 'left'

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/** Between the anchor and the popover — enough to read as separate, not as a gap. */
export const GAP = 12
/** The least the popover may come to the window's edge. */
export const MARGIN = 12

/** The sides tried after the preferred one, opposite first: a flip reads as a flip. */
const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
const ORDER: Side[] = ['bottom', 'top', 'right', 'left']

function clamp(value: number, lowest: number, highest: number): number {
  // Lowest wins a window narrower than the popover: overflowing the right edge is
  // recoverable by scrolling nothing, overflowing the left edge hides the Back button.
  return Math.max(lowest, Math.min(value, highest))
}

/** The popover's own rectangle if it stood on this side of the anchor, unclamped. */
function on(side: Side, anchor: Box, popover: Size): { left: number; top: number } {
  const centreX = anchor.left + anchor.width / 2 - popover.width / 2
  const centreY = anchor.top + anchor.height / 2 - popover.height / 2
  switch (side) {
    case 'top':
      return { left: centreX, top: anchor.top - GAP - popover.height }
    case 'bottom':
      return { left: centreX, top: anchor.top + anchor.height + GAP }
    case 'left':
      return { left: anchor.left - GAP - popover.width, top: centreY }
    case 'right':
      return { left: anchor.left + anchor.width + GAP, top: centreY }
  }
}

/** Whether a side has the room the popover needs, without counting on the clamp. */
function fits(side: Side, anchor: Box, popover: Size, viewport: Size): boolean {
  const at = on(side, anchor, popover)
  if (side === 'top' || side === 'bottom') {
    return at.top >= MARGIN && at.top + popover.height <= viewport.height - MARGIN
  }
  return at.left >= MARGIN && at.left + popover.width <= viewport.width - MARGIN
}

/**
 * Where to put the popover, and which side it ended up on.
 *
 * The preferred side first, then its opposite, then the other two; if none of them fits —
 * a window shorter than the popover, mostly — the preferred side stands and the clamp does
 * what it can. The cross axis is always clamped into the window, so a coachmark on a rail
 * entry at the very bottom of the rail is still whole.
 */
export function place(
  anchor: Box,
  popover: Size,
  viewport: Size,
  preferred: Side,
): { left: number; top: number; side: Side } {
  const tried = [preferred, OPPOSITE[preferred], ...ORDER]
  const side = tried.find((candidate) => fits(candidate, anchor, popover, viewport)) ?? preferred
  const at = on(side, anchor, popover)
  return {
    side,
    left: clamp(at.left, MARGIN, viewport.width - popover.width - MARGIN),
    top: clamp(at.top, MARGIN, viewport.height - popover.height - MARGIN),
  }
}

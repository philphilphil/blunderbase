import { describe, expect, it } from 'vitest'

import { GAP, MARGIN, place, type Box, type Size } from './place'

const VIEWPORT: Size = { width: 1400, height: 900 }
const CARD: Size = { width: 300, height: 160 }

/** A comfortable anchor in the middle of the window, where every side fits. */
const MIDDLE: Box = { left: 600, top: 400, width: 120, height: 40 }

describe('place', () => {
  it('puts the card on the side the step asked for', () => {
    const at = place(MIDDLE, CARD, VIEWPORT, 'right')

    expect(at.side).toBe('right')
    expect(at.left).toBe(MIDDLE.left + MIDDLE.width + GAP)
    // Centred on the anchor across the other axis.
    expect(at.top).toBe(MIDDLE.top + MIDDLE.height / 2 - CARD.height / 2)
  })

  it('flips to the opposite side when the preferred one has no room', () => {
    // Hard against the right edge: a card to its right would leave the window.
    const anchor: Box = { left: 1340, top: 400, width: 40, height: 40 }

    const at = place(anchor, CARD, VIEWPORT, 'right')

    expect(at.side).toBe('left')
    expect(at.left).toBe(anchor.left - GAP - CARD.width)
  })

  it('keeps the card inside the window when the anchor is in a corner', () => {
    // The rail's bottom entry: below it there is no room, and centring on it would put the
    // card's lower half under the window's edge.
    const anchor: Box = { left: 8, top: 880, width: 180, height: 30 }

    const at = place(anchor, CARD, VIEWPORT, 'bottom')

    expect(at.side).toBe('top')
    expect(at.left).toBeGreaterThanOrEqual(MARGIN)
    expect(at.top).toBeGreaterThanOrEqual(MARGIN)
    expect(at.top + CARD.height).toBeLessThanOrEqual(VIEWPORT.height - MARGIN)
  })

  it('falls back to the preferred side on a window nothing fits in', () => {
    // A phone in landscape with the keyboard up: no side has the room, and a card clamped
    // into what there is beats no card at all.
    const cramped: Size = { width: 320, height: 200 }
    const anchor: Box = { left: 140, top: 90, width: 40, height: 20 }

    const at = place(anchor, CARD, cramped, 'bottom')

    expect(at.side).toBe('bottom')
    // Clamped both ways: the window is narrower than the card, so the left margin wins,
    // and shorter than it, so the card is pushed up off the bottom edge.
    expect(at.left).toBe(MARGIN)
    expect(at.top).toBe(cramped.height - CARD.height - MARGIN)
  })
})

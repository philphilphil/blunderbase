import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LINE_PREVIEW_DEFAULTS, type LinePreviewPrefs } from './linePreview'
import { useLinePreview, type HoveredLine } from './useLinePreview'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
/** 1.e4 e5 2.Nf3 Nc6 — four plies, so "the end of the line" is a ply the tests can name. */
const PV = ['e2e4', 'e7e5', 'g1f3', 'b8c6']
const ROW: HoveredLine = { line: 'live:1', ply: null, pv: PV }

function prefs(patch: Partial<LinePreviewPrefs>): LinePreviewPrefs {
  return { ...LINE_PREVIEW_DEFAULTS, ...patch }
}

const TEMPO = 400
const DELAY = 200
const PLAY = prefs({
  row: 'play',
  play: { tempo: TEMPO, delay: DELAY, loop: false, ahead: true },
})
const LOOPING = prefs({
  row: 'play',
  play: { tempo: TEMPO, delay: DELAY, loop: true, ahead: true },
})

interface Props {
  fen: string | null
  hover: HoveredLine | null
  prefs: LinePreviewPrefs
}

function setup(initial: Partial<Props> = {}) {
  return renderHook(({ fen, hover, prefs: current }: Props) => useLinePreview(fen, hover, current, 0), {
    initialProps: {
      fen: START,
      hover: null,
      prefs: LINE_PREVIEW_DEFAULTS,
      ...initial,
    },
  })
}

/** The timers are the point of most of this file, so they are fake throughout. */
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useLinePreview', () => {
  it('draws nothing, and steps nowhere, with no line under the pointer', () => {
    const { result } = setup()
    expect(result.current).toMatchObject({
      fen: null,
      shapes: [],
      line: null,
      ply: null,
      dim: false,
    })
    // A wheel over a panel showing nothing is not an error, it is nothing.
    act(() => result.current.step(1))
    expect(result.current.ply).toBeNull()
  })

  it('keeps the board on the real position for a row, and scrubs it for a token', () => {
    const { result, rerender } = setup({ hover: ROW })
    // Arrows, the default: the whole line drawn over the position the board is already on.
    expect(result.current.fen).toBeNull()
    expect(result.current.shapes.length).toBeGreaterThan(0)
    expect(result.current.line).toBe('live:1')

    rerender({ fen: START, hover: { ...ROW, ply: 1 }, prefs: LINE_PREVIEW_DEFAULTS })
    expect(result.current.fen).toBe(AFTER_E4)
    expect(result.current.lastMove).toEqual(['e2', 'e4'])
    expect(result.current.caption).toBe('after 1.e4')
  })

  it('dims the pieces only while the overlay stands on the whole line', () => {
    const overlay = prefs({ row: 'overlay' })
    const { result, rerender } = setup({ hover: ROW, prefs: overlay })
    expect(result.current.dim).toBe(true)

    // On a ply the board shows a real position again, and dimming it would lie about it.
    rerender({ fen: START, hover: { ...ROW, ply: 2 }, prefs: overlay })
    expect(result.current.dim).toBe(false)
  })

  it('plays the line out after the delay, one ply per tempo, and stops at the end', () => {
    const { result } = setup({ hover: ROW, prefs: PLAY })
    // Nothing has been played yet, so the board is the reader's own position.
    expect(result.current.ply).toBeNull()

    act(() => void vi.advanceTimersByTime(DELAY))
    expect(result.current.ply).toBe(0)
    act(() => void vi.advanceTimersByTime(TEMPO))
    expect(result.current.ply).toBe(1)
    expect(result.current.fen).toBe(AFTER_E4)

    act(() => void vi.advanceTimersByTime(TEMPO * 3))
    expect(result.current.ply).toBe(PV.length)
    // The end is where it stays: without the loop nothing is left to fire.
    act(() => void vi.advanceTimersByTime(TEMPO * 10))
    expect(result.current.ply).toBe(PV.length)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('holds the end of the line for a beat and plays it again when looping', () => {
    const { result } = setup({ hover: ROW, prefs: LOOPING })
    act(() => void vi.advanceTimersByTime(DELAY + TEMPO * PV.length))
    expect(result.current.ply).toBe(PV.length)

    act(() => void vi.advanceTimersByTime(TEMPO))
    expect(result.current.ply).toBe(PV.length)
    act(() => void vi.advanceTimersByTime(TEMPO))
    expect(result.current.ply).toBe(0)
    act(() => void vi.advanceTimersByTime(TEMPO))
    expect(result.current.ply).toBe(1)
  })

  it('lets a wheel take the line over from the playthrough, and stops it', () => {
    const { result } = setup({ hover: ROW, prefs: PLAY })
    act(() => void vi.advanceTimersByTime(DELAY + TEMPO * 2))
    expect(result.current.ply).toBe(2)

    act(() => result.current.step(1))
    expect(result.current.ply).toBe(3)
    // The timer is off, not merely outvoted: a deliberate act ends the animation.
    expect(vi.getTimerCount()).toBe(0)
    act(() => void vi.advanceTimersByTime(TEMPO * 10))
    expect(result.current.ply).toBe(3)

    // And it is clamped to the line it is walking.
    act(() => result.current.step(5))
    expect(result.current.ply).toBe(PV.length)
    act(() => result.current.step(-9))
    expect(result.current.ply).toBe(0)
  })

  it('steps from the token under the pointer rather than from the start of the line', () => {
    const { result } = setup({ hover: { ...ROW, ply: 2 } })
    act(() => result.current.step(1))
    expect(result.current.ply).toBe(3)
    expect(result.current.caption).toBe('after 2.Nf3')
  })

  it('drops the stepped ply when the engine rewrites the line under it', () => {
    const { result, rerender } = setup({ hover: ROW })
    act(() => result.current.step(2))
    expect(result.current.ply).toBe(2)

    // Same row, different moves: the ply counted into a line that no longer exists.
    const rewritten: HoveredLine = { line: 'live:1', ply: null, pv: ['d2d4', 'd7d5', 'c2c4'] }
    rerender({ fen: START, hover: rewritten, prefs: LINE_PREVIEW_DEFAULTS })
    expect(result.current.ply).toBeNull()
    expect(result.current.fen).toBeNull()

    // As does moving to another row, and leaving the lines altogether.
    act(() => result.current.step(1))
    expect(result.current.ply).toBe(1)
    rerender({ fen: START, hover: { ...rewritten, line: 'live:2' }, prefs: LINE_PREVIEW_DEFAULTS })
    expect(result.current.ply).toBeNull()
  })

  it('restarts the playthrough on the rewritten line rather than scrubbing the old one', () => {
    const { result, rerender } = setup({ hover: ROW, prefs: PLAY })
    act(() => void vi.advanceTimersByTime(DELAY + TEMPO * 2))
    expect(result.current.ply).toBe(2)

    rerender({ fen: START, hover: { ...ROW, pv: ['d2d4', 'd7d5', 'c2c4'] }, prefs: PLAY })
    expect(result.current.ply).toBeNull()
    act(() => void vi.advanceTimersByTime(DELAY + TEMPO))
    expect(result.current.ply).toBe(1)
  })

  it('leaves no timer running behind an unmounted preview', () => {
    const { unmount } = setup({ hover: ROW, prefs: LOOPING })
    act(() => void vi.advanceTimersByTime(DELAY + TEMPO))
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

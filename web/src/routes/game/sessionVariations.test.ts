import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  MAX_KEPT_VARIATIONS,
  isPrefix,
  keepVariation,
  resetSessionVariations,
  useSessionVariations,
} from './sessionVariations'

/** What is kept for a game, as `base:moves` strings — ids are noise for most of these. */
function shape(lines: { base: number; moves: string[] }[]): string[] {
  return lines.map((line) => `${line.base}:${line.moves.join(' ')}`)
}

function read(gameId: number) {
  const { result } = renderHook(() => useSessionVariations(gameId))
  return result.current.kept
}

beforeEach(() => {
  resetSessionVariations()
})

describe('sessionVariations', () => {
  it('keeps a line under its game', () => {
    keepVariation(7, 1, ['c7c6', 'd2d4'])
    expect(shape(read(7))).toEqual(['1:c7c6 d2d4'])
    expect(read(8)).toEqual([])
  })

  it('has nothing to keep about an empty line', () => {
    keepVariation(7, 1, [])
    expect(read(7)).toEqual([])
  })

  it('drops a line already kept whole', () => {
    keepVariation(7, 1, ['c7c6', 'd2d4'])
    const [first] = read(7)
    keepVariation(7, 1, ['c7c6', 'd2d4'])
    expect(shape(read(7))).toEqual(['1:c7c6 d2d4'])
    // The same line, not a second one wearing the same moves.
    expect(read(7)[0]!.id).toBe(first!.id)
  })

  it('drops a line that is only the head of one already kept', () => {
    keepVariation(7, 1, ['c7c6', 'd2d4', 'g8f6'])
    keepVariation(7, 1, ['c7c6'])
    expect(shape(read(7))).toEqual(['1:c7c6 d2d4 g8f6'])
  })

  it('replaces a kept line the new one continues, where it stands', () => {
    keepVariation(7, 1, ['c7c6'])
    keepVariation(7, 1, ['e7e5', 'g1f3'])
    keepVariation(7, 1, ['c7c6', 'd2d4'])
    // The longer walk takes the shorter one's place rather than stacking under itself, and
    // the line kept between the two keeps its own place in the stack.
    expect(shape(read(7))).toEqual(['1:c7c6 d2d4', '1:e7e5 g1f3'])
  })

  it('keeps lines off different positions apart, whatever their moves', () => {
    keepVariation(7, 1, ['e2e4'])
    keepVariation(7, 3, ['e2e4'])
    expect(shape(read(7))).toEqual(['1:e2e4', '3:e2e4'])
  })

  it('caps the list and drops the line walked longest ago', () => {
    for (let n = 0; n <= MAX_KEPT_VARIATIONS; n += 1) keepVariation(7, 0, [`m${n}`])
    const kept = read(7)
    expect(kept).toHaveLength(MAX_KEPT_VARIATIONS)
    expect(kept[0]!.moves).toEqual(['m1'])
    expect(kept.at(-1)!.moves).toEqual([`m${MAX_KEPT_VARIATIONS}`])
  })

  it('holds the line it was handed rather than the caller’s array', () => {
    const moves = ['c7c6']
    keepVariation(7, 1, moves)
    moves.push('d2d4')
    expect(read(7)[0]!.moves).toEqual(['c7c6'])
  })

  it('re-renders the hook when a line is kept, and outlives it', () => {
    const { result, unmount } = renderHook(() => useSessionVariations(7))
    expect(result.current.kept).toEqual([])

    act(() => result.current.keep(1, ['c7c6']))
    expect(shape(result.current.kept)).toEqual(['1:c7c6'])

    // The store is not the component's: navigating away and back finds the line still there.
    unmount()
    expect(shape(read(7))).toEqual(['1:c7c6'])
  })

  it('tells a head from a divergence', () => {
    expect(isPrefix(['a'], ['a', 'b'])).toBe(true)
    expect(isPrefix(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(isPrefix(['a', 'b'], ['a'])).toBe(false)
    expect(isPrefix(['b'], ['a', 'b'])).toBe(false)
    expect(isPrefix([], ['a'])).toBe(true)
  })
})

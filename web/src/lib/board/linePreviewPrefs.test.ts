import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LINE_PREVIEW_DEFAULTS } from './linePreview'
import {
  LINE_PREVIEW_KEY,
  resetLinePreviewPrefs,
  setLinePreviewPrefs,
  useLinePreviewPrefs,
} from './linePreviewPrefs'

/** jsdom in this setup exposes no `localStorage`, so the tests bring their own. */
function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, String(value)),
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  resetLinePreviewPrefs()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetLinePreviewPrefs()
})

describe('useLinePreviewPrefs', () => {
  it('starts at the defaults with nothing stored', () => {
    const { result } = renderHook(() => useLinePreviewPrefs())
    expect(result.current).toEqual(LINE_PREVIEW_DEFAULTS)
  })

  it('round-trips a patch through localStorage', () => {
    setLinePreviewPrefs({ row: 'overlay', depth: 10 })
    const { result } = renderHook(() => useLinePreviewPrefs())
    expect(result.current.row).toBe('overlay')
    expect(result.current.depth).toBe(10)
    // Everything else is untouched.
    expect(result.current.scrub).toBe(LINE_PREVIEW_DEFAULTS.scrub)

    const stored: unknown = JSON.parse(window.localStorage.getItem(LINE_PREVIEW_KEY)!)
    expect(stored).toMatchObject({ row: 'overlay', depth: 10 })
  })

  it('merges a nested play patch and keeps its sibling fields', () => {
    setLinePreviewPrefs({ play: { loop: true } })
    setLinePreviewPrefs({ play: { tempo: 900 } })
    const { result } = renderHook(() => useLinePreviewPrefs())
    expect(result.current.play).toEqual({
      ...LINE_PREVIEW_DEFAULTS.play,
      loop: true,
      tempo: 900,
    })
  })

  it('falls back to the defaults on garbage JSON', () => {
    window.localStorage.setItem(LINE_PREVIEW_KEY, 'not json')
    const { result } = renderHook(() => useLinePreviewPrefs())
    expect(result.current).toEqual(LINE_PREVIEW_DEFAULTS)
  })

  it('falls back to the defaults when the stored value is not an object', () => {
    window.localStorage.setItem(LINE_PREVIEW_KEY, JSON.stringify(['arrows']))
    const { result } = renderHook(() => useLinePreviewPrefs())
    expect(result.current).toEqual(LINE_PREVIEW_DEFAULTS)
  })

  it('falls back one bad field at a time, keeping the good fields around it', () => {
    window.localStorage.setItem(
      LINE_PREVIEW_KEY,
      JSON.stringify({ row: 'sideways', depth: 12, labels: 'ply', badges: 'yes' }),
    )
    const { result } = renderHook(() => useLinePreviewPrefs())
    expect(result.current.row).toBe(LINE_PREVIEW_DEFAULTS.row)
    expect(result.current.badges).toBe(LINE_PREVIEW_DEFAULTS.badges)
    // The valid fields around the bad ones survive.
    expect(result.current.depth).toBe(12)
    expect(result.current.labels).toBe('ply')
  })

  it('drops unknown keys', () => {
    window.localStorage.setItem(
      LINE_PREVIEW_KEY,
      JSON.stringify({ ...LINE_PREVIEW_DEFAULTS, glorp: true }),
    )
    const { result } = renderHook(() => useLinePreviewPrefs())
    expect(result.current).not.toHaveProperty('glorp')
  })

  it('clamps depth and lookahead into their ranges', () => {
    window.localStorage.setItem(
      LINE_PREVIEW_KEY,
      JSON.stringify({ depth: 999, lookahead: -3 }),
    )
    const { result } = renderHook(() => useLinePreviewPrefs())
    expect(result.current.depth).toBe(18)
    expect(result.current.lookahead).toBe(0)
  })

  it('clamps play.tempo and play.delay into their ranges', () => {
    setLinePreviewPrefs({ play: { tempo: 50, delay: 5000 } })
    const { result } = renderHook(() => useLinePreviewPrefs())
    expect(result.current.play.tempo).toBe(100)
    expect(result.current.play.delay).toBe(2000)
  })

  it('re-reads and notifies subscribers when another tab writes the key', () => {
    const { result } = renderHook(() => useLinePreviewPrefs())
    expect(result.current.row).toBe(LINE_PREVIEW_DEFAULTS.row)

    // Another tab writes directly to storage, then fires the `storage` event this tab
    // would receive (jsdom does not dispatch it across tabs for us).
    window.localStorage.setItem(
      LINE_PREVIEW_KEY,
      JSON.stringify({ ...LINE_PREVIEW_DEFAULTS, row: 'peek' }),
    )
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: LINE_PREVIEW_KEY }))
    })

    expect(result.current.row).toBe('peek')
  })

  it('ignores a storage event for an unrelated key', () => {
    const { result } = renderHook(() => useLinePreviewPrefs())
    act(() => setLinePreviewPrefs({ row: 'overlay' }))
    expect(result.current.row).toBe('overlay')

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'blunderbase.someOtherKey' }))
    })

    expect(result.current.row).toBe('overlay')
  })
})

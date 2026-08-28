import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MAIA_COMPARE_KEY,
  MAIA_ELO_KEY,
  resetMaiaPreferences,
  setMaiaCompare,
  setMaiaEloPick,
} from './maiaPreferences'

/** jsdom in this setup exposes no `localStorage`, so the test brings its own. */
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
  resetMaiaPreferences()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetMaiaPreferences()
})

describe('maiaPreferences', () => {
  it('remembers the level under the key the design names', () => {
    setMaiaEloPick(1700)
    expect(window.localStorage.getItem(MAIA_ELO_KEY)).toBe('1700')

    setMaiaCompare(true)
    expect(window.localStorage.getItem(MAIA_COMPARE_KEY)).toBe('true')
  })

  it('forgets the level rather than storing a nothing', () => {
    setMaiaEloPick(1700)
    setMaiaEloPick(null)
    expect(window.localStorage.getItem(MAIA_ELO_KEY)).toBeNull()
  })

  it('survives storage being unavailable', () => {
    vi.stubGlobal('localStorage', undefined)
    resetMaiaPreferences()
    // The pick still holds for the session; it simply is not written anywhere.
    expect(() => setMaiaEloPick(1500)).not.toThrow()
    expect(() => setMaiaCompare(true)).not.toThrow()
  })
})

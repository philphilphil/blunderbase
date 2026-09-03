import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  STREAM_ENGINE_KEY,
  readStreamEnginePick,
  writeStreamEnginePick,
} from './enginePreference'

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
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('enginePreference', () => {
  it('remembers the engine under the key the design names', () => {
    writeStreamEnginePick(7)
    expect(window.localStorage.getItem(STREAM_ENGINE_KEY)).toBe('7')
    expect(readStreamEnginePick()).toBe(7)
  })

  it('forgets the engine rather than storing a nothing', () => {
    writeStreamEnginePick(7)
    writeStreamEnginePick(null)
    expect(window.localStorage.getItem(STREAM_ENGINE_KEY)).toBeNull()
    expect(readStreamEnginePick()).toBeNull()
  })

  it('reads anything that is not an engine id as no pick', () => {
    window.localStorage.setItem(STREAM_ENGINE_KEY, 'deep')
    expect(readStreamEnginePick()).toBeNull()
    window.localStorage.setItem(STREAM_ENGINE_KEY, '0')
    expect(readStreamEnginePick()).toBeNull()
    window.localStorage.setItem(STREAM_ENGINE_KEY, '-3')
    expect(readStreamEnginePick()).toBeNull()
  })

  it('survives storage being unavailable', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(readStreamEnginePick()).toBeNull()
    expect(() => writeStreamEnginePick(7)).not.toThrow()
  })
})

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ENGINE_HIDDEN_KEY,
  resetEngineHidden,
  setEngineHidden,
  toggleEngineHidden,
  useEngineHidden,
} from './engineVisibility'

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
  resetEngineHidden()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetEngineHidden()
})

describe('useEngineHidden', () => {
  it('lets the engine speak with nothing stored', () => {
    const { result } = renderHook(() => useEngineHidden())
    expect(result.current).toBe(false)
  })

  it('round-trips through localStorage', () => {
    setEngineHidden(true)
    expect(window.localStorage.getItem(ENGINE_HIDDEN_KEY)).toBe('true')

    resetEngineHidden()
    const { result } = renderHook(() => useEngineHidden())
    expect(result.current).toBe(true)
  })

  it('tells every reader at once, without waiting for a re-render of its own', () => {
    const { result } = renderHook(() => useEngineHidden())
    act(() => {
      expect(toggleEngineHidden()).toBe(true)
    })
    expect(result.current).toBe(true)
    act(() => {
      expect(toggleEngineHidden()).toBe(false)
    })
    expect(result.current).toBe(false)
  })

  it('follows the other tab', () => {
    const { result } = renderHook(() => useEngineHidden())
    act(() => {
      window.localStorage.setItem(ENGINE_HIDDEN_KEY, 'true')
      window.dispatchEvent(new StorageEvent('storage', { key: ENGINE_HIDDEN_KEY }))
    })
    expect(result.current).toBe(true)
  })

  it('holds the mode for the session when storage refuses it', () => {
    vi.stubGlobal('localStorage', {
      ...memoryStorage(),
      setItem: () => {
        throw new Error('quota')
      },
    })
    resetEngineHidden()
    const { result } = renderHook(() => useEngineHidden())
    act(() => {
      setEngineHidden(true)
    })
    expect(result.current).toBe(true)
  })

  // Anything that is not the word the writer writes is not a mode somebody chose.
  it('ignores a hand-edited value', () => {
    window.localStorage.setItem(ENGINE_HIDDEN_KEY, 'yes')
    resetEngineHidden()
    const { result } = renderHook(() => useEngineHidden())
    expect(result.current).toBe(false)
  })
})

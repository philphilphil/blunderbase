import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MOBILE_QUERY, useIsMobile, useMediaQuery } from './media'

/**
 * A `matchMedia` that can be made to change its mind, which the real one does on a resize
 * or a rotation and jsdom's shared stub never does.
 */
function stubMatchMedia(matches: (query: string) => boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return matches(query)
    },
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener),
    dispatchEvent: vi.fn(),
  }))
  /** What the browser sends when the window crosses the breakpoint. */
  return (next: boolean) =>
    act(() => {
      for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent)
    })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useMediaQuery', () => {
  it('answers with the query’s current state on the first render', () => {
    stubMatchMedia((query) => query === MOBILE_QUERY)
    // No frame of the wrong layout to correct: the answer is there before the first paint.
    expect(renderHook(() => useIsMobile()).result.current).toBe(true)
    expect(renderHook(() => useMediaQuery('(min-width: 90rem)')).result.current).toBe(false)
  })

  it('follows the window across the breakpoint', () => {
    let wide = false
    const change = stubMatchMedia(() => !wide)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)

    wide = true
    change(false)
    expect(result.current).toBe(false)
  })

  it('drops its listener when the component goes', () => {
    const removeEventListener = vi.fn()
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener,
    }))
    renderHook(() => useIsMobile()).unmount()
    expect(removeEventListener).toHaveBeenCalledTimes(1)
  })

  it('reads as “does not match” where the browser has no matchMedia at all', () => {
    // Old jsdom, and anything rendering without a window: a missing API is not a crash.
    vi.stubGlobal('matchMedia', undefined)
    expect(renderHook(() => useIsMobile()).result.current).toBe(false)
  })
})

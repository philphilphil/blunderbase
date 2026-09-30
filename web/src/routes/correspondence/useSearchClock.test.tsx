import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSearchClock } from './useSearchClock'

describe('useSearchClock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads the time again when a search starts after the screen opened', () => {
    const { result, rerender } = renderHook(({ running }) => useSearchClock(running), {
      initialProps: { running: false },
    })
    const opened = result.current
    vi.setSystemTime(new Date('2026-09-30T12:05:00Z'))
    rerender({ running: true })
    expect(result.current - opened).toBe(5 * 60_000)
  })

  it('ticks every second while something runs', () => {
    const { result } = renderHook(() => useSearchClock(true))
    const start = result.current
    act(() => {
      vi.advanceTimersByTime(3_000)
    })
    expect(result.current - start).toBe(3_000)
  })

  it('stands still when nothing runs', () => {
    const { result } = renderHook(() => useSearchClock(false))
    const start = result.current
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(result.current).toBe(start)
  })
})

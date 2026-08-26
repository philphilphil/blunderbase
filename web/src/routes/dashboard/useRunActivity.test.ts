import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AnyEvent } from '@/lib/events/types'

import { useRunActivity } from './useRunActivity'

/** Every `useEventListener(topic, handler)` the hook registers, by topic. */
const listeners = vi.hoisted(() => new Map<string, (event: AnyEvent) => void>())
vi.mock('@/lib/events/EventsProvider', () => ({
  useEventListener: (topic: string, handler: (event: AnyEvent) => void) => {
    listeners.set(topic, handler)
  },
}))

function emit(event: AnyEvent) {
  const handler = listeners.get(event.event)
  if (!handler) throw new Error(`nothing is listening for ${event.event}`)
  act(() => handler(event))
}

describe('useRunActivity', () => {
  beforeEach(() => listeners.clear())

  it('starts with nothing, because the socket replays nothing', () => {
    const { result } = renderHook(() => useRunActivity())
    expect(result.current).toEqual([])
  })

  it('follows one run through its lifecycle without duplicating it', () => {
    const { result } = renderHook(() => useRunActivity())
    const base = {
      run_id: 7,
      game_id: 4,
      tier: 'deep' as const,
      status: 'queued' as const,
    }

    emit({ ...base, event: 'analysis.queued' })
    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toMatchObject({
      runId: 7,
      gameId: 4,
      tier: 'deep',
      status: 'queued',
    })

    emit({ ...base, event: 'analysis.running', status: 'running' })
    emit({
      ...base,
      event: 'analysis.progress',
      status: 'running',
      done: 30,
      total: 120,
    })
    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toMatchObject({
      status: 'running',
      progress: 25,
    })

    emit({ ...base, event: 'analysis.done', status: 'done', evals: 120 })
    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toMatchObject({ status: 'done', progress: 100 })
  })

  it('keeps a run being progressed at its last reported percentage', () => {
    const { result } = renderHook(() => useRunActivity())
    emit({
      event: 'analysis.progress',
      run_id: 3,
      game_id: 1,
      tier: 'quick',
      status: 'running',
      done: 5,
      total: 10,
    })
    emit({
      event: 'analysis.running',
      run_id: 3,
      game_id: 1,
      tier: 'quick',
      status: 'running',
    })
    expect(result.current[0].progress).toBe(50)
  })

  it('carries the reason a run failed', () => {
    const { result } = renderHook(() => useRunActivity())
    emit({
      event: 'analysis.failed',
      run_id: 9,
      game_id: 2,
      tier: 'quick',
      status: 'failed',
      error: 'engine exited',
    })
    expect(result.current[0]).toMatchObject({
      status: 'failed',
      error: 'engine exited',
    })
  })

  it('puts the most recently touched run first', () => {
    const { result } = renderHook(() => useRunActivity())
    emit({
      event: 'analysis.queued',
      run_id: 1,
      game_id: 1,
      tier: 'quick',
      status: 'queued',
    })
    emit({
      event: 'analysis.queued',
      run_id: 2,
      game_id: 2,
      tier: 'quick',
      status: 'queued',
    })
    emit({
      event: 'analysis.running',
      run_id: 1,
      game_id: 1,
      tier: 'quick',
      status: 'running',
    })
    expect(result.current.map((run) => run.runId)).toEqual([1, 2])
  })

  it('remembers the game of a run whose later events omit it', () => {
    const { result } = renderHook(() => useRunActivity())
    emit({
      event: 'analysis.queued',
      run_id: 5,
      game_id: 12,
      tier: 'quick',
      status: 'queued',
    })
    emit({
      event: 'analysis.progress',
      run_id: 5,
      game_id: null,
      tier: 'quick',
      status: 'running',
      done: 1,
      total: 4,
    })
    expect(result.current[0].gameId).toBe(12)
  })

  it('ignores a frame that is not an analysis run', () => {
    const { result } = renderHook(() => useRunActivity())
    const handler = listeners.get('analysis.done')
    act(() => handler?.({ event: 'analysis.done' } as AnyEvent))
    expect(result.current).toEqual([])
  })
})

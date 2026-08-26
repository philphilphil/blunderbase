import { describe, expect, it } from 'vitest'

import type { RunnerResponse } from '@/lib/api/types'

import { canStream, slotLabel, slotShares, statusLabel } from './runners'

function runner(over: Partial<RunnerResponse> = {}): RunnerResponse {
  return {
    id: 3,
    name: 'gpu-box',
    slots: 4,
    version: '0.1.0',
    connected: true,
    transport: 'websocket',
    last_seen_at: null,
    created_at: null,
    busy: 0,
    streams: 0,
    free_slots: 4,
    queued_eligible: 0,
    engines: [],
    ...over,
  }
}

describe('statusLabel', () => {
  it('names the transport of a live link', () => {
    expect(statusLabel(runner())).toEqual({ label: 'connected · websocket', tone: 'connected' })
  })

  it('says a polling link is connected and still queue only', () => {
    expect(statusLabel(runner({ transport: 'poll' }))).toEqual({
      label: 'connected · polling — queue only',
      tone: 'degraded',
    })
  })

  it('reports a machine that has not dialled in', () => {
    expect(statusLabel(runner({ connected: false, transport: null }))).toEqual({
      label: 'not connected',
      tone: 'away',
    })
  })
})

describe('slotLabel', () => {
  it('counts queue runs and analysis boards against the same cap', () => {
    expect(slotLabel(runner({ busy: 2, streams: 1 }))).toBe('3/4 slots')
  })
})

describe('slotShares', () => {
  it('splits the bar into busy, streaming and free', () => {
    expect(slotShares(runner({ slots: 4, busy: 2, streams: 1 }))).toEqual({
      busy: 50,
      streams: 25,
      free: 25,
    })
  })

  it('never draws past the end when a lowered cap is still over-subscribed', () => {
    const shares = slotShares(runner({ slots: 1, busy: 2, streams: 1 }))
    expect(shares.busy + shares.streams + shares.free).toBeCloseTo(100)
    expect(shares.free).toBe(0)
  })

  it('survives a runner with no slots at all', () => {
    expect(slotShares(runner({ slots: 0, busy: 0, streams: 0 })).free).toBe(100)
  })
})

describe('canStream', () => {
  it('needs a connected websocket link', () => {
    expect(canStream(runner())).toBe(true)
    expect(canStream(runner({ transport: 'poll' }))).toBe(false)
    expect(canStream(runner({ connected: false, transport: null }))).toBe(false)
  })
})

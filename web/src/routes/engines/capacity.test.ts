import { describe, expect, it } from 'vitest'

import type { EngineResponse } from '@/lib/api/types'

import { budgetShares, engineHashMb, engineThreads, hostBudget } from './capacity'
import type { EngineRoles } from './roles'

function engine(over: Partial<EngineResponse> & { id: number }): EngineResponse {
  return {
    name: `engine-${over.id}`,
    kind: 'uci',
    path: '/usr/games/stockfish',
    options: {},
    enabled: true,
    created_at: '2026-09-12T00:00:00Z',
    ...over,
  }
}

describe('engineThreads', () => {
  it('reads Threads whether the row stores a number or a string', () => {
    expect(engineThreads(engine({ id: 1, options: { Threads: 4 } }))).toBe(4)
    expect(engineThreads(engine({ id: 1, options: { Threads: '6' } }))).toBe(6)
  })

  it('is one thread when nothing sets it, which is what the engine itself does', () => {
    expect(engineThreads(engine({ id: 1 }))).toBe(1)
    expect(engineThreads(engine({ id: 1, options: { Threads: 'lots' } }))).toBe(1)
  })

  it('has no opinion about Hash when the row does not set it', () => {
    expect(engineHashMb(engine({ id: 1 }))).toBeNull()
    expect(engineHashMb(engine({ id: 1, options: { Hash: 8192 } }))).toBe(8192)
  })
})

describe('hostBudget', () => {
  const roles = new Map<number, EngineRoles>([
    [1, ['quick']],
    [2, ['deep']],
  ])
  const engines = [
    engine({ id: 1, options: { Threads: 2 } }),
    engine({ id: 2, options: { Threads: 3 } }),
    // Holds no role, so the queue never runs it — but a search may, so it prices those.
    engine({ id: 3, options: { Threads: 4 } }),
    engine({ id: 4, kind: 'maia', options: { Threads: 32 } }),
  ]

  it('adds the two caps rather than sharing them, each at its own thread cost', () => {
    const budget = hostBudget({
      cores: 8,
      queueProcesses: 2,
      searchSlots: 1,
      correspondenceOn: true,
      engines,
      roles,
    })
    // Queue: two processes of the heaviest tier engine (3). Searches: one of the heaviest
    // search engine on the host (4). A Maia's threads are never a search's.
    expect(budget.queue).toEqual({ processes: 2, threads: 3 })
    expect(budget.searches).toEqual({ processes: 1, threads: 4 })
    expect(budget.total).toBe(10)
    expect(budget.over).toBe(true)
  })

  it('counts no searches while correspondence mode is off', () => {
    const budget = hostBudget({
      cores: 8,
      queueProcesses: 2,
      searchSlots: 2,
      correspondenceOn: false,
      engines,
      roles,
    })
    expect(budget.searches).toBeNull()
    expect(budget.total).toBe(6)
    expect(budget.over).toBe(false)
  })

  it('never claims an overrun when it does not know the cores', () => {
    const budget = hostBudget({
      cores: null,
      queueProcesses: 64,
      searchSlots: 16,
      correspondenceOn: true,
      engines,
      roles,
    })
    expect(budget.cores).toBeNull()
    expect(budget.over).toBe(false)
  })

  it('prices the queue at the heaviest search engine when no tier is assigned here', () => {
    const budget = hostBudget({
      cores: 8,
      queueProcesses: 1,
      searchSlots: 1,
      correspondenceOn: true,
      engines,
      roles: new Map(),
    })
    expect(budget.queue.threads).toBe(4)
  })

  it('draws the overrun as its own share of the meter', () => {
    const shares = budgetShares(
      hostBudget({
        cores: 8,
        queueProcesses: 2,
        searchSlots: 1,
        correspondenceOn: true,
        engines,
        roles,
      }),
    )
    // Ten threads on eight cores: six for the queue, two of the search's four fit, two over.
    expect(shares.queue).toBeCloseTo(60)
    expect(shares.searches).toBeCloseTo(20)
    expect(shares.over).toBeCloseTo(20)
  })
})

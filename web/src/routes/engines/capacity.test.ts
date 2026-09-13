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

  it('prices every slot at the heaviest engine a search could hold while the mode is on', () => {
    const budget = hostBudget({
      cores: 8,
      processes: 3,
      correspondenceOn: true,
      engines,
      roles,
    })
    // Any of the three slots may be holding the four-thread search engine; a Maia's threads
    // are never a search's.
    expect(budget).toMatchObject({ processes: 3, threads: 4, total: 12, over: true })
  })

  it('prices only the tier engines while correspondence mode is off', () => {
    const budget = hostBudget({
      cores: 8,
      processes: 2,
      correspondenceOn: false,
      engines,
      roles,
    })
    // The heaviest engine holding Quick or Deep (3); the four-thread row never runs here.
    expect(budget).toMatchObject({ processes: 2, threads: 3, total: 6, over: false })
  })

  it('never claims an overrun when it does not know the cores', () => {
    const budget = hostBudget({
      cores: null,
      processes: 64,
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
      processes: 1,
      correspondenceOn: false,
      engines,
      roles: new Map(),
    })
    expect(budget.threads).toBe(4)
  })

  it('draws the overrun as its own share of the meter', () => {
    const shares = budgetShares(
      hostBudget({
        cores: 8,
        processes: 3,
        correspondenceOn: true,
        engines,
        roles,
      }),
    )
    // Twelve threads on eight cores: eight fit, four over, on a scale of twelve.
    expect(shares.used).toBeCloseTo((8 / 12) * 100)
    expect(shares.over).toBeCloseTo((4 / 12) * 100)
  })
})

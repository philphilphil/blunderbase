import { describe, expect, it } from 'vitest'

import { decodePlan, hello, ProtocolError } from './protocol'

/** `encode_plan`'s output for a one-position run, as a server of this version writes it. */
function wire(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    run_id: 5,
    tier: 'quick',
    game_id: null,
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    variant: 'standard',
    initial_fen: null,
    moves_uci: [],
    moves_san: [],
    position_ids: [null],
    ply_start: 0,
    ply_end: 0,
    nodes: 1000,
    depth: null,
    seconds: null,
    multipv: 2,
    thresholds: { inaccuracy: 5, mistake: 10, blunder: 20 },
    owner_color: null,
    owner_rating: null,
    maia_target_elo: 1700,
    maia_elos: [1700],
    maia_only: false,
    maia: false,
    maia_both_sides: true,
    ...extra,
  }
}

describe('decodePlan', () => {
  it('reads whichever stop condition the run carries and ignores the legacy tier', () => {
    expect(decodePlan(wire())).toMatchObject({ nodes: 1000, depth: null, seconds: null })
    expect(decodePlan(wire({ nodes: null, depth: 24 }))).toMatchObject({ nodes: null, depth: 24 })
    expect(decodePlan(wire({ nodes: null, seconds: 2.5, tier: 'deep' }))).toMatchObject({
      nodes: null,
      seconds: 2.5,
    })
    expect(decodePlan(wire())).not.toHaveProperty('tier')
  })

  it('refuses a plan with no stop condition, since a bare go never answers', () => {
    expect(() => decodePlan(wire({ nodes: null }))).toThrow(ProtocolError)
  })
})

describe('hello', () => {
  it('announces run limits and practice moves, so the gateway sends this tab both', () => {
    const frame = hello({ runner: 'tab', version: null, slots: 1, engines: [], activeRuns: [] })
    expect(frame.features).toEqual(['run_limits', 'play_move'])
  })
})

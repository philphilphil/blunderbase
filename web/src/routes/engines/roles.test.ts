import { describe, expect, it } from 'vitest'

import type { EngineRoleStatus, EngineRolesResponse } from '@/lib/api/types'

import { NO_ROLE_LABEL, NO_ROLES, engineRoles, roleLabel } from './roles'

function status(over: Partial<EngineRoleStatus> & { role: EngineRoleStatus['role'] }): EngineRoleStatus {
  return {
    engine_id: null,
    engine_name: null,
    available: false,
    configured: false,
    reason: null,
    ...over,
  }
}

function roles(...statuses: EngineRoleStatus[]): EngineRolesResponse {
  return { roles: statuses }
}

describe('roleLabel', () => {
  it('names both tiers when one engine holds both', () => {
    expect(roleLabel(['quick', 'deep'])).toBe('Quick + Deep')
    // Order on the wire must not change the words.
    expect(roleLabel(['deep', 'quick'])).toBe('Quick + Deep')
  })

  it('names one role, or a visible nothing', () => {
    expect(roleLabel(['deep'])).toBe('Deep')
    expect(roleLabel(['quick'])).toBe('Quick')
    expect(roleLabel(['human'])).toBe('Human moves')
    expect(roleLabel(NO_ROLES)).toBe(NO_ROLE_LABEL)
    expect(NO_ROLE_LABEL).toBe('—')
  })
})

describe('engineRoles', () => {
  it('gives one engine every role it was assigned to', () => {
    const map = engineRoles(
      roles(
        status({ role: 'quick', engine_id: 1, engine_name: 'stockfish', available: true, configured: true }),
        status({ role: 'deep', engine_id: 1, engine_name: 'stockfish', available: true, configured: true }),
        status({ role: 'human', engine_id: 2, engine_name: 'maia3', available: true, configured: true }),
      ),
    )

    expect(roleLabel(map.get(1) ?? NO_ROLES)).toBe('Quick + Deep')
    expect(roleLabel(map.get(2) ?? NO_ROLES)).toBe('Human moves')
  })

  it('leaves an engine nobody assigned out of the map', () => {
    const map = engineRoles(
      roles(status({ role: 'quick', engine_id: 1, engine_name: 'stockfish', available: true, configured: true })),
    )

    expect(map.get(4)).toBeUndefined()
    expect(roleLabel(map.get(4) ?? NO_ROLES)).toBe(NO_ROLE_LABEL)
  })

  it('keeps the role of an engine that cannot run it — a role is not availability', () => {
    const map = engineRoles(
      roles(
        status({
          role: 'deep',
          engine_id: 3,
          engine_name: 'sf-remote',
          configured: true,
          reason: "'sf-remote' runs on 'gpu-box', which is not connected",
        }),
      ),
    )

    expect(roleLabel(map.get(3) ?? NO_ROLES)).toBe('Deep')
  })

  it('maps nothing before the read has landed, and nothing for an empty role', () => {
    expect(engineRoles(undefined).size).toBe(0)
    expect(engineRoles(roles(status({ role: 'human' }))).size).toBe(0)
  })
})

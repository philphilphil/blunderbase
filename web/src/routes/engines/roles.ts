/**
 * Which roles each engine holds, keyed by engine id.
 *
 * There is nothing to infer any more. This file used to *derive* a role: `default_tier` was
 * a preference the backend was free to fall back away from, so a row that read its own tag
 * showed nothing while doing all the work, and the human-move half was guessed from "the
 * first enabled Maia per host" because no endpoint answered for a runner's model. Both are
 * gone. A role is now three engine ids the owner chose, `/engines/roles` says which, and
 * nothing falls back — so the map below is a transcription of that answer and never a
 * second opinion about it.
 *
 * The labels live here rather than in the badge because the roster, the detail card and the
 * roles form all name the same three jobs, and three spellings of "Human moves" is how the
 * page stops agreeing with itself.
 */
import { ENGINE_ROLES, type EngineRoleName, type EngineRolesResponse } from '@/lib/api/types'

/** The roles one engine holds. Empty for an engine the owner has assigned to nothing. */
export type EngineRoles = readonly EngineRoleName[]

/** An engine that is the pick for nothing. */
export const NO_ROLES: EngineRoles = []

/**
 * A visible nothing rather than a blank cell. An empty column reads as a rendering bug or
 * as a value still loading; an em dash is a statement that this engine serves nothing.
 */
export const NO_ROLE_LABEL = '—'

/** One role in the words the whole Engines page uses for it. */
export function roleName(role: EngineRoleName): string {
  if (role === 'quick') return 'Quick'
  if (role === 'deep') return 'Deep'
  return 'Human moves'
}

/**
 * The roles in words — `Quick + Deep`, `Deep`, `Human moves`, or an em dash.
 *
 * Written in `ENGINE_ROLES` order rather than the order they arrived in, so the wire cannot
 * change the words.
 */
export function roleLabel(roles: EngineRoles): string {
  const held = ENGINE_ROLES.filter((role) => roles.includes(role))
  if (held.length === 0) return NO_ROLE_LABEL
  return held.map(roleName).join(' + ')
}

/**
 * Every assigned engine's roles, keyed by engine id.
 *
 * An engine that holds no role is absent rather than empty — callers reach for `NO_ROLES`,
 * which is also what an id the assignment does not mention gets. A role whose engine has
 * been deleted still carries its id here: the assignment is what is stored, and availability
 * is a separate question `EngineRoleStatus.available` answers.
 */
export function engineRoles(roles: EngineRolesResponse | undefined): Map<number, EngineRoles> {
  const byId = new Map<number, EngineRoleName[]>()
  for (const status of roles?.roles ?? []) {
    if (status.engine_id == null) continue
    const held = byId.get(status.engine_id)
    if (held) held.push(status.role)
    else byId.set(status.engine_id, [status.role])
  }
  return byId
}

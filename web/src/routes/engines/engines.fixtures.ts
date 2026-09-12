/**
 * What the Engines and Machines page tests stand on: a fetch stub keyed by path, and the
 * rows the two pages read — engines, roles, runners and this host.
 *
 * Shared because the two pages read the same four endpoints and a fixture that drifted
 * between their test files would be a runner described two ways. Not a test file itself:
 * vitest only collects `*.test.*`.
 */
import { vi } from 'vitest'

import type {
  AppSettings,
  EngineResponse,
  EngineRoleName,
  EngineRolesResponse,
  EngineRoleStatus,
  LocalHost,
  RunnerEngine,
  RunnerResponse,
  RunnersStatus,
} from '@/lib/api/types'

/** jsdom in this setup exposes no `localStorage`, so the tests bring their own (see
 *  `games/savedFilters.test.ts`). */
export function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  }
}

export class FakeSocket {
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  readonly url: string
  constructor(url: string) {
    this.url = url
  }
  close() {}
}

type Route = unknown | { status: number; body: unknown }

/**
 * Releases the routes a case asked to defer. Two reads answering in the same tick is what
 * hides a race between them, so a case that is about one can hold the other open.
 */
export let release: () => void = () => {}

export function resetRelease() {
  release = () => {}
}

/**
 * Returns the mock so a case can assert on what was *not* asked for.
 *
 * A route may be keyed by path, or by `"<METHOD> <path>"` when a case needs the write to
 * answer differently from the read — `/engines/roles` is both a read and a write, and a
 * refused assignment is only a refusal of the PUT.
 */
export function stubFetch(routes: Record<string, Route>, defer: string[] = []) {
  const held = new Promise<void>((resolve) => {
    release = () => resolve()
  })
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).split('?')[0]!
    if (defer.includes(path)) await held
    const route = routes[`${(init?.method ?? 'GET').toUpperCase()} ${path}`] ?? routes[path]
    if (route === undefined) {
      return new Response(JSON.stringify({ error: 'not_found', detail: path }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    }
    const shaped =
      route !== null && typeof route === 'object' && 'status' in route
        ? (route as { status: number; body: unknown })
        : { status: 200, body: route }
    return new Response(JSON.stringify(shaped.body), {
      status: shaped.status,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

export function requestedPaths(fetchMock: ReturnType<typeof stubFetch>): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input).split('?')[0]!)
}

export const STOCKFISH: EngineResponse = {
  id: 1,
  name: 'stockfish',
  kind: 'uci',
  path: '/opt/homebrew/bin/stockfish',
  version: 'Stockfish 18',
  options: {},
  enabled: true,
  created_at: '2026-08-26T00:50:11Z',
}

export const MAIA: EngineResponse = {
  id: 2,
  name: 'maia3',
  kind: 'maia',
  path: '/models/maia-1500.pb.gz',
  version: 'lc0 maia-1500',
  options: {},
  enabled: true,
  created_at: '2026-08-26T00:51:00Z',
}

/** One role status, defaulted to the shape of a role nobody has assigned anything to. */
export function role(
  over: Partial<EngineRoleStatus> & { role: EngineRoleName },
): EngineRoleStatus {
  return {
    engine_id: null,
    engine_name: null,
    available: false,
    configured: false,
    reason: `no engine is assigned to ${over.role === 'human' ? 'human moves' : `the ${over.role} tier`}`,
    ...over,
  }
}

/** Quick on `stockfish`, Deep on an engine that is away, and no human-move model at all. */
export function roles(...over: EngineRoleStatus[]): EngineRolesResponse {
  const base = new Map<EngineRoleName, EngineRoleStatus>([
    [
      'quick',
      role({
        role: 'quick',
        engine_id: 1,
        engine_name: 'stockfish',
        available: true,
        configured: true,
        reason: null,
      }),
    ],
    [
      'deep',
      role({
        role: 'deep',
        engine_id: 7,
        engine_name: 'sf-remote',
        configured: true,
        reason: "'sf-remote' runs on 'gpu-box', which is not connected",
      }),
    ],
    ['human', role({ role: 'human' })],
  ])
  for (const status of over) base.set(status.role, status)
  return { roles: [...base.values()] }
}

export const ROLES = roles()

export function remoteEngine(
  over: Partial<RunnerEngine> & { id: number; name: string },
): RunnerEngine {
  return {
    kind: 'uci',
    version: 'Stockfish 17',
    path: '/usr/games/stockfish',
    enabled: true,
    streams: true,
    ...over,
  }
}

export function runner(
  over: Partial<RunnerResponse> & { id: number; name: string },
): RunnerResponse {
  return {
    slots: 4,
    version: '0.1.0',
    connected: true,
    transport: 'websocket',
    last_seen_at: '2026-08-26T10:00:00Z',
    created_at: '2026-08-26T09:00:00Z',
    busy: 2,
    streams: 0,
    free_slots: 2,
    queued_eligible: 78,
    engines: [],
    ...over,
  }
}

/** This host: six queue processes in force on eight cores, nothing set anywhere. */
export function localHost(over: Partial<LocalHost> = {}): LocalHost {
  return {
    name: 'local',
    slots: 6,
    slots_source: 'default',
    slots_configured: 6,
    cores: 8,
    busy: 0,
    streams: 0,
    workers: true,
    queued: 0,
    running: 0,
    engines: [remoteEngine({ id: 1, name: 'stockfish', path: STOCKFISH.path })],
    ...over,
  }
}

export function runnersStatus(
  runners: RunnerResponse[] = [],
  local: Partial<LocalHost> = {},
): RunnersStatus {
  return {
    runners,
    local: localHost(local),
    queue: { queued: 0, running: 0 },
  }
}

/** The one advertised by `gpu-box`; its id is what joins it to `/engines`. */
export const SF_REMOTE: EngineResponse = {
  id: 7,
  name: 'sf-remote',
  kind: 'uci',
  path: '/usr/games/stockfish',
  version: 'Stockfish 17',
  options: {},
  enabled: true,
  created_at: '2026-08-26T09:30:00Z',
}

export const PROBE = {
  name: 'Stockfish 18',
  author: 'the Stockfish developers (see AUTHORS file)',
  options: [
    { name: 'Threads', type: 'spin', default: 1, min: 1, max: 1024, var: [], managed: false },
    { name: 'MultiPV', type: 'spin', default: 1, min: 1, max: 256, var: [], managed: true },
  ],
}

/** A deployment that has set nothing but switched correspondence mode on. */
export const SETTINGS: AppSettings = {
  maia_target_elo: 2000,
  maia_elos: [2000],
  maia_on_quick: null,
  maia_on_deep: null,
  maia_both_sides: null,
  quick_nodes: null,
  deep_nodes: null,
  deep_multipv: null,
  inaccuracy_threshold: null,
  mistake_threshold: null,
  blunder_threshold: null,
  correspondence_enabled: 1,
  correspondence_multipv: null,
  correspondence_slots: null,
  analysis_concurrency: null,
  correspondence_task_nodes: null,
  correspondence_task_multipv: null,
  correspondence_stale_depth: null,
}

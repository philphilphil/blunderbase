import { describe, expect, it } from 'vitest'

import type { RunnerEngine, RunnerResponse, RunnersStatus } from '@/lib/api/types'

import { engineHosts, hostByEngineId, isRemote } from './hosts'

function engine(over: Partial<RunnerEngine> & { id: number; name: string }): RunnerEngine {
  return {
    kind: 'uci',
    version: null,
    path: '/usr/games/stockfish',
    path_scheme: null,
    enabled: true,
    streams: true,
    ...over,
  }
}

function runner(over: Partial<RunnerResponse> & { id: number; name: string }): RunnerResponse {
  return {
    slots: 4,
    version: '0.1.0',
    connected: true,
    browser: false,
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

function status(over: Partial<RunnersStatus> = {}): RunnersStatus {
  return {
    runners: [],
    local: {
      name: 'local',
      slots: 6,
      busy: 0,
      streams: 0,
      workers: true,
      queued: 0,
      running: 0,
      engines: [],
    },
    queue: { queued: 0, running: 0 },
    ...over,
  }
}

describe('engineHosts', () => {
  it('reports a local engine as this host, connected and streamable', () => {
    const [host] = engineHosts(
      status({
        local: {
          ...status().local,
          engines: [engine({ id: 1, name: 'stockfish' })],
        },
      }),
    )
    expect(host).toMatchObject({
      engineId: 1,
      runnerId: null,
      runnerName: null,
      connected: true,
      transport: null,
      streams: true,
      streamsReason: null,
      // A local engine is a file on this machine, and this machine is not a browser tab.
      pathScheme: null,
      browser: false,
    })
    expect(isRemote(host)).toBe(false)
  })

  it('binds a runner engine to its machine', () => {
    const [host] = engineHosts(
      status({
        runners: [
          runner({ id: 3, name: 'gpu-box', engines: [engine({ id: 7, name: 'sf-remote' })] }),
        ],
      }),
    )
    expect(host).toMatchObject({
      engineId: 7,
      runnerId: 3,
      runnerName: 'gpu-box',
      transport: 'websocket',
      streams: true,
    })
    expect(isRemote(host)).toBe(true)
  })

  it('carries the browser flag and the wasm scheme through from a tab', () => {
    const [host] = engineHosts(
      status({
        runners: [
          runner({
            id: 5,
            name: 'this browser',
            browser: true,
            engines: [
              engine({
                id: 9,
                name: 'stockfish-18',
                path: 'wasm:stockfish-18',
                path_scheme: 'wasm',
              }),
            ],
          }),
        ],
      }),
    )
    expect(host).toMatchObject({
      engineId: 9,
      path: 'wasm:stockfish-18',
      pathScheme: 'wasm',
      browser: true,
      streams: true,
    })
  })

  it('is queue only on a poll-mode runner, in the words the 409 uses', () => {
    const [host] = engineHosts(
      status({
        runners: [
          runner({
            id: 3,
            name: 'gpu-box',
            transport: 'poll',
            engines: [engine({ id: 7, name: 'sf-remote' })],
          }),
        ],
      }),
    )
    expect(host!.streams).toBe(false)
    expect(host!.streamsReason).toBe('queue only — gpu-box is connected over polling')
  })

  it('says which machine is away when the runner is not connected', () => {
    const [host] = engineHosts(
      status({
        runners: [
          runner({
            id: 3,
            name: 'gpu-box',
            connected: false,
            transport: null,
            engines: [engine({ id: 7, name: 'sf-remote' })],
          }),
        ],
      }),
    )
    expect(host!.streams).toBe(false)
    expect(host!.streamsReason).toBe('gpu-box is not connected')
  })

  it('never streams a Maia, wherever it lives', () => {
    const [host] = engineHosts(
      status({
        local: {
          ...status().local,
          engines: [engine({ id: 2, name: 'maia-1500', kind: 'maia', streams: false })],
        },
      }),
    )
    expect(host!.streams).toBe(false)
    expect(host!.streamsReason).toBe('answers with a policy rather than a search')
  })

  it('names the host, not the kind, when a runner advertised no streams', () => {
    // The bug this replaced: `streams` was inferred from `kind == "uci"`, so a runner that
    // honestly said `streams: false` was listed in the picker and then answered nothing.
    // A search engine that will not stream needs a different reason from a Maia, because
    // the way out is a different engine rather than nothing at all.
    const [host] = engineHosts(
      status({
        runners: [
          runner({
            id: 5,
            name: 'this browser',
            browser: true,
            engines: [
              engine({
                id: 9,
                name: 'Stockfish (this browser)',
                path: 'wasm:stockfish-18',
                path_scheme: 'wasm',
                streams: false,
              }),
            ],
          }),
        ],
      }),
    )
    expect(host!.streams).toBe(false)
    expect(host!.streamsReason).toBe(
      'this browser runs queued analysis on it but no analysis board — pick another engine',
    )
  })

  it('says so plainly when a local engine will not drive a board', () => {
    const [host] = engineHosts(
      status({
        local: {
          ...status().local,
          engines: [engine({ id: 1, name: 'stockfish', streams: false })],
        },
      }),
    )
    expect(host!.streams).toBe(false)
    expect(host!.streamsReason).toBe('this host does not run analysis boards on it')
  })

  it('will not drive a board with an engine that is switched off', () => {
    const [host] = engineHosts(
      status({
        local: {
          ...status().local,
          engines: [engine({ id: 1, name: 'stockfish', enabled: false })],
        },
      }),
    )
    expect(host!.streams).toBe(false)
    expect(host!.streamsReason).toBe('switched off')
  })

  it('orders local first, then runners, and by name within a host', () => {
    // Not by role: which engine serves Quick or Deep is an assignment the owner makes, and
    // a list that re-sorted itself when they changed it would move rows under the cursor.
    const hosts = engineHosts(
      status({
        local: {
          ...status().local,
          engines: [
            engine({ id: 1, name: 'sf-quick' }),
            engine({ id: 2, name: 'sf-deep' }),
            engine({ id: 3, name: 'maia', kind: 'maia', streams: false }),
          ],
        },
        runners: [
          runner({ id: 3, name: 'gpu-box', engines: [engine({ id: 7, name: 'sf-remote' })] }),
        ],
      }),
    )
    expect(hosts.map((host) => host.name)).toEqual(['maia', 'sf-deep', 'sf-quick', 'sf-remote'])
  })

  it('is empty before the status has been read', () => {
    expect(engineHosts(undefined)).toEqual([])
    expect(hostByEngineId(undefined).size).toBe(0)
  })
})

describe('hostByEngineId', () => {
  it('keys the bindings by the id `/engines` reports', () => {
    const map = hostByEngineId(
      status({
        local: { ...status().local, engines: [engine({ id: 1, name: 'stockfish' })] },
        runners: [
          runner({ id: 3, name: 'gpu-box', engines: [engine({ id: 7, name: 'sf-remote' })] }),
        ],
      }),
    )
    expect(map.get(1)?.runnerId).toBeNull()
    expect(map.get(7)?.runnerName).toBe('gpu-box')
    expect(map.get(99)).toBeUndefined()
    expect(isRemote(map.get(99))).toBe(false)
  })
})

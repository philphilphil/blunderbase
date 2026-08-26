import { describe, expect, it } from 'vitest'

import type { RunnerEngine, RunnerResponse, RunnersStatus } from '@/lib/api/types'

import { engineHosts, hostByEngineId, isRemote } from './hosts'

function engine(over: Partial<RunnerEngine> & { id: number; name: string }): RunnerEngine {
  return {
    kind: 'uci',
    version: null,
    path: '/usr/games/stockfish',
    enabled: true,
    default_tier: null,
    streams: true,
    ...over,
  }
}

function runner(over: Partial<RunnerResponse> & { id: number; name: string }): RunnerResponse {
  return {
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
          engines: [engine({ id: 1, name: 'stockfish', default_tier: 'deep' })],
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

  it('orders local first, then runners, deep before quick before untiered', () => {
    const hosts = engineHosts(
      status({
        local: {
          ...status().local,
          engines: [
            engine({ id: 1, name: 'sf-quick', default_tier: 'quick' }),
            engine({ id: 2, name: 'sf-deep', default_tier: 'deep' }),
            engine({ id: 3, name: 'maia', kind: 'maia', streams: false }),
          ],
        },
        runners: [
          runner({ id: 3, name: 'gpu-box', engines: [engine({ id: 7, name: 'sf-remote' })] }),
        ],
      }),
    )
    expect(hosts.map((host) => host.name)).toEqual(['sf-deep', 'sf-quick', 'maia', 'sf-remote'])
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

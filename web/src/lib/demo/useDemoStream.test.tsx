/**
 * The demo's analysis board. It answers the same `StreamSessionApi` the server-backed hook
 * does, so the panel above it cannot tell the difference — which is the whole point, and
 * the two things worth pinning down: the refusal a panel turns into the setup dialog, and
 * the rule that a frame is only ever shown for the position it was searched on.
 */
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/api/client'
import type { InfiniteSearchOptions } from '@/lib/runner/engine'

import { useDemoStream } from './useDemoStream'

const fake = vi.hoisted(() => ({
  ready: false,
  searchInfinite: vi.fn(),
  stopSearch: vi.fn(),
  release: vi.fn(),
}))

vi.mock('./analysis', () => ({
  DEMO_ENGINE_ID: -1,
  useDemoAnalysis: () => ({ ready: fake.ready }),
  demoAnalysis: {
    getSnapshot: () => ({ ready: fake.ready }),
    begin: () => ({
      engine: { version: 'Stockfish 18', searchInfinite: fake.searchInfinite },
      signal: new AbortController().signal,
      cancel: fake.stopSearch,
      release: fake.release,
    }),
  },
}))

/** After 1.e4 c5 2.Nf3 — Black to move. */
const SICILIAN = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2'

let api: ReturnType<typeof useDemoStream>

function Harness({ fen }: { fen: string | null }) {
  api = useDemoStream({ surface: 'game', fen, gameId: 12, ply: 3 })
  return <span>{api.phase}</span>
}

beforeEach(() => {
  vi.clearAllMocks()
  fake.ready = false
  fake.searchInfinite.mockResolvedValue(true)
})

describe('useDemoStream', () => {
  it('refuses to switch on before Stockfish is in the tab, in the panel’s own language', () => {
    render(<Harness fen={SICILIAN} />)
    act(() => api.setEnabled(true))

    expect(api.enabled).toBe(false)
    expect(api.error).toBeInstanceOf(ApiError)
    expect((api.error as ApiError).error).toBe('browser_engine_missing')
    expect(fake.searchInfinite).not.toHaveBeenCalled()
    expect(screen.getByText('error')).toBeInTheDocument()
  })

  it('offers the tab as the only engine once it is installed', () => {
    fake.ready = true
    render(<Harness fen={SICILIAN} />)
    expect(api.engines.map((host) => host.runnerName)).toEqual(['This browser'])
    expect(api.engineId).toBe(-1)
  })

  it('searches after the board settles, and attributes frames to the position searched', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fake.ready = true
    let options!: InfiniteSearchOptions
    fake.searchInfinite.mockImplementation(async (_fen: string, given: InfiniteSearchOptions) => {
      options = given
      given.onStarted?.()
      return true
    })
    render(<Harness fen={SICILIAN} />)
    act(() => api.setEnabled(true))
    expect(fake.searchInfinite).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(fake.searchInfinite).toHaveBeenCalledWith(SICILIAN, expect.anything())
    expect(api.session).toMatchObject({ engine: 'Stockfish 18', runner: 'This browser', game_id: 12 })

    act(() => options.onSnapshot({ depth: 20, nodes: 5000, nps: 1000, timeMs: 5, lines: [] }))
    expect(api.phase).toBe('running')
    expect(api.snapshot?.fen).toBe(SICILIAN)
    vi.useRealTimers()
  })
})

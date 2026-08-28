import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LIVE_DEBOUNCE_MS, useDebounced, useLiveMaia } from './useLiveMaia'

describe('useDebounced', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('holds a value until it has stopped changing', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounced(value, LIVE_DEBOUNCE_MS), {
      initialProps: { value: 'a' },
    })
    expect(result.current).toBe('a')

    rerender({ value: 'b' })
    expect(result.current).toBe('a')
    act(() => void vi.advanceTimersByTime(LIVE_DEBOUNCE_MS - 1))
    expect(result.current).toBe('a')
    act(() => void vi.advanceTimersByTime(1))
    expect(result.current).toBe('b')
  })

  it('settles on the last of a run of changes, not on the ones passed through', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounced(value, LIVE_DEBOUNCE_MS), {
      initialProps: { value: 'a' },
    })
    // A reader clicking three moves deep into a line inside the window: one settle, at the
    // position they landed on.
    rerender({ value: 'b' })
    act(() => void vi.advanceTimersByTime(100))
    rerender({ value: 'c' })
    act(() => void vi.advanceTimersByTime(100))
    rerender({ value: 'd' })
    expect(result.current).toBe('a')
    act(() => void vi.advanceTimersByTime(LIVE_DEBOUNCE_MS))
    expect(result.current).toBe('d')
  })
})

const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
const AFTER_E4_D5 = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'

function policyFor(fen: string) {
  return {
    elo: 1700,
    policy: [{ uci: fen === AFTER_E4 ? 'd7d5' : 'e4d5', san: fen === AFTER_E4 ? 'd5' : 'exd5', rank: 1, p: 0.6 }],
    rollout: [],
  }
}

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useLiveMaia', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('withholds the position it has an answer for once the board has left it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { fen: string }
        return new Response(JSON.stringify(policyFor(body.fen)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )

    const { result, rerender } = renderHook(({ fen }) => useLiveMaia(fen, 1700), {
      initialProps: { fen: AFTER_E4 as string | null },
      wrapper: wrapper(),
    })

    await waitFor(() => expect(result.current.view?.level.moves[0]?.uci).toBe('d7d5'))

    // The reader plays d5. The cache still holds the answer for the position they left,
    // and it is a move whose origin square is now empty — so nothing is offered until the
    // debounced query has caught up with the board.
    rerender({ fen: AFTER_E4_D5 })
    expect(result.current.view).toBeNull()
    expect(result.current.pending).toBe(true)

    await waitFor(() => expect(result.current.view?.level.moves[0]?.uci).toBe('e4d5'))
    expect(result.current.pending).toBe(false)

    // And walking back to a position already answered is still free — but only once the
    // question is that position again.
    rerender({ fen: AFTER_E4 })
    expect(result.current.view).toBeNull()
    await waitFor(() => expect(result.current.view?.level.moves[0]?.uci).toBe('d7d5'))
  })

  it('asks every configured level in one request, and shows the one that was picked', async () => {
    const bodies: { elo?: number; elos?: number[] }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { elos?: number[] }
        bodies.push(body)
        return new Response(
          JSON.stringify({
            elo: 1100,
            policy: [{ uci: 'b8c6', san: 'Nc6', rank: 1, p: 0.3 }],
            levels: {
              '1100': { elo: 1100, policy: [{ uci: 'b8c6', san: 'Nc6', rank: 1, p: 0.3 }] },
              '1900': { elo: 1900, policy: [{ uci: 'g8f6', san: 'Nf6', rank: 1, p: 0.5 }] },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }),
    )

    const { result } = renderHook(() => useLiveMaia(AFTER_E4, [1100, 1900], 1900), {
      wrapper: wrapper(),
    })

    await waitFor(() => expect(result.current.views).toHaveLength(2))
    // One request for both levels — the endpoint is a single warm process under one lock,
    // so two questions would only serialise the same work.
    expect(bodies).toHaveLength(1)
    expect(bodies[0]!.elos).toEqual([1100, 1900])
    // The pick chooses among the answers; the comparison still has all of them.
    expect(result.current.view?.level.rating).toBe('1900')
    expect(result.current.views.map((view) => view.level.rating)).toEqual(['1100', '1900'])
  })
})

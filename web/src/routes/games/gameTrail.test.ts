import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { advanceTrail, rememberTrail, resetTrail, useGameTrail } from './gameTrail'

/** The library, in the order the table put it in. The stub serves windows of this. */
const LIBRARY = [11, 12, 13, 14, 15]
let asked: URL[] = []

function stubFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    asked.push(url)
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const limit = Number(url.searchParams.get('limit') ?? 25)
    const games = LIBRARY.slice(offset, offset + limit).map((id) => ({ id }))
    return new Response(JSON.stringify({ games, total: LIBRARY.length }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return createElement(QueryClientProvider, { client }, children)
}

async function at(id: number | null) {
  const { result } = renderHook(() => useGameTrail(id), { wrapper })
  await waitFor(() => expect(result.current).not.toBeUndefined())
  return result
}

beforeEach(() => {
  asked = []
  resetTrail()
  vi.stubGlobal('fetch', stubFetch())
})

afterEach(() => vi.unstubAllGlobals())

describe('the game trail', () => {
  it('says nothing until a run has been opened from', async () => {
    const result = await at(14)
    expect(result.current).toBeNull()
    // And asks the backend nothing at all.
    expect(asked).toHaveLength(0)
  })

  it('names the games either side, asking for a window of three', async () => {
    rememberTrail({ query: { order: 'played_at' }, offset: 2, gameId: 13 })
    const result = await at(13)

    await waitFor(() => expect(result.current).toEqual({ previous: 12, next: 14 }))
    expect(asked[0]!.searchParams.get('offset')).toBe('1')
    expect(asked[0]!.searchParams.get('limit')).toBe('3')
    // The sort the table was showing goes with it, or "the next game" would mean something
    // else on the game screen than it did in the table.
    expect(asked[0]!.searchParams.get('order')).toBe('played_at')
  })

  it('offers nothing backwards at the top of the library', async () => {
    rememberTrail({ query: {}, offset: 0, gameId: 11 })
    const result = await at(11)

    await waitFor(() => expect(result.current).toEqual({ previous: null, next: 12 }))
    expect(asked[0]!.searchParams.get('offset')).toBe('0')
  })

  it('offers nothing forwards at the end of it', async () => {
    rememberTrail({ query: {}, offset: 4, gameId: 15 })
    const result = await at(15)

    await waitFor(() => expect(result.current).toEqual({ previous: 14, next: null }))
  })

  it('walks off the end of the page it started on', async () => {
    // Opened from a 3-row page: the last row of it, offset 2. Stepping on twice leaves that
    // page behind and keeps going, which is the whole point of holding the query and not
    // the page's ids.
    rememberTrail({ query: {}, offset: 2, gameId: 13 })
    advanceTrail(1, 14)
    const result = await at(14)

    await waitFor(() => expect(result.current).toEqual({ previous: 13, next: 15 }))
  })

  it('offers nothing for a game that is not the one the run is about', async () => {
    rememberTrail({ query: {}, offset: 2, gameId: 13 })

    // Opened from the dashboard, a note, the palette or a link.
    expect((await at(77)).current).toBeNull()
    expect((await at(null)).current).toBeNull()
  })

  it('says nothing rather than guessing when the game has moved out of the window', async () => {
    // A stale offset — games imported or deleted since the table was drawn. The window
    // comes back without this game in it, and two arrows pointing at strangers would be
    // worse than none.
    rememberTrail({ query: {}, offset: 0, gameId: 14 })
    const result = await at(14)

    await waitFor(() => expect(result.current).toEqual({ previous: null, next: null }))
  })
})

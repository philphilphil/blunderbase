import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { queryKeys } from '@/lib/api/keys'
import { SERVER_CAPABILITIES, type GameColumns } from '@/lib/api/types'
import { GAME_COLUMNS_KEY, readLocalColumns, writeLocalColumns } from '@/lib/games/demoColumns'
import { RuntimeCapabilitiesContext } from '@/lib/runtime/capabilities'

import { defaultArrangement, setColumnHidden } from './components/columns'
import { useGameColumns } from './useGameColumns'

vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Every request to the column choice, as method and parsed body. */
function columnRequests() {
  return vi
    .mocked(fetch)
    .mock.calls.filter(([input]) => String(input).split('?')[0]!.endsWith('/api/settings/game-columns'))
    .map(([, init]) => ({ method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null }))
}

/** Serve the column choice (or `status` for it), and answer a PUT with what it sent. */
function stub(columns: GameColumns | null, status = 200) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).split('?')[0]!
    if (path.endsWith('/api/settings/game-columns')) {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { order: string[] | null; hidden: string[] }
        return json(200, body.order === null ? { order: [], hidden: [] } : body)
      }
      if (columns && status === 200) return json(200, columns)
      return json(status, { error: 'not_found', detail: path })
    }
    return json(404, { error: 'not_found', detail: path })
  })
  vi.stubGlobal('fetch', fetchMock)
}

function draw({ demo = false } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <RuntimeCapabilitiesContext.Provider value={{ ...SERVER_CAPABILITIES, read_only: demo }}>
        {children}
      </RuntimeCapabilitiesContext.Provider>
    </QueryClientProvider>
  )
  return { client, ...renderHook(() => useGameColumns(), { wrapper }) }
}

const ids = (state: ReturnType<typeof useGameColumns>) =>
  state.columns.filter((column) => column.wide).map((column) => column.id)

beforeEach(() => stub(null))
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.removeItem(GAME_COLUMNS_KEY)
})

describe('useGameColumns', () => {
  it('draws the default while the choice is on its way', () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}))
    const { result } = draw()
    expect(result.current.isDefault).toBe(true)
    expect(ids(result.current)).toContain('opening')
  })

  it('draws the default when the choice cannot be read', async () => {
    for (const status of [404, 500]) {
      stub(null, status)
      const { result, client, unmount } = draw()
      await waitFor(() => expect(client.getQueryState(queryKeys.gameColumns())?.status).toBe('error'))
      expect(result.current.isDefault).toBe(true)
      expect(result.current.arrangement).toEqual(defaultArrangement())
      expect(result.current.failed).toBe(true)
      expect(result.current.editable).toBe(false)
      expect(result.current.resolved).toBe(true)
      unmount()
    }
  })

  it('keeps drawing this browser’s copy when the choice cannot be read', async () => {
    writeLocalColumns({ order: ['opening', 'date'], hidden: ['date'] })
    stub(null, 500)
    const { result, client } = draw()
    // The copy stands in while the read is on its way …
    expect(ids(result.current)[1]).toBe('opening')
    expect(result.current.resolved).toBe(true)
    await waitFor(() => expect(client.getQueryState(queryKeys.gameColumns())?.status).toBe('error'))
    // … and after it failed, rather than the list jumping back to the default.
    expect(ids(result.current)[1]).toBe('opening')
    expect(ids(result.current)).not.toContain('date')
    expect(result.current.failed).toBe(true)
  })

  it('is editable only once the server has answered', async () => {
    writeLocalColumns({ order: ['opening', 'date'], hidden: [] })
    let answer: (response: Response) => void = () => {}
    vi.mocked(fetch).mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { result } = draw()
    expect(result.current.editable).toBe(false)
    act(() => answer(json(200, { order: ['date', 'opening'], hidden: [] })))
    await waitFor(() => expect(result.current.editable).toBe(true))
    expect(ids(result.current)[1]).toBe('date')
  })

  it('is not resolved while a new browser waits for its first answer', () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}))
    const { result } = draw()
    expect(result.current.resolved).toBe(false)
    expect(result.current.editable).toBe(false)
  })

  it('draws the stored choice once it is read', async () => {
    stub({ order: ['opening', 'date'], hidden: ['date'] })
    const { result } = draw()
    await waitFor(() => expect(result.current.isDefault).toBe(false))
    expect(ids(result.current)[1]).toBe('opening')
    expect(ids(result.current)).not.toContain('date')
  })

  it('saves the whole arrangement, unknown ids and all', async () => {
    stub({ order: ['date', 'later_column', 'white'], hidden: ['later_column'] })
    const { result } = draw()
    await waitFor(() => expect(result.current.isDefault).toBe(false))

    act(() => result.current.save(setColumnHidden(result.current.arrangement, 'white', true)))

    await waitFor(() => expect(columnRequests().filter((each) => each.method === 'PUT')).toHaveLength(1))
    const [put] = columnRequests().filter((each) => each.method === 'PUT')
    expect(put!.body.order.slice(0, 3)).toEqual(['date', 'later_column', 'white'])
    expect(put!.body.hidden).toEqual(['later_column', 'white'])
    expect(ids(result.current)).not.toContain('white')
  })

  it('puts the default back on reset, and forgets this browser’s copy', async () => {
    stub({ order: ['opening', 'date'], hidden: [] })
    const { result } = draw()
    await waitFor(() => expect(readLocalColumns()).not.toBeNull())

    act(() => result.current.reset())

    expect(localStorage.getItem(GAME_COLUMNS_KEY)).toBeNull()
    await waitFor(() => expect(result.current.isDefault).toBe(true))
    await waitFor(() =>
      expect(columnRequests().find((each) => each.method === 'PUT')?.body).toEqual({ order: null, hidden: [] }),
    )
  })

  it('keeps the demo’s choice in this browser and sends nothing', async () => {
    writeLocalColumns({ order: ['opening', 'date'], hidden: [] })
    const { result } = draw({ demo: true })
    expect(ids(result.current)[1]).toBe('opening')
    expect(result.current.editable).toBe(true)

    act(() => result.current.save(setColumnHidden(result.current.arrangement, 'opening', true)))

    await waitFor(() => expect(ids(result.current)).not.toContain('opening'))
    expect(readLocalColumns()?.hidden).toEqual(['opening'])
    expect(columnRequests()).toEqual([])
  })
})

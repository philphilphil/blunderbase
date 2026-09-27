import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { invalidationsFor } from '@/lib/events/invalidation'
import { resetOwnWrites, screenFrame } from '@/lib/events/ownWrites'

import { queryKeys } from './keys'
import { useAddToCollection, useCollectionOverview, useUpdateCollection } from './queries'

const fake = vi.hoisted(() => ({
  addToCollection: vi.fn(),
  updateCollection: vi.fn(),
  getCollectionOverview: vi.fn(),
}))
vi.mock('./endpoints', () => fake)

const MOVED = invalidationsFor({ event: 'collections.changed', collection_id: 3, membership: true })
const MOVED_ABOUT = { id: 3, membership: true }

function harness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } },
  })
  const games = vi.fn(async () => 'rows')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, games, wrapper }
}

beforeEach(() => resetOwnWrites())
afterEach(() => {
  vi.clearAllMocks()
  resetOwnWrites()
})

describe('collection writes', () => {
  it('refetch the games once for a membership change, and expect the socket to echo it', async () => {
    const { games, wrapper } = harness()
    fake.addToCollection.mockResolvedValue({ added: 2, collection: { id: 3 } })
    const { result } = renderHook(
      () => ({
        rows: useQuery({ queryKey: queryKeys.gameCards({}), queryFn: games }),
        add: useAddToCollection(),
      }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.rows.data).toBe('rows'))

    await act(() => result.current.add.mutateAsync({ collectionId: 3, gameIds: [1, 2] }))

    await waitFor(() => expect(games).toHaveBeenCalledTimes(2))
    // The frame the server sent for this write has nothing left to refresh.
    expect(screenFrame('collections.changed', MOVED, MOVED_ABOUT)).toEqual([])
  })

  it('leave the games alone, and expect no echo, when nothing moved', async () => {
    const { games, wrapper } = harness()
    fake.addToCollection.mockResolvedValue({ added: 0, collection: { id: 3 } })
    const { result } = renderHook(
      () => ({
        rows: useQuery({ queryKey: queryKeys.gameCards({}), queryFn: games }),
        add: useAddToCollection(),
      }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.rows.data).toBe('rows'))

    await act(() => result.current.add.mutateAsync({ collectionId: 3, gameIds: [1] }))

    expect(games).toHaveBeenCalledTimes(1)
    expect(screenFrame('collections.changed', MOVED, MOVED_ABOUT)).toEqual(MOVED)
  })

  it('refresh only the collections for a rename', async () => {
    const { games, wrapper } = harness()
    const lists = vi.fn(async () => ({ collections: [] }))
    fake.updateCollection.mockResolvedValue({ id: 3, name: 'Liga' })
    const { result } = renderHook(
      () => ({
        rows: useQuery({ queryKey: queryKeys.gameCards({}), queryFn: games }),
        list: useQuery({ queryKey: queryKeys.collectionList(), queryFn: lists }),
        update: useUpdateCollection(),
      }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.list.data).toBeDefined())

    await act(() => result.current.update.mutateAsync({ id: 3, body: { name: 'Liga' } }))

    await waitFor(() => expect(lists).toHaveBeenCalledTimes(2))
    expect(games).toHaveBeenCalledTimes(1)
  })
})

describe('useCollectionOverview', () => {
  it('lives under the collections root, so every collections frame refreshes it', async () => {
    const { client, wrapper } = harness()
    fake.getCollectionOverview.mockResolvedValue({ collections: [] })
    const { result } = renderHook(() => useCollectionOverview(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual({ collections: [] }))

    const [root] = queryKeys.collections()
    expect(queryKeys.collectionOverview()[0]).toBe(root)
    await act(() => client.invalidateQueries({ queryKey: queryKeys.collections() }))
    expect(fake.getCollectionOverview).toHaveBeenCalledTimes(2)
  })
})

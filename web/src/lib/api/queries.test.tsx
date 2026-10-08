import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { invalidationsFor } from '@/lib/events/invalidation'
import { resetOwnWrites, screenFrame } from '@/lib/events/ownWrites'
import { GAME_COLUMNS_KEY, readLocalColumns, writeLocalColumns } from '@/lib/games/demoColumns'
import { RuntimeCapabilitiesContext } from '@/lib/runtime/capabilities'
import { toast } from '@/lib/toast'

import { queryKeys } from './keys'
import {
  useAddToCollection,
  useCollectionOverview,
  useGameColumnsPref,
  useSaveGameColumns,
  useUpdateCollection,
} from './queries'
import { SERVER_CAPABILITIES, type GameColumns } from './types'

const fake = vi.hoisted(() => ({
  addToCollection: vi.fn(),
  updateCollection: vi.fn(),
  getCollectionOverview: vi.fn(),
  getGameColumns: vi.fn(),
  saveGameColumns: vi.fn(),
}))
vi.mock('./endpoints', () => fake)
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }))

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

describe('the games list’s column choice', () => {
  const A: GameColumns = { order: ['white', 'date'], hidden: [] }
  const B: GameColumns = { order: ['white', 'date'], hidden: ['date'] }
  const C: GameColumns = { order: ['date', 'white'], hidden: ['white'] }

  function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((done, fail) => {
      resolve = done
      reject = fail
    })
    return { promise, resolve, reject }
  }

  /** The pref and its save, read once the first answer (`answer`) is in. */
  async function columns(answer: GameColumns = { order: [], hidden: [] }) {
    const { client, wrapper } = harness()
    fake.getGameColumns.mockResolvedValue(answer)
    const view = renderHook(() => ({ pref: useGameColumnsPref(), save: useSaveGameColumns().save }), {
      wrapper,
    })
    await waitFor(() => expect(view.result.current.pref.isSuccess).toBe(true))
    const cached = () => client.getQueryData(queryKeys.gameColumns())
    return { client, result: view.result, cached }
  }

  beforeEach(() => {
    fake.getGameColumns.mockReset()
    fake.saveGameColumns.mockReset()
  })
  afterEach(() => localStorage.removeItem(GAME_COLUMNS_KEY))

  it('shows a save before the server has answered it', async () => {
    const { result, cached } = await columns()
    const answer = deferred<GameColumns>()
    fake.saveGameColumns.mockReturnValueOnce(answer.promise)

    act(() => result.current.save(B))

    expect(cached()).toEqual(B)
    expect(readLocalColumns()).toEqual(B)
    await act(async () => answer.resolve(B))
    expect(fake.saveGameColumns).toHaveBeenCalledWith(B)
  })

  it('sends quick saves one at a time, in click order, and takes only the newest answer', async () => {
    const { result, cached } = await columns()
    const first = deferred<GameColumns>()
    const second = deferred<GameColumns>()
    fake.saveGameColumns.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    act(() => {
      result.current.save(A)
      result.current.save(B)
    })
    // The second waits its turn behind the first (`scope`).
    await waitFor(() => expect(fake.saveGameColumns).toHaveBeenCalledTimes(1))
    expect(cached()).toEqual(B)

    // The first answer lands while the second is still waiting: it is older than the
    // screen, so it is not taken.
    await act(async () => first.resolve(A))
    await waitFor(() => expect(fake.saveGameColumns).toHaveBeenCalledTimes(2))
    expect(fake.saveGameColumns.mock.calls.map(([body]) => body)).toEqual([A, B])
    expect(cached()).toEqual(B)

    // The newest answer is, and it is what the server kept.
    await act(async () => second.resolve(C))
    await waitFor(() => expect(cached()).toEqual(C))
    expect(readLocalColumns()).toEqual(C)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('says so and asks the server again when the newest save fails', async () => {
    const { result, cached } = await columns(A)
    fake.saveGameColumns.mockRejectedValueOnce(new Error('offline'))
    fake.getGameColumns.mockResolvedValue(C)

    act(() => result.current.save(B))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not save the columns'))
    await waitFor(() => expect(fake.getGameColumns).toHaveBeenCalledTimes(2))
    // What the server actually holds, on screen and in this browser's copy.
    await waitFor(() => expect(cached()).toEqual(C))
    expect(readLocalColumns()).toEqual(C)
  })

  it('keeps a later success over an earlier failure', async () => {
    const { result, cached } = await columns(A)
    const first = deferred<GameColumns>()
    fake.saveGameColumns.mockReturnValueOnce(first.promise).mockResolvedValueOnce(C)

    act(() => {
      result.current.save(B)
      result.current.save(C)
    })
    await act(async () => first.reject(new Error('offline')))

    await waitFor(() => expect(fake.saveGameColumns).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(cached()).toEqual(C))
    expect(toast.error).toHaveBeenCalledOnce()
    // A newer save was waiting, so the failure did not refetch over it.
    expect(fake.getGameColumns).toHaveBeenCalledOnce()
  })

  it('drops a read asked while a save was on its way, even when it lands after the save', async () => {
    const { client, result, cached } = await columns(A)
    const put = deferred<GameColumns>()
    const read = deferred<GameColumns>()
    fake.saveGameColumns.mockReturnValueOnce(put.promise)
    fake.getGameColumns.mockReturnValueOnce(read.promise)

    act(() => result.current.save(B))
    // A read asked now (a reconnect's blanket refetch) may be served the row before the save.
    act(() => void client.refetchQueries({ queryKey: queryKeys.gameColumns() }))
    await waitFor(() => expect(fake.getGameColumns).toHaveBeenCalledTimes(2))
    await act(async () => put.resolve(B))
    await act(async () => read.resolve(A))

    expect(cached()).toEqual(B)
    expect(readLocalColumns()).toEqual(B)
  })

  it('passes the read its signal, and a read a save cancelled does not write this browser’s copy', async () => {
    const { client, result } = await columns(A)
    expect(fake.getGameColumns.mock.calls[0]![0]).toBeInstanceOf(AbortSignal)
    const read = deferred<GameColumns>()
    fake.getGameColumns.mockReturnValueOnce(read.promise)
    fake.saveGameColumns.mockResolvedValueOnce(B)

    act(() => void client.refetchQueries({ queryKey: queryKeys.gameColumns() }))
    await waitFor(() => expect(fake.getGameColumns).toHaveBeenCalledTimes(2))
    const signal = fake.getGameColumns.mock.calls[1]![0] as AbortSignal
    act(() => result.current.save(B))
    expect(signal.aborted).toBe(true)
    await waitFor(() => expect(fake.saveGameColumns).toHaveBeenCalledOnce())
    // The fake ignores the abort and answers late with the state from before the click.
    await act(async () => read.resolve(A))

    expect(readLocalColumns()).toEqual(B)
  })

  it('rewrites this browser’s copy from every answer the server gives', async () => {
    writeLocalColumns(A)
    await columns(C)
    expect(readLocalColumns()).toEqual(C)
  })

  it('draws from this browser’s copy until the server answers', async () => {
    writeLocalColumns(B)
    const { wrapper } = harness()
    fake.getGameColumns.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useGameColumnsPref(), { wrapper })
    expect(result.current.data).toEqual(B)
    expect(result.current.isPlaceholderData).toBe(true)
  })

  it('keeps the demo’s choice in the browser and sends nothing', async () => {
    writeLocalColumns(A)
    const { client } = harness()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <RuntimeCapabilitiesContext.Provider value={{ ...SERVER_CAPABILITIES, read_only: true }}>
          {children}
        </RuntimeCapabilitiesContext.Provider>
      </QueryClientProvider>
    )
    const { result } = renderHook(
      () => ({ pref: useGameColumnsPref(), save: useSaveGameColumns().save }),
      { wrapper },
    )
    expect(result.current.pref.data).toEqual(A)

    act(() => result.current.save(B))

    await waitFor(() => expect(result.current.pref.data).toEqual(B))
    expect(readLocalColumns()).toEqual(B)
    expect(fake.getGameColumns).not.toHaveBeenCalled()
    expect(fake.saveGameColumns).not.toHaveBeenCalled()
  })
})

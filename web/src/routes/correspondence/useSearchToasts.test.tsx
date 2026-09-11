import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { queryKeys } from '@/lib/api/keys'
import type { AppSettings, CorrespondenceSearchList } from '@/lib/api/types'
import { EventsProvider } from '@/lib/events/EventsProvider'
import { I18nProvider } from '@/lib/i18n/I18nProvider'
import { toast } from '@/lib/toast'

import { useCorrespondenceSearchToasts } from './useSearchToasts'

vi.mock('@/lib/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

/** A socket the test feeds by hand, as `EventsProvider.test.tsx` does. */
class FakeSocket {
  static instances: FakeSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
  }
  close() {}
  receive(frame: unknown) {
    act(() => this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent<string>))
  }
}

function Listener() {
  useCorrespondenceSearchToasts()
  return null
}

function draw() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData<AppSettings>(queryKeys.settings(), {
    correspondence_enabled: 1,
  } as AppSettings)
  client.setQueryData<CorrespondenceSearchList>(queryKeys.correspondenceSearches(true), {
    searches: [
      { id: 7, node_id: 4, kind: 'search', status: 'running', engine_name: 'Stockfish 17' },
      { id: 21, node_id: 4, kind: 'task', status: 'running', engine_name: 'Stockfish 17' },
    ],
  })
  render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <EventsProvider>
          <Listener />
        </EventsProvider>
      </I18nProvider>
    </QueryClientProvider>,
  )
  return FakeSocket.instances.at(-1) as FakeSocket
}

beforeEach(() => {
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the correspondence toasts', () => {
  it('says when a search that ran for days has finished', () => {
    const socket = draw()
    socket.receive({
      event: 'correspondence.search',
      search_id: 7,
      node_id: 4,
      game_id: 1,
      engine_id: 1,
      kind: 'search',
      status: 'done',
      warm: false,
    })
    expect(vi.mocked(toast.success)).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when a task finishes: one expansion is a dozen of them', () => {
    const socket = draw()
    socket.receive({
      event: 'correspondence.search',
      search_id: 21,
      node_id: 4,
      game_id: 1,
      engine_id: 1,
      kind: 'task',
      status: 'done',
      warm: false,
    })
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled()
  })

  it('still speaks when a task fails — that one was not what was asked for', () => {
    const socket = draw()
    socket.receive({
      event: 'correspondence.search',
      search_id: 21,
      node_id: 4,
      game_id: 1,
      engine_id: 1,
      kind: 'task',
      status: 'failed',
      warm: false,
    })
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1)
  })
})

import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import type { RunnersStatus, StreamResponse, StreamSurface } from '@/lib/api/types'

import { useStreamSession, type StreamSessionApi } from './useStreamSession'

// --- the socket -----------------------------------------------------------

class FakeSocket {
  static last: FakeSocket | null = null
  opened = false
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event?: CloseEvent) => void) | null = null
  readonly url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.last = this
  }
  close() {}
}

function deliver(event: Record<string, unknown>) {
  act(() => {
    const socket = FakeSocket.last
    if (!socket) throw new Error('no socket was opened')
    if (!socket.opened) {
      socket.opened = true
      socket.onopen?.()
    }
    socket.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>)
  })
}

// --- the API --------------------------------------------------------------

interface Call {
  method: string
  path: string
  body: Record<string, unknown> | null
}

let calls: Call[] = []

const STATUS: RunnersStatus = {
  local: {
    name: 'local',
    slots: 2,
    busy: 0,
    streams: 0,
    workers: true,
    queued: 0,
    running: 0,
    engines: [
      {
        id: 1,
        name: 'stockfish',
        kind: 'uci',
        path: '/usr/games/stockfish',
        enabled: true,
        default_tier: 'deep',
        streams: true,
      },
    ],
  },
  runners: [
    {
      id: 3,
      name: 'gpu-box',
      slots: 4,
      version: '0.1.0',
      connected: true,
      transport: 'websocket',
      busy: 0,
      streams: 0,
      free_slots: 4,
      queued_eligible: 0,
      // Two engines on one machine: when it goes away it takes both, whatever this
      // (pre-disconnect) read still says about the second one.
      engines: [
        {
          id: 7,
          name: 'sf-remote',
          kind: 'uci',
          path: '/usr/games/stockfish',
          enabled: true,
          default_tier: 'deep',
          streams: true,
        },
        {
          id: 8,
          name: 'sf-remote-2',
          kind: 'uci',
          path: '/usr/games/stockfish',
          enabled: true,
          default_tier: 'quick',
          streams: true,
        },
      ],
    },
  ],
  queue: { queued: 0, running: 0 },
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2'

/**
 * What `services.streams._position` does to a caller's FEN: python-chess only writes an
 * en-passant square when the capture is actually legal, so the string that comes back is
 * not always the one chessops computed. Every test here goes through it, because the hook
 * matching a frame against the *client's* spelling is exactly the bug that would make a
 * board sit empty forever.
 */
function serverSpelling(fen: string): string {
  const parts = fen.split(' ')
  parts[3] = '-'
  return parts.join(' ')
}

let sessionCounter = 0

function sessionFor(body: Record<string, unknown>, id: string): StreamResponse {
  const remote = body.engine_id === 7
  return {
    id,
    surface: (body.surface as StreamSurface) ?? 'game',
    fen: serverSpelling(String(body.fen)),
    multipv: Number(body.multipv ?? 1),
    engine_id: remote ? 7 : 1,
    engine: remote ? 'sf-remote' : 'stockfish',
    runner_id: remote ? 3 : null,
    runner: remote ? 'gpu-box' : null,
    state: 'starting',
    reason: null,
    seq: 0,
    created_at: '2026-08-26T10:00:00+00:00',
    last_snapshot_at: null,
    game_id: (body.game_id as number | null) ?? null,
    ply: (body.ply as number | null) ?? null,
  }
}

interface Refusal {
  status: number
  error: string
  detail: string
}

/**
 * A promise the stub waits on, so a request can be held mid-flight — the window a restart
 * is open for is the whole point of two of the cases below.
 */
function gate(): { held: Promise<void>; release: () => void } {
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = () => resolve()
  })
  return { held, release }
}

/** Set by a test to hold every PATCH open until it says so. */
let patchGate: ReturnType<typeof gate> | null = null
/** Set by a test to make every PATCH fail. */
let patchRefusal: Refusal | null = null

/** Keyed on method *and* path — `POST /streams` and `DELETE /streams/{id}` are not the same. */
function stubFetch(refuse?: Refusal) {
  const live = new Map<string, StreamResponse>()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).split('?')[0]!
      const method = init?.method ?? 'GET'
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : null
      calls.push({ method, path, body })

      if (path === '/api/runners/status') return json(STATUS)

      if (path === '/api/streams' && method === 'POST') {
        if (refuse) {
          return json({ error: refuse.error, detail: refuse.detail }, refuse.status)
        }
        const opened = sessionFor(body ?? {}, `str_${++sessionCounter}`)
        live.set(opened.id, opened)
        return json(opened, 201)
      }
      if (path === '/api/streams' && method === 'GET') return json([...live.values()])

      const match = /^\/api\/streams\/(.+)$/.exec(path)
      if (match) {
        const id = match[1]!
        const existing = live.get(id)
        if (!existing) return json({ error: 'unknown_stream', detail: id }, 404)
        if (method === 'DELETE') {
          live.delete(id)
          return new Response(null, { status: 204 })
        }
        if (method === 'PATCH') {
          if (patchGate) await patchGate.held
          if (patchRefusal) {
            return json(
              { error: patchRefusal.error, detail: patchRefusal.detail },
              patchRefusal.status,
            )
          }
          const updated: StreamResponse = {
            ...existing,
            fen: body?.fen ? serverSpelling(String(body.fen)) : existing.fen,
            multipv: body?.multipv ? Number(body.multipv) : existing.multipv,
          }
          live.set(id, updated)
          return json(updated)
        }
      }
      return json({ error: 'not_found', detail: path }, 404)
    }),
  )
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function streamCalls(method: string): Call[] {
  return calls.filter((call) => call.method === method && call.path.startsWith('/api/streams'))
}

// --- the harness ----------------------------------------------------------

let api: StreamSessionApi | null = null

function Harness({ fen, surface = 'game' }: { fen: string | null; surface?: StreamSurface }) {
  const stream = useStreamSession({ surface, fen, gameId: 14, ply: 0 })
  api = stream
  return (
    <div>
      <span data-testid="phase">{stream.phase}</span>
      <span data-testid="lines">
        {(stream.snapshot?.lines ?? []).map((line) => line.pv[0]).join(',')}
      </span>
      <span data-testid="depth">{stream.snapshot?.depth ?? ''}</span>
      <span data-testid="offer">
        {stream.offer ? stream.offer.candidates.map((host) => host.name).join(',') : ''}
      </span>
      <span data-testid="error">{stream.error?.message ?? ''}</span>
    </div>
  )
}

/**
 * The hook under `Providers` and under `StrictMode`, which is how `main.tsx` mounts the
 * app — an effect that opened a session on its first pass has to close it when React tears
 * that pass down.
 */
function renderHook(fen: string | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  const tree = (value: string | null) => (
    <StrictMode>
      <Providers client={client}>
        <Harness fen={value} />
      </Providers>
    </StrictMode>
  )
  const view = render(tree(fen))
  return { ...view, setFen: (next: string | null) => view.rerender(tree(next)) }
}

function toggle(on: boolean) {
  act(() => api!.setEnabled(on))
}

/** Long enough for a debounce that should not fire to have fired if it were going to. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250))
  })
}

/** One `stream.snapshot` frame for `str_1`, on the server's spelling of `fen`. */
function snapshotEvent({
  seq,
  fen,
  first,
  ...extra
}: {
  seq: number
  fen: string
  first: string
} & Record<string, unknown>) {
  return {
    event: 'stream.snapshot',
    session_id: 'str_1',
    seq,
    engine_id: 1,
    engine: 'stockfish',
    runner_id: null,
    fen: serverSpelling(fen),
    multipv: 3,
    depth: 20,
    nodes: 1_000,
    nps: 500,
    time_ms: 2_000,
    lines: [{ multipv: 1, cp: 30, mate: null, pv: [first] }],
    at: '2026-08-26T10:00:10+00:00',
    ...extra,
  }
}

beforeEach(() => {
  calls = []
  sessionCounter = 0
  api = null
  patchGate = null
  patchRefusal = null
  vi.stubGlobal('WebSocket', FakeSocket as unknown as typeof WebSocket)
  stubFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
  FakeSocket.last = null
})

describe('useStreamSession', () => {
  it('opens nothing until the toggle is turned on', async () => {
    renderHook(START)
    await screen.findByText('off')
    // The runners read is the page's, not a session's.
    await waitFor(() => expect(calls.some((c) => c.path === '/api/runners/status')).toBe(true))
    expect(streamCalls('POST')).toHaveLength(0)
  })

  it('opens exactly one session on the position the board is showing', async () => {
    renderHook(START)
    await screen.findByText('off')

    toggle(true)
    await waitFor(() => expect(streamCalls('POST')).toHaveLength(1))
    expect(streamCalls('POST')[0]!.body).toEqual({
      fen: START,
      engine_id: null,
      multipv: 3,
      surface: 'game',
      game_id: 14,
      ply: 0,
    })
    await waitFor(() => expect(api!.session?.id).toBe('str_1'))
    expect(screen.getByTestId('phase')).toHaveTextContent('opening')
  })

  it('never opens a session for a board with nothing on it', async () => {
    renderHook(null)
    toggle(true)
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('off'))
    expect(streamCalls('POST')).toHaveLength(0)
  })

  it('patches the open session once when the board is scrubbed', async () => {
    const { setFen } = renderHook(START)
    toggle(true)
    await waitFor(() => expect(api!.session?.id).toBe('str_1'))

    // Two plies inside the debounce window: one request, on the position it settled on.
    act(() => setFen(AFTER_E4))
    act(() => setFen(AFTER_E4_E5))

    await waitFor(() => expect(streamCalls('PATCH')).toHaveLength(1))
    // The one request carries the position it settled on, not the one it passed through.
    expect(streamCalls('PATCH')[0]).toMatchObject({
      path: '/api/streams/str_1',
      body: { fen: AFTER_E4_E5 },
    })
    // ...and a second one does not turn up late.
    await settle()
    expect(streamCalls('PATCH')).toHaveLength(1)
    // A position change is a restart on the same slot: never a teardown, never a new one.
    expect(streamCalls('POST')).toHaveLength(1)
    expect(streamCalls('DELETE')).toHaveLength(0)
  })

  it('takes snapshots for its own session and drops the stale ones', async () => {
    renderHook(START)
    toggle(true)
    await waitFor(() => expect(api!.session?.id).toBe('str_1'))

    const frame = (seq: number, first: string, extra: Record<string, unknown> = {}) => ({
      event: 'stream.snapshot',
      session_id: 'str_1',
      seq,
      engine_id: 1,
      engine: 'stockfish',
      runner_id: null,
      // The server's spelling, which is not the one the board computed.
      fen: serverSpelling(START),
      multipv: 3,
      depth: 20,
      nodes: 1_000,
      nps: 500,
      time_ms: 2_000,
      lines: [{ multipv: 1, cp: 30, mate: null, pv: [first] }],
      at: '2026-08-26T10:00:10+00:00',
      ...extra,
    })

    deliver(frame(4, 'e2e4', { depth: 20 }))
    expect(screen.getByTestId('phase')).toHaveTextContent('running')
    expect(screen.getByTestId('lines')).toHaveTextContent('e2e4')
    expect(screen.getByTestId('depth')).toHaveTextContent('20')

    // Reordered: `seq` is behind the last one accepted, so it is not news.
    deliver(frame(2, 'a2a3', { depth: 12 }))
    expect(screen.getByTestId('depth')).toHaveTextContent('20')

    // Somebody else's board.
    deliver(frame(9, 'h2h4', { session_id: 'str_other', depth: 33 }))
    expect(screen.getByTestId('depth')).toHaveTextContent('20')

    // A frame for a position this session has already left.
    deliver(frame(10, 'd2d4', { fen: serverSpelling(AFTER_E4), depth: 44 }))
    expect(screen.getByTestId('depth')).toHaveTextContent('20')

    deliver(frame(11, 'd2d4', { depth: 26 }))
    expect(screen.getByTestId('depth')).toHaveTextContent('26')
  })

  it('hides the lines the moment the board leaves the position they describe', async () => {
    const { setFen } = renderHook(START)
    toggle(true)
    await waitFor(() => expect(api!.session?.id).toBe('str_1'))

    deliver({
      event: 'stream.snapshot',
      session_id: 'str_1',
      seq: 1,
      engine_id: 1,
      engine: 'stockfish',
      runner_id: null,
      fen: serverSpelling(START),
      multipv: 3,
      depth: 20,
      nodes: 1_000,
      nps: 500,
      time_ms: 2_000,
      lines: [{ multipv: 1, cp: 30, mate: null, pv: ['e2e4'] }],
      at: '2026-08-26T10:00:10+00:00',
    })
    expect(screen.getByTestId('lines')).toHaveTextContent('e2e4')

    // Synchronously, before any request goes out: the old ply's lines must never be read
    // as the new one's.
    act(() => setFen(AFTER_E4))
    expect(screen.getByTestId('lines')).toBeEmptyDOMElement()
  })

  it('drops the frames a restart is still racing, rather than re-tagging them', async () => {
    // The window is the PATCH round trip: the board is on the new position, the server is
    // still searching the old one, and every frame in flight carries the old spelling. On a
    // runner that is a socket hop plus an ack — several frames at ~2/s.
    patchGate = gate()
    const { setFen } = renderHook(START)
    toggle(true)
    await waitFor(() => expect(api!.session?.id).toBe('str_1'))

    deliver(snapshotEvent({ seq: 1, fen: START, first: 'a2a3' }))
    expect(screen.getByTestId('lines')).toHaveTextContent('a2a3')

    act(() => setFen(AFTER_E4))
    await waitFor(() => expect(streamCalls('PATCH')).toHaveLength(1))

    deliver(snapshotEvent({ seq: 2, fen: START, first: 'a2a3' }))
    expect(screen.getByTestId('lines')).toBeEmptyDOMElement()

    // Once the server has actually moved, its frames are taken again.
    await act(async () => {
      patchGate!.release()
      await Promise.resolve()
    })
    await waitFor(() => expect(api!.session?.fen).toBe(serverSpelling(AFTER_E4)))
    deliver(snapshotEvent({ seq: 3, fen: AFTER_E4, first: 'g1f3' }))
    expect(screen.getByTestId('lines')).toHaveTextContent('g1f3')
  })

  it('says why a refused restart left the search on the position the board has left', async () => {
    patchRefusal = {
      status: 409,
      error: 'stream_unavailable',
      detail: "'gpu-box' is connected over polling and cannot open an analysis board",
    }
    const { setFen } = renderHook(START)
    toggle(true)
    await waitFor(() => expect(api!.session?.id).toBe('str_1'))
    deliver(snapshotEvent({ seq: 1, fen: START, first: 'a2a3' }))

    act(() => setFen(AFTER_E4))
    // The panel draws an error on this phase alone, so a refusal that does not set it is a
    // healthy-looking board whose search has silently stopped following the position.
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('error'))
    expect(screen.getByTestId('error')).toHaveTextContent(
      "'gpu-box' is connected over polling and cannot open an analysis board",
    )
    // ...and the old position's frames stay out of the new position's panel.
    deliver(snapshotEvent({ seq: 2, fen: START, first: 'a2a3' }))
    expect(screen.getByTestId('lines')).toBeEmptyDOMElement()
  })

  it('offers the other engines when the runner disappears mid-search', async () => {
    renderHook(START)
    toggle(true)
    await waitFor(() => expect(api!.session?.id).toBe('str_1'))

    deliver({
      event: 'stream.ended',
      session_id: 'str_1',
      reason: 'runner_gone',
      error: 'the link dropped',
      engine_id: 1,
      runner_id: null,
      at: '2026-08-26T10:00:20+00:00',
    })

    expect(screen.getByTestId('phase')).toHaveTextContent('ended')
    // The engine that went with the host is not offered as its own replacement.
    expect(screen.getByTestId('offer')).toHaveTextContent('sf-remote')
    expect(api!.offer?.candidates.map((host) => host.engineId)).toEqual([7, 8])
    expect(screen.getByTestId('error')).toHaveTextContent('the link dropped')
    expect(api!.enabled).toBe(false)
    // The server has already let it go; nothing tries to DELETE it again.
    expect(streamCalls('DELETE')).toHaveLength(0)

    act(() => api!.resume(7))
    await waitFor(() => expect(streamCalls('POST')).toHaveLength(2))
    expect(streamCalls('POST')[1]!.body).toMatchObject({ engine_id: 7 })
    await waitFor(() => expect(api!.session?.runner).toBe('gpu-box'))
    expect(api!.offer).toBeNull()
  })

  it('offers no engine that was on the runner that went away', async () => {
    // `runner.disconnected` invalidates the roster on a flush timer, so the read this hook
    // can see still has both of gpu-box's engines in it, connected. Neither is reachable.
    renderHook(START)
    toggle(true)
    await waitFor(() => expect(api!.session?.id).toBe('str_1'))

    deliver({
      event: 'stream.ended',
      session_id: 'str_1',
      reason: 'runner_gone',
      error: "the link to 'gpu-box' dropped",
      engine_id: 7,
      runner_id: 3,
      at: '2026-08-26T10:00:20+00:00',
    })

    expect(api!.offer?.candidates.map((host) => host.engineId)).toEqual([1])
  })

  it('offers the engine back when it is the search that ended, not the machine', async () => {
    // An idle reap says nothing about the engine, and a crashed one is the obvious thing to
    // retry — on a one-engine deployment excluding it leaves no way back at all.
    renderHook(START)
    toggle(true)
    await waitFor(() => expect(api!.session?.id).toBe('str_1'))

    deliver({
      event: 'stream.ended',
      session_id: 'str_1',
      reason: 'idle',
      error: null,
      engine_id: 1,
      runner_id: null,
      at: '2026-08-26T10:00:20+00:00',
    })

    expect(api!.offer?.candidates.map((host) => host.engineId)).toContain(1)
  })

  it('says so and offers nothing when another board took the surface over', async () => {
    renderHook(START)
    toggle(true)
    await waitFor(() => expect(api!.session?.id).toBe('str_1'))

    deliver({
      event: 'stream.ended',
      session_id: 'str_1',
      reason: 'replaced',
      error: null,
      engine_id: 1,
      runner_id: null,
      at: '2026-08-26T10:00:20+00:00',
    })

    expect(screen.getByTestId('phase')).toHaveTextContent('off')
    expect(api!.offer).toBeNull()
    expect(api!.note).toBe('Another analysis board took this position over.')
  })

  it('closes the session when the toggle goes off', async () => {
    renderHook(START)
    toggle(true)
    await waitFor(() => expect(api!.session?.id).toBe('str_1'))

    toggle(false)
    await waitFor(() => expect(streamCalls('DELETE')).toHaveLength(1))
    expect(streamCalls('DELETE')[0]!.path).toBe('/api/streams/str_1')
    expect(screen.getByTestId('phase')).toHaveTextContent('off')
    expect(api!.session).toBeNull()
  })

  it('closes the session when the board goes away', async () => {
    const { unmount } = renderHook(START)
    toggle(true)
    await waitFor(() => expect(api!.session?.id).toBe('str_1'))

    unmount()
    await waitFor(() => expect(streamCalls('DELETE')).toHaveLength(1))
  })

  it('changing engine is a teardown and a reopen, not a patch', async () => {
    renderHook(START)
    toggle(true)
    await waitFor(() => expect(api!.session?.id).toBe('str_1'))

    act(() => api!.setEngineId(7))
    await waitFor(() => expect(streamCalls('POST')).toHaveLength(2))
    expect(streamCalls('DELETE')).toHaveLength(1)
    expect(streamCalls('POST')[1]!.body).toMatchObject({ engine_id: 7 })
    expect(streamCalls('PATCH')).toHaveLength(0)
  })

  it('patches the line count without reopening', async () => {
    renderHook(START)
    toggle(true)
    await waitFor(() => expect(api!.session?.id).toBe('str_1'))

    act(() => api!.setMultipv(5))
    await waitFor(() => expect(streamCalls('PATCH')).toHaveLength(1))
    expect(streamCalls('PATCH')[0]!.body).toEqual({ multipv: 5 })
    expect(streamCalls('POST')).toHaveLength(1)
  })

  it('leaves the toggle off and says what the server said when the cap is reached', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('WebSocket', FakeSocket as unknown as typeof WebSocket)
    // `stream_max_sessions` is configurable, so the number in the refusal is the
    // deployment's — a sentence written on this side would be wrong on any other cap.
    stubFetch({
      status: 409,
      error: 'stream_limit',
      detail: '4 analysis board(s) can be open at once; close one first',
    })

    renderHook(START)
    toggle(true)
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('error'))
    expect(screen.getByTestId('error')).toHaveTextContent(
      '4 analysis board(s) can be open at once; close one first',
    )
    expect(api!.enabled).toBe(false)
  })

  it('closes a session whose effect was torn down before the POST answered', async () => {
    // The toggle flicked off (or a StrictMode remount) while the request is in flight: the
    // effect's cleanup has no id to close yet, so the answer has to close itself rather
    // than leave a slot held until the server's idle reaper notices.
    renderHook(START)
    toggle(true)
    toggle(false)

    await waitFor(() => expect(streamCalls('DELETE')).toHaveLength(1))
    expect(streamCalls('POST')).toHaveLength(1)
    expect(streamCalls('DELETE')[0]!.path).toBe('/api/streams/str_1')
    await settle()
    expect(api!.session).toBeNull()
    expect(screen.getByTestId('phase')).toHaveTextContent('off')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BrowserRunnerClient, browserEngineName, type RunnerSocket } from './client'
import { credentialKey, type CredentialStore } from './credential'
import type { BrowserEngine, InfiniteSearchOptions } from './engine'
import type { RunPlan } from './protocol'
import type { AnalysisResult, SearchSnapshot } from './search'
import type { UciOption } from './uci'

const CREDENTIAL = { runnerId: 4, runnerName: 'this browser', token: 'bb_rnr_secret' }

/** What this runner advertises. Named after the runner, because engine names are global. */
const ENGINE_NAME = browserEngineName(CREDENTIAL.runnerName)

const DECLARED: UciOption[] = [
  { name: 'Threads', type: 'spin', default: 1, min: 1, max: 1024, var: [], managed: false },
  { name: 'Hash', type: 'spin', default: 16, min: 1, max: 2048, var: [], managed: false },
  { name: 'MultiPV', type: 'spin', default: 1, min: 1, max: 256, var: [], managed: true },
  { name: 'Ponder', type: 'check', default: false, min: null, max: null, var: [], managed: true },
  {
    name: 'UCI_Chess960',
    type: 'check',
    default: false,
    min: null,
    max: null,
    var: [],
    managed: true,
  },
]

/** One ply of the fool's mate, so a dispatch is two positions and finishes at once. */
const PLAN: RunPlan = {
  run_id: 42,
  tier: 'quick',
  game_id: 3,
  fen: null,
  variant: 'standard',
  initial_fen: null,
  moves_uci: ['f2f3'],
  moves_san: ['f3'],
  position_ids: [10, 11],
  ply_start: 0,
  ply_end: 1,
  nodes: 1000,
  depth: null,
  multipv: 1,
  thresholds: { inaccuracy: 5, mistake: 10, blunder: 20 },
  owner_color: 'white',
  owner_rating: 1700,
  maia_target_elo: 1700,
  maia_elos: [1700],
  maia_only: false,
  maia: true,
  maia_both_sides: true,
}

const RESULT: AnalysisResult = {
  score: { cp: 20, mateIn: null, foldedCp: 20 },
  depth: 12,
  nodes: 1000,
  candidates: [{ rank: 1, uci: 'e2e4', score: { cp: 20, mateIn: null, foldedCp: 20 }, pv: ['e2e4'] }],
}

class FakeSocket implements RunnerSocket {
  readonly sent: string[] = []
  closedWith: number | null = null
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null

  readonly protocols: string[]

  constructor(protocols: string[]) {
    this.protocols = protocols
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(code = 1000, reason = ''): void {
    if (this.closedWith !== null) return
    this.closedWith = code
    this.onclose?.({ code, reason })
  }

  /** Test-side: the server accepting, sending a frame, and hanging up. */
  accept(): void {
    this.onopen?.()
  }

  deliver(frame: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }

  hangUp(code: number, reason = ''): void {
    this.closedWith = code
    this.onclose?.({ code, reason })
  }

  frames(): Record<string, unknown>[] {
    return this.sent.map((text) => JSON.parse(text) as Record<string, unknown>)
  }

  frame(type: string): Record<string, unknown> | undefined {
    return this.frames().find((entry) => entry.type === type)
  }
}

/** A promise a test resolves when it wants the search to finish. */
function deferred<T>() {
  let settle!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

/**
 * One open-ended search the client asked for, from the test's side of `engine.ts`.
 *
 * `started` is the seam that matters: on the real module `onStarted` fires the moment
 * `go infinite` is genuinely on the engine, which — with one slot — may be a while after
 * the `stream_open` if a run is still finishing a position. A harness built with
 * `autoStart: false` holds it, so the wait can be tested without a WebAssembly module.
 */
interface FakeBoard {
  fen: string
  options: InfiniteSearchOptions
  /** The slot came free: `go infinite` is on the engine. */
  start: () => void
  /** The search ended. `true` ⇒ the engine stopped by itself. */
  end: (finished: boolean) => void
  aborted: () => boolean
}

function fakeEngine(
  analyse: () => Promise<AnalysisResult>,
  boards: FakeBoard[],
  autoStart: boolean,
): BrowserEngine {
  return {
    version: 'Stockfish 18',
    threads: 4,
    isolated: true,
    declaredOptions: DECLARED,
    options: { Threads: 4 },
    analyse,
    stopSearch: vi.fn(),
    quit: vi.fn(),
    searchInfinite: (fen, options) =>
      new Promise<boolean>((resolve) => {
        const board: FakeBoard = {
          fen,
          options,
          start: () => options.onStarted?.(),
          end: resolve,
          aborted: () => options.signal.aborted,
        }
        boards.push(board)
        // Aborting settles the search rather than rejecting it, as the real one does.
        options.signal.addEventListener('abort', () => resolve(false), { once: true })
        if (autoStart) board.start()
      }),
  }
}

function harness(
  analyse: () => Promise<AnalysisResult> = () => Promise.resolve(RESULT),
  autoStart = true,
) {
  const boards: FakeBoard[] = []
  const engine = fakeEngine(analyse, boards, autoStart)
  return { ...harnessWith(() => Promise.resolve(engine)), engine, boards }
}

function harnessWith(start: () => Promise<BrowserEngine>) {
  const sockets: FakeSocket[] = []
  const entries = new Map<string, string>()
  const store: CredentialStore = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  }
  const client = new BrowserRunnerClient({
    open: (_url, protocols) => {
      const socket = new FakeSocket(protocols)
      sockets.push(socket)
      return socket
    },
    start,
    store,
    url: () => 'ws://blunderbase.test/api/runner/ws',
    // No jitter, so a backoff step is exactly its nominal delay.
    random: () => 0,
    version: '0.4.0',
  })
  return { client, sockets, entries }
}

/** Drain the microtask queue; the engine and the plan are all resolved promises here. */
async function tick(times = 40): Promise<void> {
  for (let at = 0; at < times; at += 1) await Promise.resolve()
}

function welcome(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'welcome',
    proto: 1,
    runner_id: 4,
    runner: 'this browser',
    slots: 1,
    heartbeat_seconds: 10,
    engines: [{ name: ENGINE_NAME, engine_id: 9, accepted: true, reason: null }],
    cancelled_runs: [],
    ...extra,
  }
}

function dispatch(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'run_dispatch',
    run_id: 42,
    attempt_token: 'attempt-abc',
    engine: ENGINE_NAME,
    maia_engine: null,
    plan: PLAN,
    ...extra,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the handshake', () => {
  it('presents the token as the second subprotocol and never in the URL', async () => {
    const { client, sockets } = harness()
    client.start(CREDENTIAL)
    await tick()
    expect(sockets[0]?.protocols).toEqual(['blunderbase.runner.v1', 'bb_rnr_secret'])
  })

  it('says hello first, as a browser, with one slot and its advertisement', async () => {
    const { client, sockets } = harness()
    client.start(CREDENTIAL)
    await tick()
    sockets[0]!.accept()

    const hello = sockets[0]!.frames()[0]!
    expect(hello.type).toBe('hello')
    expect(hello.proto).toBe(1)
    // What earns a vanished tab its attempt refunds.
    expect(hello.browser).toBe(true)
    expect(hello.slots).toBe(1)
    expect(hello.active_runs).toEqual([])

    const engines = hello.engines as Record<string, unknown>[]
    expect(engines).toHaveLength(1)
    expect(engines[0]).toMatchObject({
      name: ENGINE_NAME,
      kind: 'uci',
      path: 'wasm:stockfish-18',
      version: 'Stockfish 18',
      // This tab answers `stream_open`. The value is persisted rather than inferred from
      // the kind at the other end, so a runner that only drains the queue can say so.
      streams: true,
    })
    // MultiPV is managed per search, and the server refuses an engine that stores one.
    expect(engines[0]!.options).toEqual({ Threads: 4 })
    expect(engines[0]!.declared_options).toEqual(DECLARED)
  })

  it('names the engine after the runner, because engine names are unique deployment-wide', () => {
    // `sync_runner_engines` refuses an advertisement whose name another host already holds.
    // A fixed string would work for the first browser and leave the second one connected,
    // advertising, and given no engine at all.
    expect(browserEngineName('this browser')).toBe('Stockfish (this browser)')
    expect(browserEngineName('phil’s laptop')).not.toBe(browserEngineName('the desktop'))
    // `Engine.name` is `String(64)`, and a runner name may itself be 64 characters.
    expect(browserEngineName('x'.repeat(80)).length).toBe(64)
  })

  it('takes the welcome as authoritative and reports what it refused', async () => {
    const { client, sockets } = harness()
    client.start(CREDENTIAL)
    await tick()
    sockets[0]!.accept()
    expect(client.getSnapshot().phase).toBe('connecting')

    sockets[0]!.deliver(
      welcome({
        runner: 'phil’s laptop',
        heartbeat_seconds: 4,
        engines: [
          { name: ENGINE_NAME, engine_id: null, accepted: false, reason: 'no tier free' },
        ],
      }),
    )
    const state = client.getSnapshot()
    expect(state.phase).toBe('connected')
    expect(state.runnerName).toBe('phil’s laptop')
    expect(state.refused).toEqual([{ name: ENGINE_NAME, reason: 'no tier free' }])
    // A refused engine leaves the socket up.
    expect(sockets[0]!.closedWith).toBeNull()
  })

  it('answers a ping with a pong carrying the same t', async () => {
    const { client, sockets } = harness()
    client.start(CREDENTIAL)
    await tick()
    sockets[0]!.accept()
    sockets[0]!.deliver(welcome())
    sockets[0]!.deliver({ type: 'ping', t: 1717171717.5 })
    expect(sockets[0]!.frame('pong')).toEqual({ type: 'pong', t: 1717171717.5 })
  })

  it('hands back the same snapshot object until something changes', async () => {
    const { client, sockets } = harness()
    const before = client.getSnapshot()
    expect(client.getSnapshot()).toBe(before)
    client.start(CREDENTIAL)
    await tick()
    sockets[0]!.accept()
    sockets[0]!.deliver(welcome())
    const after = client.getSnapshot()
    expect(after).not.toBe(before)
    expect(client.getSnapshot()).toBe(after)
  })
})

describe('a dispatched run', () => {
  it('reports progress and completes, with the attempt token on every frame', async () => {
    const { client, sockets } = harness()
    client.start(CREDENTIAL)
    await tick()
    const socket = sockets[0]!
    socket.accept()
    socket.deliver(welcome())
    socket.deliver(dispatch())
    await tick()

    const types = socket.frames().map((frame) => frame.type)
    expect(types).toEqual(['hello', 'run_progress', 'run_progress', 'run_complete'])
    for (const frame of socket.frames().filter((entry) => entry.type !== 'hello')) {
      expect(frame.run_id).toBe(42)
      expect(frame.attempt_token).toBe('attempt-abc')
    }

    const complete = socket.frame('run_complete')!
    const evals = complete.evals as Record<string, unknown>[]
    expect(evals).toHaveLength(1)
    expect(evals[0]).toMatchObject({ ply: 0, move_uci: 'f2f3', position_id: 10 })
    // The row is unattached: `complete_run` binds it to the run the server thinks is
    // current, so a `run_id` on it would defeat the point.
    expect(evals[0]).not.toHaveProperty('run_id')
    expect(client.getSnapshot().activeRuns).toBe(0)
  })

  it('ignores a second dispatch of a run already on its slot', async () => {
    const search = deferred<AnalysisResult>()
    const { client, sockets } = harness(() => search.promise)
    client.start(CREDENTIAL)
    await tick()
    const socket = sockets[0]!
    socket.accept()
    socket.deliver(welcome())
    socket.deliver(dispatch())
    await tick()
    socket.deliver(dispatch({ attempt_token: 'attempt-second' }))
    await tick()

    expect(client.getSnapshot().activeRuns).toBe(1)
    const tokens = new Set(
      socket
        .frames()
        .filter((frame) => frame.type === 'run_progress')
        .map((frame) => frame.attempt_token),
    )
    expect([...tokens]).toEqual(['attempt-abc'])
  })

  it('keeps beating while one position takes a long time', async () => {
    const search = deferred<AnalysisResult>()
    const { client, sockets } = harness(() => search.promise)
    client.start(CREDENTIAL)
    await tick()
    const socket = sockets[0]!
    socket.accept()
    socket.deliver(welcome({ heartbeat_seconds: 5 }))
    socket.deliver(dispatch())
    await tick()

    const before = socket.frames().filter((frame) => frame.type === 'run_progress').length
    vi.advanceTimersByTime(11_000)
    const after = socket.frames().filter((frame) => frame.type === 'run_progress').length
    expect(after).toBeGreaterThan(before)
    search.settle(RESULT)
    await tick()
  })

  it('stops the search on a cancel and answers run_cancelled', async () => {
    const search = deferred<AnalysisResult>()
    const { client, sockets, engine } = harness(() => search.promise)
    client.start(CREDENTIAL)
    await tick()
    const socket = sockets[0]!
    socket.accept()
    socket.deliver(welcome())
    socket.deliver(dispatch())
    await tick()

    socket.deliver({ type: 'run_cancel', run_id: 42, reason: 'requeued' })
    expect(socket.frame('run_cancelled')).toEqual({ type: 'run_cancelled', run_id: 42 })
    expect(engine.stopSearch).toHaveBeenCalled()
    expect(client.getSnapshot().activeRuns).toBe(0)

    // Whatever the abandoned search eventually answers is never reported.
    search.settle(RESULT)
    await tick()
    expect(socket.frame('run_complete')).toBeUndefined()
  })

  it('fails a plan that does not decode, with no retry', async () => {
    const { client, sockets } = harness()
    client.start(CREDENTIAL)
    await tick()
    const socket = sockets[0]!
    socket.accept()
    socket.deliver(welcome())
    socket.deliver(dispatch({ plan: { run_id: 42 } }))
    await tick()

    expect(socket.frame('run_failed')).toMatchObject({
      run_id: 42,
      attempt_token: 'attempt-abc',
      retry: false,
    })
  })
})

describe('an analysis board', () => {
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

  const SNAPSHOT: SearchSnapshot = {
    depth: 18,
    nodes: 4_200_000,
    nps: 4_200_000,
    timeMs: 1_000,
    lines: [{ multipv: 1, cp: 32, mate: null, pv: ['e2e4', 'e7e5'] }],
  }

  function open(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      type: 'stream_open',
      session_id: 'sess-1',
      engine: ENGINE_NAME,
      fen: START,
      multipv: 3,
      interval_ms: 500,
      ...extra,
    }
  }

  /** A welcomed client with its socket, ready to be handed a board. */
  async function connected(
    analyse: () => Promise<AnalysisResult> = () => Promise.resolve(RESULT),
    autoStart = true,
  ) {
    const kit = harness(analyse, autoStart)
    kit.client.start(CREDENTIAL)
    await tick()
    const socket = kit.sockets[0]!
    socket.accept()
    socket.deliver(welcome())
    return { ...kit, socket }
  }

  it('starts, reports throttled snapshots, and answers a close', async () => {
    const { socket, boards } = await connected()
    socket.deliver(open())
    await tick()

    expect(socket.frame('stream_started')).toEqual({
      type: 'stream_started',
      session_id: 'sess-1',
      engine: ENGINE_NAME,
    })
    const board = boards[0]!
    expect(board.fen).toBe(START)
    // `stream_open`'s own numbers, not this runner's defaults.
    expect(board.options.multipv).toBe(3)
    expect(board.options.intervalMs).toBe(500)

    // The engine throttles; the client numbers what comes out of it and sends it on.
    board.options.onSnapshot(SNAPSHOT)
    board.options.onSnapshot({ ...SNAPSHOT, depth: 19 })
    const snapshots = socket.frames().filter((frame) => frame.type === 'stream_snapshot')
    expect(snapshots.map((frame) => frame.seq)).toEqual([1, 2])
    expect(snapshots[0]).toEqual({
      type: 'stream_snapshot',
      session_id: 'sess-1',
      seq: 1,
      depth: 18,
      nodes: 4_200_000,
      nps: 4_200_000,
      time_ms: 1_000,
      // `MoveEval.best_lines`' own shape, from the side to move. No UCI text anywhere.
      lines: [{ multipv: 1, cp: 32, mate: null, pv: ['e2e4', 'e7e5'] }],
    })

    socket.deliver({ type: 'stream_close', session_id: 'sess-1', reason: 'closed' })
    expect(board.aborted()).toBe(true)
    expect(socket.frame('stream_closed')).toEqual({
      type: 'stream_closed',
      session_id: 'sess-1',
      reason: 'closed',
      error: null,
    })
  })

  it('restarts on the same slot instead of tearing the session down', async () => {
    const { socket, boards } = await connected()
    socket.deliver(open())
    await tick()

    socket.deliver({ type: 'stream_restart', session_id: 'sess-1', fen: AFTER_E4, multipv: 2 })
    // The window this restart opened has to pass before the engine is asked again.
    await vi.advanceTimersByTimeAsync(200)
    await tick()

    expect(boards).toHaveLength(2)
    expect(boards[1]!.fen).toBe(AFTER_E4)
    expect(boards[1]!.options.multipv).toBe(2)
    // The board on the other end is the board it was: no teardown, and no second start.
    expect(socket.frames().filter((frame) => frame.type === 'stream_started')).toHaveLength(1)
    expect(socket.frame('stream_closed')).toBeUndefined()

    // And `seq` keeps counting across the restart, because the session did not end.
    boards[1]!.options.onSnapshot(SNAPSHOT)
    expect(socket.frames().filter((frame) => frame.type === 'stream_snapshot').at(-1)?.seq).toBe(1)
  })

  it('coalesces a burst of restarts into one search on the newest position', async () => {
    const { socket, boards } = await connected()
    socket.deliver(open())
    await tick()

    for (const fen of [AFTER_E4, START, AFTER_E4]) {
      socket.deliver({ type: 'stream_restart', session_id: 'sess-1', fen })
      await tick()
    }
    await vi.advanceTimersByTimeAsync(200)
    await tick()

    // One `stop`/`go` for the burst, not one per click.
    expect(boards).toHaveLength(2)
    expect(boards[1]!.fen).toBe(AFTER_E4)
  })

  it('refuses a session for an engine this runner does not have', async () => {
    const { socket, boards } = await connected()
    socket.deliver(open({ engine: 'sf-remote' }))
    await tick()

    expect(boards).toHaveLength(0)
    expect(socket.frame('stream_closed')).toMatchObject({
      session_id: 'sess-1',
      reason: 'engine_failed',
      error: 'sf-remote is not an engine this runner streams on',
    })
  })

  it('refuses a second board, because there is one engine and one slot', async () => {
    const { socket, boards } = await connected()
    socket.deliver(open())
    await tick()
    socket.deliver(open({ session_id: 'sess-2' }))
    await tick()

    expect(boards).toHaveLength(1)
    expect(socket.frame('stream_closed')).toMatchObject({
      session_id: 'sess-2',
      reason: 'engine_failed',
    })
    // The first session is untouched: a refusal for one board is not a close for another.
    expect(boards[0]!.aborted()).toBe(false)
  })

  it('says so when the engine stops searching a position by itself', async () => {
    const { socket, boards } = await connected()
    socket.deliver(open())
    await tick()

    boards[0]!.end(true)
    await tick()

    expect(socket.frame('stream_closed')).toMatchObject({
      session_id: 'sess-1',
      reason: 'engine_failed',
      error: 'the engine stopped searching this position',
    })
  })
})

describe('one slot, a run and a board', () => {
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

  function open(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      type: 'stream_open',
      session_id: 'sess-1',
      engine: ENGINE_NAME,
      fen: START,
      multipv: 1,
      interval_ms: 500,
      ...extra,
    }
  }

  it('waits for the slot a preempted run is still holding, and never touches the run', async () => {
    // `reserve_slot` has already taken the slot off the run and refunded its attempt; the
    // `run_cancel` is on its way. Ending the run here would spend that attempt again.
    const search = deferred<AnalysisResult>()
    const { client, sockets, boards } = harness(() => search.promise, false)
    client.start(CREDENTIAL)
    await tick()
    const socket = sockets[0]!
    socket.accept()
    socket.deliver(welcome())
    socket.deliver(dispatch())
    await tick()

    socket.deliver(open())
    await tick()

    expect(client.getSnapshot().activeRuns).toBe(1)
    expect(socket.frame('run_failed')).toBeUndefined()
    expect(socket.frame('run_cancelled')).toBeUndefined()
    // Queued for the slot, so nothing has been promised to the board yet.
    expect(socket.frame('stream_started')).toBeUndefined()

    // The cancel arrives, the run lets go, and the board gets the engine.
    socket.deliver({ type: 'run_cancel', run_id: 42, reason: 'preempted' })
    search.settle(RESULT)
    await tick()
    boards[0]!.start()

    expect(socket.frame('stream_started')).toMatchObject({ session_id: 'sess-1' })
    expect(socket.frame('run_complete')).toBeUndefined()
  })

  it('gives up on a slot that never comes free rather than leaving a board waiting', async () => {
    const search = deferred<AnalysisResult>()
    const { client, sockets } = harness(() => search.promise, false)
    client.start(CREDENTIAL)
    await tick()
    const socket = sockets[0]!
    socket.accept()
    socket.deliver(welcome())
    socket.deliver(dispatch())
    await tick()
    socket.deliver(open())
    await tick()

    await vi.advanceTimersByTimeAsync(20_000)
    await tick()

    expect(socket.frame('stream_closed')).toMatchObject({
      session_id: 'sess-1',
      reason: 'engine_failed',
    })
    expect(String(socket.frame('stream_closed')!.error)).toContain('never got the slot')
    // The run it was waiting behind is still the run it was.
    expect(client.getSnapshot().activeRuns).toBe(1)
    search.settle(RESULT)
    await tick()
  })

  it('refuses a dispatch that arrives while a board holds the engine', async () => {
    const { client, sockets, boards } = await (async () => {
      const kit = harness()
      kit.client.start(CREDENTIAL)
      await tick()
      kit.sockets[0]!.accept()
      kit.sockets[0]!.deliver(welcome())
      return kit
    })()
    const socket = sockets[0]!
    socket.deliver(open())
    await tick()

    socket.deliver(dispatch())
    await tick()

    // Straight back to the queue, rather than silently waiting behind an open-ended search
    // until the stale sweep collected it.
    expect(socket.frame('run_failed')).toMatchObject({
      run_id: 42,
      attempt_token: 'attempt-abc',
      retry: true,
    })
    expect(client.getSnapshot().activeRuns).toBe(0)
    expect(boards[0]!.aborted()).toBe(false)
  })

  it('gives the board up when the link drops, and claims nothing about it on the way back', async () => {
    const { client, sockets, boards } = await (async () => {
      const kit = harness()
      kit.client.start(CREDENTIAL)
      await tick()
      kit.sockets[0]!.accept()
      kit.sockets[0]!.deliver(welcome())
      return kit
    })()
    sockets[0]!.deliver(open())
    await tick()

    sockets[0]!.hangUp(1006)
    // The server ends the session itself on `runner.disconnected`, so there is nothing to
    // say — but the engine must stop, or it holds the slot for nobody.
    expect(boards[0]!.aborted()).toBe(true)
    expect(sockets[0]!.frame('stream_closed')).toBeUndefined()

    vi.advanceTimersByTime(1_000)
    await tick()
    sockets[1]!.accept()
    await tick()
    expect(sockets[1]!.frames()[0]!.type).toBe('hello')
    expect(client.getSnapshot().phase).toBe('connecting')
  })

  it('stops the board when the tab closes', async () => {
    const { client, sockets, boards } = await (async () => {
      const kit = harness()
      kit.client.start(CREDENTIAL)
      await tick()
      kit.sockets[0]!.accept()
      kit.sockets[0]!.deliver(welcome())
      return kit
    })()
    sockets[0]!.deliver(open())
    await tick()

    client.shutdown()

    expect(boards[0]!.aborted()).toBe(true)
  })
})

describe('an engine that will not start', () => {
  it('names cross-origin isolation as the cause, and does not dial', async () => {
    // The environment these tests run in is not isolated, which is exactly the case the
    // owner hits behind a proxy that strips COOP/COEP. The browser's own message for it
    // ("shared memory is not enabled") names neither the header nor the proxy, so the hint
    // is appended — a fallback that fails must at least say what to fix.
    const { client, sockets } = harnessWith(() =>
      Promise.reject(new Error('SharedArrayBuffer is not defined')),
    )
    client.start(CREDENTIAL)
    await tick()

    const state = client.getSnapshot()
    expect(state.phase).toBe('refused')
    expect(state.error?.code).toBe('engine_failed')
    expect(state.error?.message).toContain('SharedArrayBuffer is not defined')
    expect(state.error?.message).toContain('cross-origin isolated')
    expect(state.error?.message).toContain('proxy')
    expect(sockets).toHaveLength(0)
  })
})

describe('a dropped link', () => {
  it('retries with backoff and tells the gateway what it is still executing', async () => {
    const search = deferred<AnalysisResult>()
    const { client, sockets } = harness(() => search.promise)
    client.start(CREDENTIAL)
    await tick()
    sockets[0]!.accept()
    sockets[0]!.deliver(welcome())
    sockets[0]!.deliver(dispatch())
    await tick()

    sockets[0]!.hangUp(1006, '')
    expect(client.getSnapshot().phase).toBe('retrying')
    expect(client.getSnapshot().error?.code).toBe('disconnected')
    // The run keeps computing: the reconnect is what resumes it, not a restart.
    expect(client.getSnapshot().activeRuns).toBe(1)

    vi.advanceTimersByTime(600)
    await tick()
    expect(sockets).toHaveLength(2)
    sockets[1]!.accept()
    expect(sockets[1]!.frames()[0]!.active_runs).toEqual([
      { run_id: 42, attempt_token: 'attempt-abc' },
    ])
    search.settle(RESULT)
    await tick()
  })
})

describe('a refusal', () => {
  const cases: [number, string, string][] = [
    [4401, 'unauthorized', 'does not know'],
    [4403, 'revoked', 'has been revoked'],
    [4409, 'duplicate_connection', 'already connected'],
    [4426, 'proto_mismatch', 'same runner protocol'],
    [4429, 'rate_limited', 'holds the door shut'],
  ]

  it.each(cases)('surfaces %i distinctly and does not dial again', async (code, name, phrase) => {
    const { client, sockets } = harness()
    client.start(CREDENTIAL)
    await tick()
    sockets[0]!.accept()
    sockets[0]!.hangUp(code, '')

    const state = client.getSnapshot()
    expect(state.phase).toBe('refused')
    expect(state.error?.code).toBe(name)
    expect(state.error?.message).toContain(phrase)

    // Nothing about this token changes by asking again, and for 4429 asking is the problem.
    vi.advanceTimersByTime(120_000)
    await tick()
    expect(sockets).toHaveLength(1)
  })

  it('gives every refusal its own words', async () => {
    const messages = new Set<string>()
    for (const [code] of cases) {
      const { client, sockets } = harness()
      client.start(CREDENTIAL)
      await tick()
      sockets[0]!.accept()
      sockets[0]!.hangUp(code, '')
      messages.add(client.getSnapshot().error!.message)
    }
    // Five codes, five sentences: "the socket closed" is what a shared message would say.
    expect(messages.size).toBe(cases.length)
  })
})

describe('the credential', () => {
  it('is stored on start and only forgotten on forget', async () => {
    const { client, entries } = harness()
    client.start(CREDENTIAL)
    await tick()
    expect([...entries.values()][0]).toContain('bb_rnr_secret')

    client.stop()
    expect([...entries.values()][0]).toContain('bb_rnr_secret')
    expect(client.getSnapshot().phase).toBe('off')

    client.forget()
    expect([...entries.values()]).toEqual([])
    expect(client.getSnapshot().runnerId).toBeNull()
  })

  it('resumes from what is stored, and is a no-op when nothing is', async () => {
    const { client, sockets, entries } = harness()
    client.resume()
    await tick()
    expect(sockets).toHaveLength(0)

    entries.set(credentialKey(), JSON.stringify(CREDENTIAL))
    client.resume()
    await tick()
    expect(sockets).toHaveLength(1)
  })
})

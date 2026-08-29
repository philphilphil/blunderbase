import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  startEngine,
  type BrowserEngine,
  type InfiniteSearchOptions,
  type StockfishModule,
} from './engine'
import type { SearchSnapshot } from './search'
import type { RunnerEnvironment } from './support'

/**
 * The engine is driven against a fake module that speaks the *real* build's text.
 *
 * Every line below was captured from `sf_18_smallnet` under node. Nothing here loads a
 * WebAssembly module: an engine that takes seconds to start and 15 MB of weights to
 * evaluate has no place in a unit suite, and the only thing worth checking at this level is
 * that the UCI conversation is read the way python-chess reads it.
 */
const HANDSHAKE = [
  'id name Stockfish 18',
  'id author the Stockfish developers (see AUTHORS file)',
  'option name Debug Log File type string default <empty>',
  'option name Threads type spin default 1 min 1 max 1024',
  'option name Hash type spin default 16 min 1 max 2048',
  'option name Ponder type check default false',
  'option name MultiPV type spin default 1 min 1 max 256',
  'option name UCI_Chess960 type check default false',
  'option name EvalFile type string default nn-4ca89e4b3abf.nnue',
  'uciok',
]

const SEARCH = [
  'info string NNUE evaluation using nn-4ca89e4b3abf.nnue',
  'info depth 1 seldepth 1 multipv 1 score cp 18 nodes 20 nps 20000 time 1 pv e2e4',
  'info depth 12 seldepth 24 multipv 1 score cp 35 nodes 200196 nps 1588857 hashfull 71 ' +
    'tbhits 0 time 126 pv e2e4 e7e5 g1f3 b8c6',
  'info depth 12 seldepth 20 multipv 2 score cp 28 nodes 200196 time 126 pv d2d4 d7d5',
  'bestmove e2e4 ponder e7e5',
]

class FakeModule implements StockfishModule {
  listen: (line: string) => void = () => {}
  onError: (message: string) => void = () => {}
  readonly commands: string[] = []
  readonly nets: { name: string; slot: number; bytes: number }[] = []
  /** What `go` answers with; a test may swap it. */
  search = SEARCH
  /**
   * When set, a bounded `go` reports its `info` lines but does not finish: the `bestmove`
   * waits for a `stop`, which is what a deep position still being searched looks like.
   */
  hold = false

  private readonly netNames: string[]

  constructor(netNames: string[] = ['nn-4ca89e4b3abf.nnue']) {
    this.netNames = netNames
  }

  uci(command: string): void {
    this.commands.push(command)
    if (command === 'uci') this.emit(HANDSHAKE)
    else if (command === 'isready') this.emit(['readyok'])
    // An open-ended search says nothing until the test says it does, which is what an
    // engine that is still thinking looks like. `stop` is what brings its `bestmove` out.
    else if (command === 'go infinite') return
    else if (command === 'stop') this.emit(['bestmove e2e4'])
    else if (command.startsWith('go')) {
      this.emit(this.hold ? this.search.filter((line) => !line.startsWith('bestmove')) : this.search)
    }
  }

  /** The engine saying something of the test's choosing, mid-search. */
  say(...lines: string[]): void {
    this.emit(lines)
  }

  setNnueBuffer(data: Uint8Array, index = 0): void {
    this.nets.push({ name: this.netNames[index] ?? '?', slot: index, bytes: data.length })
  }

  getRecommendedNnue(index = 0): string | undefined {
    return this.netNames[index]
  }

  private emit(lines: string[]): void {
    for (const line of lines) this.listen(line)
  }
}

/**
 * A capable browser, stated rather than detected: the logic project runs under node, which
 * has neither `Worker` nor `crossOriginIsolated`, so a test that read the real environment
 * would be testing node rather than the engine.
 */
const BROWSER: RunnerEnvironment = {
  WebAssembly: {},
  WebSocket: class {},
  Worker: class {},
  crossOriginIsolated: true,
  navigator: { hardwareConcurrency: 12 },
}

async function boot(module = new FakeModule(), env: RunnerEnvironment = BROWSER) {
  const engine = await startEngine({
    load: () =>
      Promise.resolve((config: Record<string, unknown> = {}) => {
        module.listen = config.listen as (line: string) => void
        module.onError = config.onError as (message: string) => void
        return Promise.resolve(module)
      }),
    loadNet: () => Promise.resolve(new Uint8Array(64)),
    env,
  })
  return { engine, module }
}

describe('startEngine', () => {
  it('builds declared_options from the handshake and stores no managed option', async () => {
    const { engine } = await boot()
    expect(engine.version).toBe('Stockfish 18')

    const byName = new Map(engine.declaredOptions.map((option) => [option.name, option]))
    expect(byName.get('MultiPV')?.managed).toBe(true)
    expect(byName.get('Ponder')?.managed).toBe(true)
    expect(byName.get('UCI_Chess960')?.managed).toBe(true)
    expect(byName.get('Threads')?.managed).toBe(false)

    // The advertisement's `options` are what `validate_options` checks, and a managed one
    // there has the whole engine refused.
    expect(engine.options).toEqual({ Threads: 8 })
    expect(Object.keys(engine.options)).not.toContain('MultiPV')
  })

  it('takes a thread per core, up to the cap', async () => {
    const { engine, module } = await boot()
    expect(engine.isolated).toBe(true)
    expect(engine.threads).toBe(8)
    expect(module.commands).toContain('setoption name Threads value 8')
  })

  it('runs on one thread when the page is not cross-origin isolated', async () => {
    const { engine, module } = await boot(new FakeModule(), { ...BROWSER, crossOriginIsolated: false })
    expect(engine.isolated).toBe(false)
    expect(engine.threads).toBe(1)
    expect(module.commands).toContain('setoption name Threads value 1')
  })

  it('loads every net the build recommends, and only those', async () => {
    const single = await boot()
    expect(single.module.nets).toEqual([{ name: 'nn-4ca89e4b3abf.nnue', slot: 0, bytes: 64 }])

    const dual = await boot(new FakeModule(['nn-big.nnue', 'nn-small.nnue']))
    expect(dual.module.nets.map((net) => net.slot)).toEqual([0, 1])
  })
})

describe('analyse', () => {
  it('reads the search the way StockfishAdapter does', async () => {
    const { engine, module } = await boot()
    const result = await engine.analyse(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      { nodes: 200_000, depth: null },
      { multipv: 2, chess960: false },
    )

    expect(module.commands).toContain('setoption name MultiPV value 2')
    expect(module.commands).toContain(
      'position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    )
    expect(module.commands).toContain('go nodes 200000')

    // The last `info` per rank wins, `info string` is ignored, and the score is White's.
    expect(result.score).toEqual({ cp: 35, mateIn: null, foldedCp: 35 })
    expect(result.depth).toBe(12)
    expect(result.nodes).toBe(200196)
    expect(result.candidates).toEqual([
      { rank: 1, uci: 'e2e4', score: { cp: 35, mateIn: null, foldedCp: 35 }, pv: ['e2e4', 'e7e5', 'g1f3', 'b8c6'] },
      { rank: 2, uci: 'd2d4', score: { cp: 28, mateIn: null, foldedCp: 28 }, pv: ['d2d4', 'd7d5'] },
    ])
  })

  it('flips a Black-to-move score into White’s frame', async () => {
    const module = new FakeModule()
    module.search = ['info depth 10 multipv 1 score cp 60 nodes 500 pv e7e5', 'bestmove e7e5']
    const { engine } = await boot(module)
    const result = await engine.analyse(
      'rnbqkbnr/pppppppp/8/8/8/5P2/PPPPP1PP/RNBQKBNR b KQkq - 0 1',
      { nodes: 500, depth: null },
      { multipv: 1, chess960: false },
    )
    expect(result.score).toEqual({ cp: -60, mateIn: null, foldedCp: -60 })
  })

  it('drops a line whose own first move the position refuses', async () => {
    const module = new FakeModule()
    module.search = [
      'info depth 8 multipv 1 score cp 10 nodes 100 pv e2e4 e7e5',
      'info depth 8 multipv 2 score cp 5 nodes 100 pv h1h8',
      'bestmove e2e4',
    ]
    const { engine } = await boot(module)
    const result = await engine.analyse(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      { nodes: 100, depth: null },
      { multipv: 2, chess960: false },
    )
    expect(result.candidates.map((candidate) => candidate.rank)).toEqual([1])
  })

  it('truncates a variation at twelve plies and at the first move that will not replay', async () => {
    const module = new FakeModule()
    const long = [
      'e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6',
      'e1g1', 'f8e7', 'f1e1', 'b7b5', 'a4b3', 'd7d6',
    ]
    module.search = [
      `info depth 20 multipv 1 score cp 30 nodes 900 pv ${long.join(' ')}`,
      'bestmove e2e4',
    ]
    const { engine } = await boot(module)
    const result = await engine.analyse(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      { nodes: 900, depth: 20 },
      { multipv: 1, chess960: false },
    )
    expect(module.commands).toContain('go nodes 900 depth 20')
    // Twelve plies, and castling spelled the way python-chess spells it outside Chess960.
    expect(result.candidates[0]!.pv).toEqual(long.slice(0, 12))
    expect(result.candidates[0]!.pv).toContain('e1g1')
  })

  it('refuses a search once the engine has reported an error', async () => {
    const module = new FakeModule()
    const { engine } = await boot(module)
    module.onError('out of memory')
    await expect(
      engine.analyse('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { nodes: 10, depth: null }, { multipv: 1, chess960: false }),
    ).rejects.toThrow('out of memory')
  })

  it('refuses a position nothing can read', async () => {
    const { engine } = await boot()
    await expect(
      engine.analyse('not a fen', { nodes: 10, depth: null }, { multipv: 1, chess960: false }),
    ).rejects.toThrow('not a fen')
  })
})

describe('searchInfinite', () => {
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

  function board(
    engine: BrowserEngine,
    over: Partial<InfiniteSearchOptions> & { fen?: string } = {},
  ) {
    const { fen = START, ...rest } = over
    const stop = new AbortController()
    const snapshots: SearchSnapshot[] = []
    let started = 0
    const ended = engine.searchInfinite(fen, {
      multipv: 2,
      chess960: false,
      intervalMs: 500,
      signal: stop.signal,
      onStarted: () => {
        started += 1
      },
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      ...rest,
    })
    return { stop, snapshots, ended, started: () => started }
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('goes open-ended, says when it started, and stops on the signal', async () => {
    const { engine, module } = await boot()
    const search = board(engine)
    await vi.advanceTimersByTimeAsync(0)

    expect(module.commands).toContain(`position fen ${START}`)
    expect(module.commands).toContain('go infinite')
    expect(search.started()).toBe(1)

    search.stop.abort()
    await expect(search.ended).resolves.toBe(false)
    // The `bestmove` was waited for, so the module is idle and the next search can have it.
    expect(module.commands.filter((command) => command === 'stop')).toHaveLength(1)
  })

  it('hands over the first picture at once and throttles the rest', async () => {
    const { engine, module } = await boot()
    const search = board(engine)
    await vi.advanceTimersByTimeAsync(0)

    module.say('info depth 6 multipv 1 score cp 20 nodes 900 nps 90000 time 10 pv e2e4 e7e5')
    // A board must not be blank for half a second before its first evaluation appears.
    expect(search.snapshots).toHaveLength(1)

    module.say('info depth 7 multipv 1 score cp 24 nodes 1800 nps 90000 time 20 pv d2d4 d7d5')
    expect(search.snapshots).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(500)
    expect(search.snapshots).toHaveLength(2)
    expect(search.snapshots[1]).toMatchObject({ depth: 7, nodes: 1800, nps: 90000, timeMs: 20 })

    search.stop.abort()
    await search.ended
  })

  it('merges the ranks of one depth into one picture, in `best_lines` shape', async () => {
    const { engine, module } = await boot()
    const search = board(engine)
    await vi.advanceTimersByTimeAsync(0)

    module.say(
      'info depth 12 multipv 1 score cp 35 nodes 200196 nps 1588857 time 126 pv e2e4 e7e5 g1f3',
      'info depth 12 multipv 2 score cp 28 nodes 200196 nps 1588857 time 126 pv d2d4 d7d5',
    )
    await vi.advanceTimersByTimeAsync(500)

    const last = search.snapshots.at(-1)!
    expect(last.lines).toEqual([
      { multipv: 1, cp: 35, mate: null, pv: ['e2e4', 'e7e5', 'g1f3'] },
      { multipv: 2, cp: 28, mate: null, pv: ['d2d4', 'd7d5'] },
    ])

    search.stop.abort()
    await search.ended
  })

  it('says the engine stopped by itself when a `bestmove` arrives unasked', async () => {
    const { engine, module } = await boot()
    const search = board(engine)
    await vi.advanceTimersByTimeAsync(0)

    module.say('info depth 1 multipv 1 score mate 0 nodes 1 pv e2e4', 'bestmove (none)')

    await expect(search.ended).resolves.toBe(true)
    expect(module.commands).not.toContain('stop')
    // Whatever the last burst merged into is still worth showing.
    expect(search.snapshots).toHaveLength(1)
  })

  it('never sends a `go` for a session that was closed before it got the slot', async () => {
    const { engine, module } = await boot()
    const stop = new AbortController()
    stop.abort()
    const ended = engine.searchInfinite(START, {
      multipv: 1,
      chess960: false,
      intervalMs: 500,
      signal: stop.signal,
      onSnapshot: () => {},
    })

    await expect(ended).resolves.toBe(false)
    expect(module.commands).not.toContain('go infinite')
  })

  it('keeps a run’s cancel off a board’s search', async () => {
    // One module, one `go`, and UCI has no request ids: during a preemption the board's
    // `go infinite` and the outgoing run's cancel are both in flight, and a bare `stop`
    // would end the board the preemption was for.
    const { engine, module } = await boot()
    const search = board(engine)
    await vi.advanceTimersByTimeAsync(0)

    engine.stopSearch()

    expect(module.commands).not.toContain('stop')
    search.stop.abort()
    await expect(search.ended).resolves.toBe(false)
  })

  it('waits for the position the run is on, and takes the slot the moment it is free', async () => {
    // One module, one `go`: a board that arrives while a run is mid-analysis queues behind
    // the position in flight rather than interrupting it. That is the whole reason the
    // client can leave the run alone and let the server's `run_cancel` do the preempting.
    const { engine, module } = await boot()
    module.hold = true
    const run = engine.analyse(START, { nodes: 1000, depth: null }, { multipv: 1, chess960: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(module.commands).toContain('go nodes 1000')

    const search = board(engine, { multipv: 1 })
    await vi.advanceTimersByTimeAsync(0)
    expect(search.started()).toBe(0)
    expect(module.commands).not.toContain('go infinite')

    // The cancel's `stop` brings the run's `bestmove` forward, and the slot passes on.
    engine.stopSearch()
    await run
    await vi.advanceTimersByTimeAsync(0)

    expect(search.started()).toBe(1)
    expect(module.commands).toContain('go infinite')
    search.stop.abort()
    await search.ended
  })

  it('refuses a position nothing can read', async () => {
    const { engine } = await boot()
    await expect(
      engine.searchInfinite('not a fen', {
        multipv: 1,
        chess960: false,
        intervalMs: 500,
        signal: new AbortController().signal,
        onSnapshot: () => {},
      }),
    ).rejects.toThrow('not a fen')
  })
})

/**
 * The Stockfish that runs inside the tab: loading it, talking UCI to it, and turning what
 * it says into `search.ts`'s vocabulary.
 *
 * This is `adapters/stockfish.py` for a browser. It is deliberately the only file here that
 * knows the module exists — `plan.ts` takes a `Searcher` and never learns whether the thing
 * behind it is a WebAssembly build, a subprocess or a test double, which is what lets the
 * whole port be tested without ever instantiating 15 MB of neural network.
 *
 * Three things about the build itself, all of which have bitten somebody already:
 *
 * - **The three files are fetched by URL, unhashed, same-origin.** `vite-engine-assets.ts`
 *   publishes them at `/engine/<name>`; the glue resolves its own `.wasm` relative to its
 *   `import.meta.url`, and the *net's* name comes from the engine itself. Under COEP
 *   (`api/web.py` serves `require-corp`) a cross-origin fetch would be blocked outright, so
 *   same-origin is not a preference here — it is the only thing that works.
 * - **The nets are asked for, not named.** The package's own comment reads "0 for big, 1
 *   for small", which makes slot 1 look right for a build called `sf_18_smallnet`. It is
 *   not: the dual-slot split belongs to the full `sf_18` build, and the smallnet target
 *   has exactly one net, in slot 0 — `getRecommendedNnue(1)` answers `undefined` there.
 *   So the slots are walked from 0 until the build recommends no more, which is what
 *   lichess does and what survives swapping the build for a dual-net one. Hardcoding
 *   either slot would be an engine that silently evaluates with half its network.
 * - **Threads need cross-origin isolation.** A shared `WebAssembly.Memory` is a
 *   `SharedArrayBuffer`, which a browser hands out only to an isolated document. The count
 *   is therefore derived from `crossOriginIsolated` and *reported*, never assumed — a tab
 *   quietly running one thread where the owner expected eight is a tab that looks broken
 *   and is not.
 */
import type { Chess } from 'chessops/chess'

import { positionFrom, readUci, truncateLine, writeUci } from './board'
import { SnapshotBuffer } from './snapshots'
import { browserRunnerSupport, threadPlan, type RunnerEnvironment } from './support'
import {
  MATE_SCORE,
  PV_PLIES,
  whiteScore,
  type AnalysisResult,
  type Candidate,
  type Score,
  type SearchLimit,
  type SearchOptions,
  type SearchSnapshot,
  type Searcher,
} from './search'
import { isBestMoveLine, parseIdName, parseInfo, parseOption, type UciOption } from './uci'

/** `scripts/engine-assets.mjs: ENGINE_BUILD`. The two are edited together or not at all. */
export const ENGINE_BUILD = 'sf_18_smallnet'

/**
 * `EngineAd.path`. Not a filesystem path and deliberately not shaped like one: the server
 * asks `services/engines.is_binary_path` about every stored path, and the `wasm:` scheme is
 * what tells it this engine lives inside the runner that advertised it and must never be
 * started here.
 */
export const ENGINE_PATH = 'wasm:stockfish-18'

/** What `EngineAd.version` carries when the build's own `id name` is unreadable. */
export const ENGINE_VERSION = 'Stockfish 18 (WASM)'

/** A handshake that never finishes is a broken build, not a slow one. */
const HANDSHAKE_TIMEOUT_MS = 60_000

/**
 * The open-ended search an analysis board is.
 *
 * Spelled out as a constant because it is also an identity: one module runs one search at a
 * time, a run and a board can both be in flight during a preemption, and `Driver.stop` uses
 * this string to tell whose `bestmove` a `stop` would be bringing forward.
 */
const INFINITE = 'go infinite'

/** The engine could not be started, or did not answer usably. `stockfish.py: EngineError`. */
export class BrowserEngineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BrowserEngineError'
  }
}

/** The half of `@lichess-org/stockfish-web`'s module this file drives. */
export interface StockfishModule {
  uci(command: string): void
  setNnueBuffer(data: Uint8Array, index?: number): void
  getRecommendedNnue(index?: number): string | undefined
  listen: (line: string) => void
  onError: (message: string) => void
}

/** What the emscripten glue's default export is: a factory, awaited once. */
export type StockfishFactory = (moduleArg?: Record<string, unknown>) => Promise<StockfishModule>

/** What an analysis board asks for: a search with no bound, reported as it goes. */
export interface InfiniteSearchOptions extends SearchOptions {
  /** How often at most a picture is handed over. `stream_open.interval_ms`. */
  intervalMs: number
  /**
   * Called once `go infinite` has actually gone to the engine — which, on this one module,
   * is the moment the slot is genuinely held rather than queued for. The `stream_started`
   * the server is waiting for is sent from here, exactly as the Python runner sends it
   * once the pool has handed its task an engine.
   */
  onStarted?: () => void
  onSnapshot: (snapshot: SearchSnapshot) => void
  /**
   * Aborting ends the search and settles the promise; it never rejects it. One signal per
   * `go`, so a restart is a fresh one — `client.py`'s `stream.stop = threading.Event()`
   * at the top of each turn round the loop.
   */
  signal: AbortSignal
}

export interface BrowserEngine extends Searcher {
  /** The build's own `id name`, or `ENGINE_VERSION` if it declared none. */
  readonly version: string
  /** How many threads it was actually configured with. */
  readonly threads: number
  /** Whether the document is cross-origin isolated — the reason `threads` is what it is. */
  readonly isolated: boolean
  /** Every `option name …` the handshake declared, for the advertisement. */
  readonly declaredOptions: UciOption[]
  /** The options this engine is *set* to, which the advertisement has to match. */
  readonly options: Record<string, number>
  /**
   * Ask the current *bounded* search to end early. The engine still answers with a
   * `bestmove`, so the pending `analyse` settles normally and the slot is free for the next
   * dispatch — which is what a `run_cancel` needs, since abandoning the plan loop alone
   * would leave a deep `go` running and the next run queued behind it.
   *
   * A board's `go infinite` is deliberately out of its reach. The two overlap for a moment
   * whenever the server preempts a run to make room for a board: the `stream_open` arrives
   * first and the `run_cancel` behind it, and a cancel that stopped the board instead would
   * end the session the preemption was for.
   */
  stopSearch(): void
  /**
   * Search `fen` until the signal is aborted, handing over a throttled picture as it goes.
   * True if the engine stopped searching by itself — a terminal position, or one it will
   * not search — which is a session that has ended rather than one that was closed.
   */
  searchInfinite(fen: string, options: InfiniteSearchOptions): Promise<boolean>
  /** Stop the engine. A quit engine refuses further searches rather than hanging. */
  quit(): void
}

export interface StartEngineOptions {
  /** Test seam: hand back the glue's factory instead of importing it. */
  load?: (url: string) => Promise<StockfishFactory>
  /** Test seam: the net's bytes, instead of fetching them. */
  loadNet?: (url: string) => Promise<Uint8Array>
  /**
   * Test seam: what `support.ts` reads the world through. One object rather than a flag per
   * capability, so a test states a whole browser and the two questions — may this run at
   * all, and on how many threads — are answered from the same description of it.
   */
  env?: RunnerEnvironment
}

/** Where the three files are published. `BASE_URL` already ends in a slash. */
export function engineAssetUrl(name: string): string {
  return `${import.meta.env.BASE_URL}engine/${name}`
}

/**
 * Start the engine: load the module, feed it its net, do the UCI handshake, set its threads.
 *
 * The order matters. The net is loaded before the handshake because a `go` without one is a
 * search with no evaluation function, and the handshake is what tells us what `Threads`
 * this build declares — so the count is clamped to the engine's own range rather than to a
 * number this file guessed.
 */
export async function startEngine(options: StartEngineOptions = {}): Promise<BrowserEngine> {
  const env = options.env ?? globalThis
  const support = browserRunnerSupport(env)
  if (!support.supported) throw new BrowserEngineError(support.reason ?? 'unsupported browser')

  const load = options.load ?? defaultLoad
  const loadNet = options.loadNet ?? defaultLoadNet
  const plan = threadPlan(env)

  const create = await load(engineAssetUrl(`${ENGINE_BUILD}.js`))
  const driver = new Driver()
  const sf = await create({
    listen: (line: string) => driver.onLine(line),
    onError: (message: string) => driver.onError(message),
  })
  driver.attach(sf)

  let nets = 0
  for (let slot = 0; ; slot += 1) {
    const netName = sf.getRecommendedNnue(slot)
    if (!netName) break
    sf.setNnueBuffer(await loadNet(engineAssetUrl(netName)), slot)
    nets += 1
  }
  if (nets === 0) {
    driver.dispose()
    throw new BrowserEngineError('this build recommends no network; the engine cannot evaluate')
  }

  const handshake = await driver.handshake()
  const applied = await driver.applyThreads(handshake.options, plan.threads)
  return new WasmEngine(driver, handshake, applied, plan.isolated)
}

async function defaultLoad(url: string): Promise<StockfishFactory> {
  // `@vite-ignore` because the URL is computed: the glue is served as its own file under a
  // fixed prefix rather than bundled, precisely so that the wasm beside it and the net it
  // names resolve relative to it.
  const module = (await import(/* @vite-ignore */ url)) as { default?: unknown }
  if (typeof module.default !== 'function') {
    throw new BrowserEngineError(`${url} did not export an engine factory`)
  }
  return module.default as StockfishFactory
}

async function defaultLoadNet(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) {
    throw new BrowserEngineError(`${url} answered ${response.status} ${response.statusText}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

// --- the line protocol -----------------------------------------------------

/** What one accumulated `multipv` looked like when the search ended. */
interface Accumulated {
  cp: number | null
  mate: number | null
  pv: string[] | null
  depth: number | null
  nodes: number | null
}

interface Handshake {
  name: string
  options: UciOption[]
}

/**
 * One command at a time, and one line handler at a time.
 *
 * UCI has no request ids: a reply is whatever arrives before the terminator of the command
 * that is currently outstanding. So the engine is driven strictly serially — a promise
 * chain rather than a pool — which also happens to be what a single engine process can
 * honestly do.
 */
class Driver {
  private sf: StockfishModule | null = null
  private consume: ((line: string) => void) | null = null
  private fail: ((error: Error) => void) | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private dead: string | null = null
  /** The command whose reply is being read right now, so a `stop` can be aimed. */
  private outstanding: string | null = null

  attach(sf: StockfishModule): void {
    this.sf = sf
  }

  onLine(data: string): void {
    // The glue prints line by line, but a build that ever batches two must not be read as
    // one malformed line.
    for (const line of String(data).split('\n')) {
      const text = line.trim()
      if (text) this.consume?.(text)
    }
  }

  onError(message: string): void {
    this.dead = message || 'the engine failed'
    this.fail?.(new BrowserEngineError(this.dead))
  }

  dispose(): void {
    this.dead ??= 'the engine was stopped'
    this.fail?.(new BrowserEngineError(this.dead))
    try {
      this.sf?.uci('quit')
    } catch {
      // A module that is already gone has nothing to quit.
    }
    this.sf = null
  }

  /** Run `work` when the engine is free, and never two at once. */
  serialise<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work)
    // The chain must not inherit this call's rejection, or one failed search would poison
    // every search after it.
    this.queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  /**
   * Send `command` and read lines until `done` says it has what it wanted.
   *
   * `onError` and `dispose` both land in `fail`, so a build that dies mid-search rejects the
   * search rather than leaving the run waiting for a `bestmove` that is never coming.
   */
  exchange<T>(command: string, read: (line: string) => T | undefined, timeoutMs = 0): Promise<T> {
    const sf = this.sf
    if (sf === null || this.dead !== null) {
      return Promise.reject(new BrowserEngineError(this.dead ?? 'the engine is not running'))
    }
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null
      const finish = () => {
        if (timer !== null) clearTimeout(timer)
        this.consume = null
        this.fail = null
        this.outstanding = null
      }
      this.fail = (error) => {
        finish()
        reject(error)
      }
      this.consume = (line) => {
        let answer: T | undefined
        try {
          answer = read(line)
        } catch (cause) {
          finish()
          reject(cause instanceof Error ? cause : new BrowserEngineError(String(cause)))
          return
        }
        if (answer !== undefined) {
          finish()
          resolve(answer)
        }
      }
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          finish()
          reject(new BrowserEngineError(`the engine did not answer ${command} in time`))
        }, timeoutMs)
      }
      this.outstanding = command
      try {
        sf.uci(command)
      } catch (cause) {
        finish()
        reject(cause instanceof Error ? cause : new BrowserEngineError(String(cause)))
      }
    })
  }

  send(command: string): void {
    if (this.sf === null || this.dead !== null) {
      throw new BrowserEngineError(this.dead ?? 'the engine is not running')
    }
    this.sf.uci(command)
  }

  /**
   * `stop`, quietly, and aimed. Sent while a `go` is outstanding it brings the `bestmove`
   * forward; sent when nothing is searching it is a no-op the engine ignores.
   *
   * `wanted` is what keeps the aim honest now that two kinds of search share this one
   * module. UCI has no request ids, so a bare `stop` ends whatever happens to be running —
   * and during a preemption a run's cancel and a board's `go infinite` are both in flight,
   * one of them about to be stopped by the other's business. The caller says which command
   * it means; a `stop` for anything else is not sent.
   */
  stop(wanted: (command: string) => boolean = () => true): void {
    if (this.outstanding !== null && !wanted(this.outstanding)) return
    try {
      this.send('stop')
    } catch {
      // A dead or absent engine has already stopped.
    }
  }

  /** `uci` … `uciok`: the engine's name and every option it declares. */
  handshake(): Promise<Handshake> {
    return this.serialise(() => {
      let name = ENGINE_VERSION
      const options: UciOption[] = []
      return this.exchange(
        'uci',
        (line) => {
          const declared = parseOption(line)
          if (declared !== null) {
            options.push(declared)
            return undefined
          }
          const id = parseIdName(line)
          if (id !== null) name = id
          return line === 'uciok' ? { name, options } : undefined
        },
        HANDSHAKE_TIMEOUT_MS,
      )
    })
  }

  /**
   * Set `Threads`, clamped to what the engine declared, and say what it ended up as.
   *
   * A build that declares no `Threads` at all is single-threaded by construction, and
   * advertising an option it never declared would have the server refuse the whole engine —
   * `services/engines.validate_options` checks every stored option against
   * `declared_options`, so the two have to be built from the same handshake.
   */
  applyThreads(options: UciOption[], wanted: number): Promise<number> {
    const declared = options.find((option) => option.name === 'Threads')
    if (declared === undefined) return Promise.resolve(1)
    const low = declared.min ?? 1
    const high = declared.max ?? wanted
    const value = Math.max(low, Math.min(wanted, high))
    return this.serialise(async () => {
      this.send(`setoption name Threads value ${value}`)
      await this.ready()
      return value
    })
  }

  /** `isready` … `readyok`. Every option change is followed by one. */
  ready(): Promise<true> {
    return this.exchange('isready', (line) => (line === 'readyok' ? true : undefined), HANDSHAKE_TIMEOUT_MS)
  }
}

// --- the engine ------------------------------------------------------------

class WasmEngine implements BrowserEngine {
  readonly version: string
  readonly threads: number
  readonly isolated: boolean
  readonly declaredOptions: UciOption[]
  readonly options: Record<string, number>

  private readonly driver: Driver
  /** What the engine is currently set to, so a search only sends what changed. */
  private multipv = 1
  private chess960 = false

  constructor(driver: Driver, handshake: Handshake, threads: number, isolated: boolean) {
    this.driver = driver
    this.version = handshake.name
    this.declaredOptions = handshake.options
    this.threads = threads
    this.isolated = isolated
    // `MultiPV` is deliberately absent: python-chess counts it among its `MANAGED_OPTIONS`
    // and sets it per search, `uci.ts` marks it managed for the same reason, and the server
    // refuses a stored value for a managed option. A build with no `Threads` advertises
    // nothing at all rather than a number it did not declare.
    this.options = handshake.options.some((option) => option.name === 'Threads')
      ? { Threads: threads }
      : {}
  }

  stopSearch(): void {
    this.driver.stop((command) => command !== INFINITE)
  }

  quit(): void {
    this.driver.dispose()
  }

  /**
   * `position fen …` then `go infinite`, until the caller aborts.
   *
   * `adapters/infinite.py: InfiniteSearch.run`, with the one difference a browser forces:
   * the Python loop polls `would_block()` on a thread and offers the buffer's `due()`
   * between reads, while here the lines arrive as events and a timer stands in for the
   * idle tick. It is there for the same reason — three `info` lines in a burst followed by
   * a long think must still reach the board.
   *
   * The engine is left idle either way, because the next thing done with this module is
   * another search: a `stop` is sent and the `bestmove` is waited for before this returns.
   */
  searchInfinite(fen: string, options: InfiniteSearchOptions): Promise<boolean> {
    const position = positionFrom(fen)
    if (position === null) {
      return Promise.reject(new BrowserEngineError(`${fen} is not a position this engine can read`))
    }
    return this.driver.serialise(async () => {
      // Checked on both sides of the handshake: until `go infinite` is sent this search is
      // only queued, and a session closed while it waited must not start one.
      if (options.signal.aborted) return false
      await this.configure(options)
      if (options.signal.aborted) return false

      const buffer = new SnapshotBuffer(position, {
        multipv: options.multipv,
        intervalMs: options.intervalMs,
      })
      const hand = (snapshot: SearchSnapshot | null): void => {
        if (snapshot !== null) options.onSnapshot(snapshot)
      }
      let asked = false
      const ask = () => {
        asked = true
        this.driver.stop((command) => command === INFINITE)
      }
      options.signal.addEventListener('abort', ask, { once: true })
      const ticker = setInterval(() => hand(buffer.due()), Math.max(1, options.intervalMs))
      try {
        this.driver.send(`position fen ${fen}`)
        const ended = this.driver.exchange(INFINITE, (line) => {
          const info = parseInfo(line)
          if (info !== null) {
            hand(buffer.offer(info))
            return undefined
          }
          return isBestMoveLine(line) ? true : undefined
        })
        options.onStarted?.()
        await ended
      } finally {
        clearInterval(ticker)
        options.signal.removeEventListener('abort', ask)
      }
      // It answered without being asked to: a terminal position, or an engine that will not
      // search this one. The last picture is still worth showing.
      if (!asked) hand(buffer.flush())
      return !asked
    })
  }

  /**
   * One position, one search, one `AnalysisResult` in White's frame.
   *
   * `StockfishAdapter.analyse`, line for line: the head `info` is the evaluation, a
   * candidate whose first move the position rejects is dropped rather than stored, and the
   * ranks come from the engine's own `multipv` field — numbering by arrival order silently
   * renumbers every line below one that was skipped.
   */
  analyse(fen: string, limit: SearchLimit, options: SearchOptions): Promise<AnalysisResult> {
    const position = positionFrom(fen)
    if (position === null) {
      return Promise.reject(new BrowserEngineError(`${fen} is not a position this engine can read`))
    }
    return this.driver.serialise(async () => {
      await this.configure(options)
      const lines = await this.search(fen, limit)
      return collect(position, lines, options.chess960)
    })
  }

  /** Only what changed, and a `readyok` after it, so a `go` never races an option. */
  private async configure(options: SearchOptions): Promise<void> {
    const multipv = Math.max(1, Math.trunc(options.multipv) || 1)
    let changed = false
    if (multipv !== this.multipv) {
      this.driver.send(`setoption name MultiPV value ${multipv}`)
      this.multipv = multipv
      changed = true
    }
    if (options.chess960 !== this.chess960) {
      this.driver.send(`setoption name UCI_Chess960 value ${options.chess960}`)
      this.chess960 = options.chess960
      changed = true
    }
    if (changed) await this.driver.ready()
  }

  /** `position fen …` then `go`, accumulating every `info` until `bestmove`. */
  private search(fen: string, limit: SearchLimit): Promise<Map<number, Accumulated>> {
    this.driver.send(`position fen ${fen}`)
    const lines = new Map<number, Accumulated>()
    // `chess.engine.Limit(nodes=…, depth=…)`: whichever bound the search reaches first.
    const bounds = [`nodes ${Math.max(1, Math.trunc(limit.nodes))}`]
    if (limit.depth !== null) bounds.push(`depth ${Math.max(1, Math.trunc(limit.depth))}`)
    return this.driver.exchange(`go ${bounds.join(' ')}`, (line) => {
      const info = parseInfo(line)
      if (info !== null) {
        const rank = info.multipv ?? 1
        const held = lines.get(rank) ?? { cp: null, mate: null, pv: null, depth: null, nodes: null }
        // Merged rather than replaced, the way python-chess's `AnalysisResult._register`
        // does: an `info depth 20 nodes 12345` with no score on it refines what is known
        // about that line, it does not retract the score of the line before it.
        if (info.score !== null) {
          held.cp = info.score.cp
          held.mate = info.score.mate
        }
        if (info.pv !== null) held.pv = info.pv
        if (info.depth !== null) held.depth = info.depth
        if (info.nodes !== null) held.nodes = info.nodes
        lines.set(rank, held)
        return undefined
      }
      return isBestMoveLine(line) ? lines : undefined
    })
  }
}

/** Every accumulated line as a `Candidate`, and the head one as the position's score. */
function collect(
  position: Chess,
  lines: Map<number, Accumulated>,
  chess960: boolean,
): AnalysisResult {
  const head = lines.get(1) ?? [...lines.values()][0]
  if (head === undefined || (head.cp === null && head.mate === null)) {
    throw new BrowserEngineError('the engine returned no evaluation')
  }

  const candidates: Candidate[] = []
  for (const [rank, held] of [...lines.entries()].sort((a, b) => a[0] - b[0])) {
    if (held.pv === null || held.pv.length === 0) continue
    if (held.cp === null && held.mate === null) continue
    const first = readUci(position, held.pv[0]!)
    // `pv[0] not in board.legal_moves`: a line whose own first move the position refuses is
    // dropped rather than stored, because everything downstream replays it.
    if (first === null) continue
    candidates.push({
      rank,
      uci: writeUci(position, first, chess960),
      score: whiteScore(held.cp, held.mate, position.turn),
      pv: truncateLine(position, held.pv, PV_PLIES, chess960),
    })
  }

  return {
    score: whiteScore(head.cp, head.mate, position.turn),
    depth: head.depth,
    nodes: head.nodes,
    candidates,
  }
}

/** Re-exported so a caller does not have to import two modules to read one score. */
export type { AnalysisResult, Score }
export { MATE_SCORE }

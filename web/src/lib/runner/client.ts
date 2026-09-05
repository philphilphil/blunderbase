/**
 * The tab's side of the runner link: `backend/runners/client.py`, in a browser.
 *
 * The Python runner is a process with a config file, a pool of engine subprocesses and a
 * poll fallback. This is one tab with one engine and one socket, and the differences are
 * all consequences of that:
 *
 * - **One slot.** One engine, one `go` at a time (see `engine.ts`), so `slots` is 1 and
 *   the threads go into making that one search fast. A second concurrent run on the same
 *   module would only make both slower and both heartbeats late.
 * - **No poll fallback.** It exists so a machine behind a proxy that eats websockets still
 *   drains the queue; a tab that cannot hold a socket to the very origin it was served from
 *   has bigger problems. An analysis board would have nowhere to send a snapshot on that
 *   transport anyway — `workers/runner_gateway._streams` says so at the other end.
 * - **A refusal stops, it does not retry.** Every 4000-range close is an answer about
 *   *this* token, and dialling again only asks the same question — with a rate limit, it
 *   actively holds the door shut. So all five end in `refused` with words the owner can
 *   act on, and only weather (a dropped socket, a redeploy, 1006) is retried with backoff.
 *   This is `EventsProvider`'s treatment of 4401 generalised: the socket loop stops and
 *   the page says why.
 *
 * **One slot, a queue run and an analysis board.** A board is an open-ended `go`, so it
 * occupies the one slot for as long as somebody is sitting at it, and the two can want it
 * at the same moment. What happens then is settled on the server and mirrored here rather
 * than decided twice:
 *
 * - A `stream_open` that arrives while a run is mid-analysis **waits for the slot and never
 *   touches the run**. `RunnerGateway.reserve_slot` has already taken the slot off that run
 *   — D6: a board is a person waiting, a deep pass can start again in a minute — and sent
 *   it back to the queue with its attempt refunded, so the `run_cancel` is on its way and
 *   arrives just behind the `stream_open`. The tab's job is to let the position in flight
 *   finish (the cancel's `stop` brings its `bestmove` forward) and hand the slot over.
 *   Ending the run here instead would spend the attempt the server had just refunded and
 *   race its own bookkeeping. What the tab does add is a bound: if the slot has not come
 *   free within `STREAM_START_TIMEOUT_MS`, the session is closed with a sentence saying so,
 *   because a board waiting for a `stream_started` that never comes is the one outcome
 *   worse than a refusal.
 * - A `run_dispatch` that arrives while a board is open is **refused with `retry: true`**.
 *   The gateway counts a board against `free_slots` and so should never send one; if it
 *   does, queueing it behind an open-ended search would leave it silently doing nothing
 *   until the stale sweep collected it, where a refusal puts it straight back in the queue
 *   for the next runner or the next minute.
 *
 * **What a tab cannot fix, and where it shows.** Background tabs get their *timers*
 * throttled — Chrome to roughly one wake-up a minute after a few minutes hidden. The
 * search itself is unaffected (it runs on a pthread), and so are the frames this file
 * sends when the search reports movement. What suffers is the `run_progress` this file
 * sends *on a timer* to cover a single very deep position, and the server's stale sweep
 * collects a run whose last beat is older than 60s (`analysis.STALE_AFTER_SECONDS`). A run
 * collected that way is requeued, not lost, and `browser: true` on the `hello` is what
 * earns the vanished attempt its refund — but a hidden tab on a very deep single position
 * can have a run taken off it, and no amount of code here prevents that.
 */
import { API_BASE } from '@/lib/api/client'

import { positionFrom } from './board'
import {
  clearCredential,
  readCredential,
  writeCredential,
  type CredentialStore,
  type RunnerCredential,
} from './credential'
import { ENGINE_PATH, startEngine, type BrowserEngine } from './engine'
import {
  analysePlan,
  PlanRefused,
  RunAbandoned,
  positionsOf,
  type PlanRunOptions,
} from './plan'
import {
  CLOSE_REASONS,
  DEFAULT_SNAPSHOT_INTERVAL_MS,
  STREAM_CLOSED_REASON,
  STREAM_ENGINE_FAILED,
  STREAM_RUNNER_GONE,
  WS_PATH,
  WS_SUBPROTOCOL,
  decodeFrame,
  decodePlan,
  hello,
  pong,
  ProtocolError,
  runCancelled,
  runComplete,
  runFailed,
  runProgress,
  streamClosed,
  streamSnapshot,
  streamStarted,
  type ActiveRun,
  type EngineAd,
  type RunPlan,
} from './protocol'
import type { SearchSnapshot } from './search'
import { isolationHint, threadPlan } from './support'

export type BrowserRunnerPhase =
  | 'off'
  | 'starting'
  | 'connecting'
  | 'connected'
  | 'retrying'
  | 'refused'

export interface RefusedEngine {
  name: string
  reason: string
}

export interface BrowserRunnerState {
  phase: BrowserRunnerPhase
  /** The installed runner, from the stored credential. null ⇒ nothing installed here. */
  runnerId: number | null
  runnerName: string | null
  /** The engine name advertised, once the engine has started. */
  engineName: string | null
  threads: number
  isolated: boolean
  /** Runs this tab is executing right now. */
  activeRuns: number
  /** What stopped it: `code` is a protocol error code, `message` is showable prose. */
  error: { code: string; message: string } | null
  /** Engines the server refused, in its own words. The socket stays up. */
  refused: RefusedEngine[]
}

/** `Engine.name` is `String(64)` and unique across the whole deployment. */
const MAX_ENGINE_NAME = 64

/**
 * The engine row this runner advertises. One per tab; the runner is the host.
 *
 * It carries the runner's own name because engine names are unique *across the deployment*,
 * not per host: `services.engines.sync_runner_engines` refuses an advertisement whose name
 * another host already holds, with the reason "an engine named … is already registered on
 * another runner". A fixed string would therefore work for exactly one browser and leave
 * the owner's second machine with a runner that connects, advertises, and is quietly given
 * no engine at all.
 */
export function browserEngineName(runner: string): string {
  return `Stockfish (${runner || 'browser'})`.slice(0, MAX_ENGINE_NAME)
}

/** `runners/config.py: Reconnect` defaults, which is what the Python runner uses. */
const RECONNECT_INITIAL_MS = 1_000
const RECONNECT_MAX_MS = 60_000
/** Half of every delay is jitter, so a fleet of tabs does not dial in lockstep. */
const JITTER = 0.5

/** Until a `welcome` says otherwise. `client.py: DEFAULT_HEARTBEAT`. */
const DEFAULT_HEARTBEAT_MS = 10_000

/**
 * How long a board waits for the one slot before it is given up on.
 *
 * Generous, because the wait is real work finishing: a `stream_open` that arrives during a
 * preemption sits behind whatever position the outgoing run is on, and the `run_cancel`
 * behind it is what brings that `bestmove` forward. It is not a search budget — nothing
 * here should ever reach it — it is the bound that keeps a board from waiting on a
 * `run_cancel` that never comes.
 */
const STREAM_START_TIMEOUT_MS = 20_000

/**
 * How long a burst of `stream_restart`s is allowed to gather before the engine is asked
 * again.
 *
 * Clicking through a game sends one per position, and an arrow key held down sends one
 * every few dozen milliseconds. A `stop`/`go` each would spend the whole slot turning the
 * engine around and never let a search reach a useful depth. The window opens on the first
 * restart of a burst and is *not* pushed back by the ones that follow, so a key held down
 * still gets a search every window rather than none at all; whatever position is newest
 * when it closes is the one searched.
 */
const RESTART_COALESCE_MS = 150

/**
 * What each refusal actually means, in terms the owner can do something about.
 *
 * A close code on its own reads as "the socket closed" however carefully the server picked
 * it, so each of the five gets its own sentence — and none of them reconnects, for the
 * reason named in the sentence.
 */
const REFUSALS: Record<number, string> = {
  4401:
    'the server does not know this runner’s token. It was probably revoked, or this ' +
    'browser was set up against a different deployment. Install the browser runner again ' +
    'to get a new one.',
  4403:
    'this runner’s token has been revoked. Nothing will change until a new one is issued, ' +
    'so install the browser runner again from the Engines page.',
  4409:
    'another tab or machine is already connected as this runner. A runner holds one link ' +
    'at a time — close the other one, or install a second runner for this browser.',
  4426:
    'this page and the server do not speak the same runner protocol. Reload the page; if ' +
    'that does not fix it, the app and the deployment are from different releases.',
  4429:
    'the server has refused this token often enough to shut its door on it, and dialling ' +
    'again only holds the door shut. Wait a minute, then start it again.',
}

/** The little of `WebSocket` this client uses. A test supplies its own. */
export interface RunnerSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: (() => void) | null
  onclose: ((event: { code: number; reason: string }) => void) | null
}

export interface ClientDeps {
  /** How a socket is opened. The two subprotocols are the sentinel and the token. */
  open: (url: string, protocols: string[]) => RunnerSocket
  /** How the engine is started. */
  start: () => Promise<BrowserEngine>
  /** Where the credential lives. Omitted means `localStorage`, where there is one. */
  store?: CredentialStore | null
  /** The websocket URL to dial. */
  url: () => string
  /** Jitter, so a test can be deterministic. */
  random: () => number
  /** The app version the `hello` carries. */
  version: string | null
}

/** One dispatched run, from this tab's side of it. `client.py: Job`. */
interface Job {
  runId: number
  attemptToken: string
  done: number
  total: number
  abandoned: boolean
  /** Aborts the plan loop between positions. */
  controller: AbortController
  /** The heartbeat timer, re-armed on every frame sent for this run. */
  beat: ReturnType<typeof setTimeout> | null
}

/**
 * One analysis board this tab is serving. `client.py: Stream`.
 *
 * `restart` and `closing` are read by the loop *between* searches, which is what makes a
 * position change a stop-and-go on the same engine rather than a teardown: the session,
 * its `seq` and the `stream_started` the server already had all survive it.
 */
interface StreamSession {
  sessionId: string
  /** The engine the server asked for, echoed back on `stream_started`. */
  engine: string
  fen: string
  multipv: number
  intervalMs: number
  seq: number
  /** True once `stream_started` has gone out; it is sent once per session, not per search. */
  started: boolean
  /** The current `go`'s abort. Replaced on every turn round the loop. */
  stop: AbortController | null
  restart: boolean
  closing: boolean
  /** When the window on the current burst of restarts closes; 0 ⇒ no burst. */
  restartAt: number
  /** Gives up on a slot that never came free, so a board is never left waiting silently. */
  waiting: ReturnType<typeof setTimeout> | null
}

const INITIAL: BrowserRunnerState = {
  phase: 'off',
  runnerId: null,
  runnerName: null,
  engineName: null,
  threads: 1,
  isolated: false,
  activeRuns: 0,
  error: null,
  refused: [],
}

export class BrowserRunnerClient {
  private readonly deps: ClientDeps
  private readonly listeners = new Set<() => void>()
  /**
   * Cached so `getSnapshot` returns the same object between changes — `useSyncExternalStore`
   * re-renders forever otherwise.
   */
  private snapshot: BrowserRunnerState = INITIAL

  private credential: RunnerCredential | null = null
  private engine: BrowserEngine | null = null
  private socket: RunnerSocket | null = null
  private readonly runs = new Map<number, Job>()
  /** At most one: `slots` is 1, and a board holds the slot while somebody is at it. */
  private stream: StreamSession | null = null

  private heartbeatMs = DEFAULT_HEARTBEAT_MS
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryDelay = RECONNECT_INITIAL_MS
  /** True once the current socket has been welcomed; a drop after that is not a failure. */
  private established = false
  /** Set while a close is this side's doing, so it is not read as a drop worth retrying. */
  private closing = false
  private booting = false

  constructor(deps: ClientDeps) {
    this.deps = deps
  }

  // --- the store ------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): BrowserRunnerState => this.snapshot

  private patch(fields: Partial<BrowserRunnerState>): void {
    const next = { ...this.snapshot, ...fields }
    if (same(this.snapshot, next)) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }

  // --- what the page asks for ------------------------------------------------

  /** Store the credential and connect. */
  start(credential: RunnerCredential): void {
    writeCredential(credential, this.deps.store)
    this.credential = credential
    this.patch({
      runnerId: credential.runnerId,
      runnerName: credential.runnerName,
      error: null,
      refused: [],
    })
    this.connect()
  }

  /** Close the socket deliberately; the credential stays. */
  stop(): void {
    this.closing = true
    this.clearRetry()
    this.dropStream()
    for (const runId of [...this.runs.keys()]) this.abandon(runId, false)
    const socket = this.socket
    this.socket = null
    if (socket) {
      detach(socket)
      socket.close(1000, 'stopped')
    }
    this.engine?.quit()
    this.engine = null
    this.established = false
    this.patch({ phase: 'off', engineName: null, activeRuns: 0 })
  }

  /** Connect if a credential is stored; a no-op otherwise. Safe to call repeatedly. */
  resume(): void {
    if (this.socket !== null || this.booting || this.retryTimer !== null) return
    const credential = this.credential ?? readCredential(this.deps.store)
    if (!credential) return
    this.credential = credential
    this.patch({ runnerId: credential.runnerId, runnerName: credential.runnerName })
    this.connect()
  }

  /**
   * `stop()` plus forgetting the credential. Deliberately *not* the uninstall: the runner
   * row and its token outlive this browser, so the caller revokes server-side first.
   */
  forget(): void {
    this.stop()
    clearCredential(this.deps.store)
    this.credential = null
    this.patch({ runnerId: null, runnerName: null, error: null, refused: [] })
  }

  /** A last, deliberate close on `beforeunload`: kinder than the 60s stale sweep. */
  shutdown(): void {
    const socket = this.socket
    this.closing = true
    // Before the socket goes: a board left searching would hold the engine for the moment
    // the tab has left, and the server would be told about the session by nobody.
    this.dropStream()
    this.socket = null
    if (socket) {
      detach(socket)
      socket.close(1000, 'the tab is closing')
    }
  }

  // --- connecting -------------------------------------------------------------

  private connect(): void {
    if (this.socket !== null || this.booting) return
    const credential = this.credential
    if (!credential) return
    this.closing = false
    this.clearRetry()

    if (this.engine) {
      this.dial(credential)
      return
    }
    this.booting = true
    this.patch({ phase: 'starting' })
    const plan = threadPlan()
    this.patch({ threads: plan.threads, isolated: plan.isolated })
    this.deps.start().then(
      (engine) => {
        this.booting = false
        this.engine = engine
        this.patch({
          engineName: engine.version,
          threads: engine.threads,
          isolated: engine.isolated,
        })
        if (this.closing) return
        this.dial(credential)
      },
      (cause: unknown) => {
        this.booting = false
        // Not retried on a timer. An engine that will not start is a browser that cannot
        // do this, a proxy eating the COOP/COEP headers, or an asset that is not being
        // served — none of which a backoff loop fixes, and all of which the owner can see
        // and act on once. Pressing start again is the retry.
        //
        // The isolation hint is appended rather than checked for up front, because the two
        // cannot be told apart before the attempt: `crossOriginIsolated` being false is not
        // itself a refusal (a page may still be offered the button — see `support.ts`), but
        // it *is* by far the likeliest reason this particular build refused to allocate, and
        // the browser's own message for it names neither COEP nor the proxy in front of us.
        this.patch({
          phase: 'refused',
          error: {
            code: 'engine_failed',
            message: plan.isolated ? message(cause) : `${message(cause)} — ${isolationHint()}`,
          },
        })
      },
    )
  }

  private dial(credential: RunnerCredential): void {
    this.established = false
    this.patch({ phase: 'connecting' })
    let socket: RunnerSocket
    try {
      // Exactly two subprotocols, sentinel first, token verbatim. Never in the URL: a
      // bearer token in a URL is written into every access log it passes through.
      socket = this.deps.open(this.deps.url(), [WS_SUBPROTOCOL, credential.token])
    } catch (cause) {
      this.patch({ phase: 'retrying', error: { code: 'unreachable', message: message(cause) } })
      this.scheduleRetry()
      return
    }
    this.socket = socket

    socket.onopen = () => this.announce()
    socket.onmessage = (event) => this.receive(event.data)
    socket.onerror = () => socket.close()
    socket.onclose = (event) => this.onClose(event.code, event.reason)
  }

  /** `hello` first, or the server closes 1008. */
  private announce(): void {
    const engine = this.engine
    const credential = this.credential
    if (!engine || !credential) return
    this.send(
      hello({
        runner: credential.runnerName || 'browser',
        version: this.deps.version,
        // One engine, one search at a time. See the module docstring.
        slots: 1,
        engines: [this.advertisement(engine, credential.runnerName)],
        activeRuns: this.activeRuns(),
      }),
    )
  }

  private advertisement(engine: BrowserEngine, runner: string): EngineAd {
    return {
      name: browserEngineName(runner),
      kind: 'uci',
      path: ENGINE_PATH,
      version: engine.version,
      // No tier claimed, and the server would ignore one anyway: a runner cannot claim a
      // job, because the owner assigns one engine to each of Quick, Deep and Human moves
      // (`services.engines.EngineRole`). The field is still on the wire — `protocol.EngineAd`
      // accepts and drops it — so a runner built before that keeps connecting; sending null
      // is this client saying the same thing the server already assumes.
      tier: null,
      options: engine.options,
      declared_options: engine.declaredOptions,
      // This client answers `stream_open`, so the picker may offer it. The flag is stored
      // rather than inferred from the kind at the other end (`services/engines
      // .sync_runner_engines`), which is what lets a runner that only drains the queue say
      // so and be believed.
      streams: true,
    }
  }

  private activeRuns(): ActiveRun[] {
    return [...this.runs.values()].map((job) => ({
      run_id: job.runId,
      attempt_token: job.attemptToken,
    }))
  }

  // --- frames -----------------------------------------------------------------

  private receive(data: unknown): void {
    let frame: Record<string, unknown>
    try {
      frame = decodeFrame(typeof data === 'string' ? data : String(data))
    } catch (cause) {
      if (cause instanceof ProtocolError) return
      throw cause
    }
    switch (frame.type) {
      case 'welcome':
        this.welcomed(frame)
        return
      case 'ping':
        this.send(pong(stamp(frame.t)))
        return
      case 'engines_accepted':
        this.noteEngines(frame.engines)
        return
      case 'error':
        this.onError(frame)
        return
      case 'run_dispatch':
        void this.onDispatch(frame)
        return
      case 'run_cancel':
        this.abandon(Number(frame.run_id), true)
        return
      case 'stream_open':
        this.openStream(frame)
        return
      case 'stream_restart':
        this.restartStream(frame)
        return
      case 'stream_close':
        this.closeStream(String(frame.session_id ?? ''), {
          reason: String(frame.reason || STREAM_CLOSED_REASON),
        })
        return
      default:
        // `pong`, `run_ack`, and anything a newer server invents. A frame this runner does
        // not understand is ignored, never fatal.
        return
    }
  }

  private welcomed(frame: Record<string, unknown>): void {
    this.established = true
    this.retryDelay = RECONNECT_INITIAL_MS
    const beat = Number(frame.heartbeat_seconds)
    this.heartbeatMs = Number.isFinite(beat) && beat > 0 ? beat * 1000 : DEFAULT_HEARTBEAT_MS
    const named = typeof frame.runner === 'string' ? frame.runner : null
    this.patch({
      phase: 'connected',
      error: null,
      // The server's answer is authoritative — the token is the identity, not the name
      // this browser remembers.
      runnerId: Number.isFinite(Number(frame.runner_id))
        ? Number(frame.runner_id)
        : this.snapshot.runnerId,
      runnerName: named ?? this.snapshot.runnerName,
    })
    this.noteEngines(frame.engines)
    for (const runId of asList(frame.cancelled_runs)) this.abandon(Number(runId), true)
  }

  /** A refused engine leaves the socket up: it is a fact to show, not a reason to stop. */
  private noteEngines(entries: unknown): void {
    const refused: RefusedEngine[] = []
    for (const entry of asList(entries)) {
      if (!entry || typeof entry !== 'object') continue
      const row = entry as Record<string, unknown>
      if (row.accepted) continue
      refused.push({
        name: String(row.name ?? 'engine'),
        reason: String(row.reason ?? 'the server did not say why'),
      })
    }
    this.patch({ refused })
  }

  private onError(frame: Record<string, unknown>): void {
    if (!frame.fatal) return
    // The close follows immediately and carries the code this maps onto; recording the
    // server's own words here means the state says *why* even if the close is a bare 1006.
    this.patch({
      error: {
        code: String(frame.code ?? 'error'),
        message: String(frame.message ?? 'the server refused this runner'),
      },
    })
  }

  private onClose(code: number, reason: string): void {
    this.socket = null
    // A board cannot outlive the link it was opened on: the server ends the session the
    // moment this runner drops, so holding the engine would be holding the slot for
    // nobody. A run is the other way about — see below.
    this.dropStream()
    if (this.closing) {
      this.patch({ phase: 'off' })
      return
    }
    const refusal = REFUSALS[code]
    if (refusal !== undefined) {
      for (const runId of [...this.runs.keys()]) this.abandon(runId, false)
      this.patch({
        phase: 'refused',
        activeRuns: 0,
        error: { code: CLOSE_REASONS[code] ?? 'refused', message: refusal },
      })
      return
    }
    // Weather. Whatever is still computing keeps computing: the reconnect's `hello`
    // carries it in `active_runs` and the gateway's `_reconcile` resumes it rather than
    // orphaning it.
    if (this.established) this.retryDelay = RECONNECT_INITIAL_MS
    this.patch({
      phase: 'retrying',
      error: {
        code: 'disconnected',
        message: reason || `the link to the server closed (${code})`,
      },
    })
    this.scheduleRetry()
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null || this.closing) return
    // `client.py: backoff_delays` — exponential, half of it jitter, so a fleet coming back
    // together does not dial in lockstep.
    const delay = this.retryDelay * (JITTER + (1 - JITTER) * this.deps.random())
    this.retryDelay = Math.min(this.retryDelay * 2, RECONNECT_MAX_MS)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, delay)
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private send(frame: Record<string, unknown>): void {
    const socket = this.socket
    if (!socket) return
    try {
      socket.send(JSON.stringify(frame))
    } catch {
      // A socket that is closing takes the frame with it; the server requeues the run.
    }
  }

  // --- analysis boards -----------------------------------------------------------

  /**
   * Take the slot and start searching, or say at once why this tab cannot.
   *
   * A refusal is a `stream_closed`, not a silence: the board on the other end is a person
   * waiting, and the server can offer them another engine the moment it knows.
   */
  private openStream(frame: Record<string, unknown>): void {
    const sessionId = String(frame.session_id ?? '')
    if (!sessionId) return
    // `_open_stream`: a session already open here is a redelivery, not a second board.
    if (this.stream?.sessionId === sessionId) return
    if (this.stream !== null) {
      this.endStream(
        sessionId,
        STREAM_ENGINE_FAILED,
        'this browser is already serving an analysis board on its one engine',
      )
      return
    }

    const engine = String(frame.engine ?? '')
    const searcher = this.engine
    if (!searcher || engine !== browserEngineName(this.credential?.runnerName ?? '')) {
      this.endStream(
        sessionId,
        STREAM_ENGINE_FAILED,
        `${engine} is not an engine this runner streams on`,
      )
      return
    }
    const fen = String(frame.fen ?? '')
    if (positionFrom(fen) === null) {
      this.endStream(sessionId, STREAM_ENGINE_FAILED, `${fen} is not a position this engine can read`)
      return
    }

    const session: StreamSession = {
      sessionId,
      engine,
      fen,
      multipv: multipvOf(frame.multipv) ?? 1,
      intervalMs: Math.max(0, Number(frame.interval_ms) || DEFAULT_SNAPSHOT_INTERVAL_MS),
      seq: 0,
      started: false,
      stop: null,
      restart: false,
      closing: false,
      restartAt: 0,
      waiting: null,
    }
    session.waiting = setTimeout(() => {
      session.waiting = null
      if (session.started || session.closing) return
      this.closeStream(sessionId, {
        reason: STREAM_ENGINE_FAILED,
        error:
          'this browser is still finishing a queued analysis run on its one engine, and ' +
          'the board never got the slot',
      })
    }, STREAM_START_TIMEOUT_MS)
    this.stream = session
    void this.serveStream(session, searcher)
  }

  /**
   * Search whatever the session is showing until it is closed. `client.py: _serve_stream`.
   *
   * The loop is where a restart happens: the search ends, the newest position is read off
   * the session, and the same engine goes again on the same slot. Nothing about the session
   * is torn down and no second `stream_started` is sent — the board on the other end is
   * still the board it was.
   */
  private async serveStream(session: StreamSession, engine: BrowserEngine): Promise<void> {
    let error: string | null = null
    try {
      while (!session.closing) {
        const stop = new AbortController()
        session.stop = stop
        session.restart = false
        const finished = await engine.searchInfinite(session.fen, {
          multipv: session.multipv,
          // A `stream_open` carries a FEN and no variant, and these lines are drawn rather
          // than replayed into a stored move, so the castling spelling is the plain one.
          chess960: false,
          intervalMs: session.intervalMs,
          signal: stop.signal,
          onStarted: () => this.streamStarted(session),
          onSnapshot: (snapshot) => this.sendSnapshot(session, snapshot),
        })
        if (session.closing || !session.restart) {
          if (finished && !session.closing) error = 'the engine stopped searching this position'
          break
        }
        await this.coalesce(session)
      }
    } catch (cause) {
      error = message(cause)
    }
    // A session the server closed has already been answered, and its slot given back.
    if (session.closing) return
    this.forgetStream(session)
    this.send(
      streamClosed({ sessionId: session.sessionId, reason: STREAM_ENGINE_FAILED, error }),
    )
  }

  /** Once per session, the moment `go infinite` is genuinely on the engine. */
  private streamStarted(session: StreamSession): void {
    if (session.waiting !== null) clearTimeout(session.waiting)
    session.waiting = null
    if (session.started || session.closing) return
    session.started = true
    this.send(streamStarted(session.sessionId, session.engine))
  }

  private sendSnapshot(session: StreamSession, snapshot: SearchSnapshot): void {
    if (session.closing) return
    session.seq += 1
    this.send(
      streamSnapshot({
        sessionId: session.sessionId,
        seq: session.seq,
        depth: snapshot.depth,
        nodes: snapshot.nodes,
        nps: snapshot.nps,
        timeMs: snapshot.timeMs,
        lines: snapshot.lines,
      }),
    )
  }

  /**
   * The position changed: stop and go again on the same slot.
   *
   * The frame is *not* answered here, and the search is not restarted here either. Both are
   * the loop's, which is what makes a burst of these one turn round it rather than one
   * `stop`/`go` per click.
   */
  private restartStream(frame: Record<string, unknown>): void {
    const sessionId = String(frame.session_id ?? '')
    const session = this.stream
    if (!sessionId) return
    if (session === null || session.sessionId !== sessionId) {
      this.endStream(sessionId, STREAM_ENGINE_FAILED, 'no such session here')
      return
    }
    if (frame.fen !== null && frame.fen !== undefined) {
      const fen = String(frame.fen)
      if (positionFrom(fen) === null) {
        this.closeStream(sessionId, {
          reason: STREAM_ENGINE_FAILED,
          error: `${fen} is not a position this engine can read`,
        })
        return
      }
      session.fen = fen
    }
    const multipv = multipvOf(frame.multipv)
    if (multipv !== null) session.multipv = multipv
    session.restart = true
    if (session.restartAt === 0) session.restartAt = Date.now() + RESTART_COALESCE_MS
    session.stop?.abort()
  }

  /** Wait out the window this burst of restarts opened, then search the newest position. */
  private coalesce(session: StreamSession): Promise<void> {
    const wait = session.restartAt - Date.now()
    session.restartAt = 0
    if (wait <= 0) return Promise.resolve()
    return new Promise((resolve) => setTimeout(resolve, wait))
  }

  /**
   * Stop searching and give the slot back. Closing a session that is not open is not an
   * error, and nothing here waits for the engine: the abort brings the `bestmove` forward
   * and the loop lets go on its own, while `closing` is what keeps it quiet about a session
   * that has already been answered for. A receive loop that waited would owe the server no
   * pongs, no dispatches and no cancels while it did.
   */
  private closeStream(
    sessionId: string,
    options: { reason: string; error?: string | null; answer?: boolean } = {
      reason: STREAM_CLOSED_REASON,
    },
  ): void {
    const session = this.stream
    if (session === null || session.sessionId !== sessionId) return
    session.closing = true
    this.forgetStream(session)
    session.stop?.abort()
    if (options.answer === false) return
    this.endStream(sessionId, options.reason, options.error ?? null)
  }

  /** Every board given up, because the link is gone or this tab is. `_drop_streams`. */
  private dropStream(): void {
    const session = this.stream
    if (session === null) return
    // Unanswered on purpose: there is no socket left to answer down, and
    // `services/streams.py` ends the sessions itself on `runner.disconnected`.
    this.closeStream(session.sessionId, { reason: STREAM_RUNNER_GONE, answer: false })
  }

  private forgetStream(session: StreamSession): void {
    if (session.waiting !== null) clearTimeout(session.waiting)
    session.waiting = null
    if (this.stream === session) this.stream = null
  }

  private endStream(sessionId: string, reason: string, error: string | null): void {
    this.send(streamClosed({ sessionId, reason, error }))
  }

  // --- runs --------------------------------------------------------------------

  private async onDispatch(frame: Record<string, unknown>): Promise<void> {
    const runId = Number(frame.run_id)
    const attemptToken = String(frame.attempt_token ?? '')
    if (!Number.isFinite(runId) || !attemptToken) return
    // Exactly `_on_dispatch`: a run already on a slot here is a redelivery, not a second
    // job, and starting it twice would have two searches racing to answer one attempt.
    if (this.runs.has(runId)) return

    const engine = this.engine
    const advertised = browserEngineName(this.credential?.runnerName ?? '')
    if (!engine || String(frame.engine ?? '') !== advertised) {
      this.send(
        runFailed({
          runId,
          attemptToken,
          error: `${String(frame.engine ?? '')} is not a search engine this runner has`,
          retry: true,
        }),
      )
      return
    }

    // The one slot is held by a person sitting at a board. The gateway counts that against
    // `free_slots` and should never have sent this, but queueing it behind an open-ended
    // search would leave it silently doing nothing until the stale sweep collected it.
    if (this.stream !== null) {
      this.send(
        runFailed({
          runId,
          attemptToken,
          error: 'this browser is serving an analysis board on its one engine',
          retry: true,
        }),
      )
      return
    }

    let plan: RunPlan
    try {
      plan = decodePlan(frame.plan)
    } catch (cause) {
      // The same bytes would decode the same way on a second attempt.
      this.send(
        runFailed({ runId, attemptToken, error: `the plan did not decode: ${message(cause)}`, retry: false }),
      )
      return
    }

    const job: Job = {
      runId,
      attemptToken,
      done: 0,
      total: positionsOf(plan).length,
      abandoned: false,
      controller: new AbortController(),
      beat: null,
    }
    this.runs.set(runId, job)
    this.patch({ activeRuns: this.runs.size })
    await this.execute(job, plan, engine)
  }

  private async execute(job: Job, plan: RunPlan, engine: BrowserEngine): Promise<void> {
    const options: PlanRunOptions = {
      signal: job.controller.signal,
      progress: (done, total) => {
        job.done = done
        job.total = total
        this.beat(job)
      },
    }
    // Progress is also the heartbeat: `analysePlan` reports every few positions, and the
    // timer covers the other half — one very deep position must not look like a dead
    // runner to the server's stale sweep.
    this.beat(job)
    try {
      const evals = await analysePlan(plan, engine, options)
      if (job.abandoned) return
      this.send(runComplete({ runId: job.runId, attemptToken: job.attemptToken, evals }))
    } catch (cause) {
      if (job.abandoned || cause instanceof RunAbandoned) return
      const refusal = cause instanceof PlanRefused
      this.send(
        runFailed({
          runId: job.runId,
          attemptToken: job.attemptToken,
          error: message(cause),
          retry: refusal ? (cause as PlanRefused).retry : true,
        }),
      )
    } finally {
      this.clearBeat(job)
      // By identity: a run taken away and dispatched again sits under a *new* job, and
      // this one leaving must not evict it.
      if (this.runs.get(job.runId) === job) {
        this.runs.delete(job.runId)
        this.patch({ activeRuns: this.runs.size })
      }
    }
  }

  /** One `run_progress`, and the timer that sends the next one if nothing moves. */
  private beat(job: Job): void {
    if (job.abandoned) return
    this.send(
      runProgress({
        runId: job.runId,
        attemptToken: job.attemptToken,
        done: job.done,
        total: job.total,
      }),
    )
    this.clearBeat(job)
    job.beat = setTimeout(() => this.beat(job), this.heartbeatMs)
  }

  private clearBeat(job: Job): void {
    if (job.beat !== null) clearTimeout(job.beat)
    job.beat = null
  }

  /** Stop working on a run and say nothing more about it. `client.py: _abandon`. */
  private abandon(runId: number, answer: boolean): void {
    const job = this.runs.get(runId)
    if (!job) return
    job.abandoned = true
    this.clearBeat(job)
    this.runs.delete(runId)
    job.controller.abort()
    // The plan loop only notices between positions, so the engine is told too: a deep `go`
    // would otherwise hold the one slot this tab has until it finished on its own.
    this.engine?.stopSearch()
    this.patch({ activeRuns: this.runs.size })
    if (answer) this.send(runCancelled(runId))
  }
}

// --- wiring ------------------------------------------------------------------

/**
 * `/runner/ws`, absolute, derived the way `eventsUrl()` derives `/events` — except that
 * this one hangs off `API_BASE`, which may be an absolute URL in a build that talks to a
 * backend on another host.
 */
export function runnerWsUrl(): string {
  if (/^https?:/i.test(API_BASE)) {
    const base = new URL(API_BASE)
    base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${base.origin}${base.pathname.replace(/\/$/, '')}${WS_PATH}`
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${API_BASE}${WS_PATH}`
}

/** What the singleton runs on: real sockets, the real engine, real storage. */
export function defaultDeps(): ClientDeps {
  return {
    open: (url, protocols) => new WebSocket(url, protocols) as unknown as RunnerSocket,
    start: () => startEngine(),
    url: runnerWsUrl,
    random: Math.random,
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null,
  }
}

function detach(socket: RunnerSocket): void {
  socket.onopen = null
  socket.onmessage = null
  socket.onerror = null
  socket.onclose = null
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * A `multipv` a stream frame carried, or null because it did not carry one.
 *
 * `stream_restart` sends `null` for "leave it as it was", which is a different answer from
 * a 1 nobody asked for.
 */
function multipvOf(value: unknown): number | null {
  if (value === null || value === undefined) return null
  return Math.max(1, Math.trunc(Number(value)) || 1)
}

function stamp(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Date.now() / 1000
}

function message(cause: unknown): string {
  if (cause instanceof Error) return cause.message || cause.name
  return String(cause)
}

function same(left: BrowserRunnerState, right: BrowserRunnerState): boolean {
  return (
    left.phase === right.phase &&
    left.runnerId === right.runnerId &&
    left.runnerName === right.runnerName &&
    left.engineName === right.engineName &&
    left.threads === right.threads &&
    left.isolated === right.isolated &&
    left.activeRuns === right.activeRuns &&
    left.error?.code === right.error?.code &&
    left.error?.message === right.error?.message &&
    left.refused.length === right.refused.length &&
    left.refused.every(
      (entry, at) => entry.name === right.refused[at]?.name && entry.reason === right.refused[at]?.reason,
    )
  )
}

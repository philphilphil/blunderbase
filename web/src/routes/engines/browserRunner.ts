/**
 * Page-local wording for the browser runner, kept out of the component so the sentences it
 * puts on screen can be read — and asserted — on their own. The same split `runners.ts`
 * makes for the machines below it.
 *
 * The engine row is the one line that has to earn its place. A runner in a browser looks
 * exactly like a runner on a machine in every list this app already has, so its row says
 * the three things that are only true here: it is *this browser*, it has as many threads as
 * the page was allowed, and whether it was allowed any. `1 thread (not isolated)` is not a
 * decoration — it is the difference between an engine at full speed and one at an eighth of
 * it, and the cause (a proxy stripping COOP/COEP) is not something the owner would ever
 * guess from a run that is merely slow.
 */
import type { BrowserRunnerState } from '@/lib/runner'

export type BrowserTone = 'connected' | 'working' | 'degraded' | 'away' | 'bad'

export interface BrowserStatus {
  label: string
  tone: BrowserTone
}

/** What the status pill says, and how loudly. */
export function statusLabel(state: BrowserRunnerState): BrowserStatus {
  switch (state.phase) {
    case 'off':
      return { label: 'not running', tone: 'away' }
    case 'starting':
      return { label: 'loading the engine', tone: 'working' }
    case 'connecting':
      return { label: 'connecting', tone: 'working' }
    case 'retrying':
      return { label: 'reconnecting', tone: 'degraded' }
    case 'refused':
      return { label: 'stopped', tone: 'bad' }
    default:
      return state.activeRuns > 0
        ? { label: `analysing ${state.activeRuns === 1 ? 'a game' : `${state.activeRuns} games`}`, tone: 'connected' }
        : { label: 'connected · idle', tone: 'connected' }
  }
}

/**
 * `Stockfish 18 · browser · 8 threads`, or `… · 1 thread (not isolated)`.
 *
 * "browser" where every other engine row shows a path: the backend puts `path_scheme:
 * "wasm"` on the row precisely so no client has to parse `wasm:stockfish-18` and pretend it
 * is a file. There is no filesystem to name here.
 */
export function engineLabel(state: BrowserRunnerState): string {
  const name = state.engineName ?? 'Stockfish'
  const threads = `${state.threads} ${state.threads === 1 ? 'thread' : 'threads'}`
  return `${name} · browser · ${threads}${state.isolated ? '' : ' (not isolated)'}`
}

/** Whether the row can say anything about an engine yet. */
export function hasEngine(state: BrowserRunnerState): boolean {
  return state.engineName !== null
}

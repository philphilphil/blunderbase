/**
 * Browser-hosted Stockfish: this tab registered as an analysis runner.
 *
 * The surface a screen is allowed to use, and nothing else. Everything behind it — the
 * WebAssembly module, the UCI text, the plan port, the socket state machine — is an
 * implementation detail of `browserRunner`, and a component that reached past this barrel
 * would be a component that can start a second engine.
 *
 * The rest of the module, roughly in the order a run travels through it:
 * `support.ts` (can this browser do it at all) → `credential.ts` (is one installed here) →
 * `client.ts` (the socket, `backend/runners/client.py`'s twin) → `engine.ts` (the build,
 * `adapters/stockfish.py`'s twin) → `plan.ts` (`services/analysis.analyse_plan`, ported).
 * An analysis board takes the same road as far as `engine.ts` and turns off into
 * `snapshots.ts` (`adapters/infinite.py`, ported) instead of `plan.ts`.
 */
export { ENGINE_PATH as BROWSER_ENGINE_PATH } from './engine'

export type {
  BrowserRunnerPhase,
  BrowserRunnerState,
  RefusedEngine,
} from './client'

export type { RunnerCredential } from './credential'
export { clearCredential, readCredential, writeCredential } from './credential'

export type { RunnerSupport, ThreadPlan } from './support'
export { browserRunnerName, browserRunnerSupport, threadPlan } from './support'

export { browserRunner, useBrowserRunner } from './store'

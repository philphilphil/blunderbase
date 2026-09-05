/**
 * Installing this browser as a runner, as one function, because two screens do it.
 *
 * The Engines page has a button for it, and the no-engine dialog that a Quick, Deep or
 * continuous-analysis gesture opens on a deployment with nothing assigned has the same
 * button — the whole point of that dialog is that the owner never has to leave the game
 * to get an engine. Two copies of "mint a runner, dodge a taken name, hand the token to the
 * client" would drift, and the naming rule is the part that would drift first.
 *
 * Nothing here touches the singleton in `store.ts`: `start` is handed in. That keeps the
 * function pure enough for a screen's tests to run it against a stand-in client, and keeps
 * this module importable without an engine anywhere near it.
 */
import { t } from '@lingui/core/macro'

import { ApiError } from '@/lib/api/client'
import type { RunnerCreate, RunnerCreated } from '@/lib/api/types'

import type { BrowserRunnerState } from './client'
import type { RunnerCredential } from './credential'
import { browserRunnerName } from './support'

/** How many names to try before giving up and letting the duplicate error through. */
const NAME_ATTEMPTS = 5

/** Fifteen megabytes of engine on a slow link, then a handshake. Generous on purpose. */
const READY_TIMEOUT_MS = 90_000

export interface InstallBrowserRunnerOptions {
  /** `POST /runners`, however the caller wants it issued (a mutation, or the endpoint). */
  create: (body: RunnerCreate) => Promise<RunnerCreated>
  /** `browserRunner.start` — the client that will hold the token and dial in. */
  start: (credential: RunnerCredential) => void
  /** Defaults to this browser's own. A parameter so a test can name the browser. */
  userAgent?: string
}

/**
 * Register this browser as a runner and start it. The server's answer, for the caller
 * that wants to show the name.
 *
 * The runner is named after the browser and platform ("Chrome on macOS") and, because
 * runner names are unique per deployment, a second browser on the same kind of machine
 * gets a numbered suffix rather than a form asking for a name for something that should
 * be one press. Only a 409 is retried; anything else is the owner's to see.
 */
export async function installBrowserRunner({
  create,
  start,
  userAgent,
}: InstallBrowserRunnerOptions): Promise<RunnerCreated> {
  const agent = userAgent ?? (typeof navigator === 'undefined' ? undefined : navigator.userAgent)
  const created = await mintRunner(browserRunnerName(agent), (name) => create({ name, slots: 1 }))
  start({
    runnerId: created.runner.id,
    // The server's own name, not the one we asked for: it may have held us to something
    // else, and the engine this tab advertises is named after it.
    runnerName: created.runner.name,
    token: created.token,
  })
  return created
}

async function mintRunner<T>(
  proposed: string,
  create: (name: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const name = attempt === 1 ? proposed : `${proposed} (${attempt})`
    try {
      return await create(name)
    } catch (cause) {
      const taken = cause instanceof ApiError && cause.status === 409
      if (!taken || attempt >= NAME_ATTEMPTS) throw cause
    }
  }
}

/** The two halves of an external store; `browserRunner` is one. */
export interface RunnerStateSource {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => BrowserRunnerState
}

/**
 * Settles once this tab's engine is registered on the server and the link is up — the
 * moment a run or a board can be sent to it — or rejects with the reason it never will be.
 *
 * "Registered" is the server's word, not the tab's: the client reports `connected` only
 * after the welcome frame, and by then `sync_runner_engines` has written the engine row
 * and handed it any role nobody held. A refusal named in that frame (`refused`) is an
 * engine that will not be dispatched to, so it rejects too, in the server's own words.
 * The check is deferred a microtask because the client patches the phase and the
 * refusals in two steps, and a listener that read the first would miss the second.
 */
export function whenBrowserEngineReady(
  source: RunnerStateSource,
  timeoutMs: number = READY_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false
    let unsubscribe = () => {}
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (failure: Error | null) => {
      if (done) return
      done = true
      unsubscribe()
      if (timer !== null) clearTimeout(timer)
      if (failure) reject(failure)
      else resolve()
    }
    const check = () => {
      const state = source.getSnapshot()
      if (state.phase === 'connected') {
        const refused = state.refused[0]
        if (refused) finish(new Error(`${refused.name}: ${refused.reason}`))
        else if (state.engineName !== null) finish(null)
      } else if (state.phase === 'refused') {
        finish(new Error(state.error?.message ?? t`the engine could not be started`))
      }
    }
    unsubscribe = source.subscribe(() => queueMicrotask(check))
    timer = setTimeout(() => finish(new Error(t`the engine did not come up in time`)), timeoutMs)
    queueMicrotask(check)
  })
}

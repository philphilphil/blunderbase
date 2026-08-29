/**
 * The one instance of the runner, and the one thing React is allowed to see of it.
 *
 * A module singleton rather than a provider on purpose. The link has to survive route
 * changes, a re-render must never restart an engine that took seconds and 15 MB to load,
 * and a run in flight belongs to the tab, not to whichever screen happens to be mounted.
 * So the whole machine lives outside the tree and `useSyncExternalStore` is the entire
 * bridge — `getSnapshot` hands back a cached object that only changes when the state
 * really did, which is what keeps that hook from looping.
 *
 * `beforeunload` closes the socket deliberately. It is a courtesy rather than a
 * requirement: the server's stale sweep would collect the runs 60 seconds later anyway,
 * and `browser: true` on the `hello` is what makes that collection a refund rather than a
 * spent attempt. Closing on the way out simply means the queue moves on at once.
 */
import { useSyncExternalStore } from 'react'

import { BrowserRunnerClient, defaultDeps, type BrowserRunnerState } from './client'

export const browserRunner = new BrowserRunnerClient(defaultDeps())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => browserRunner.shutdown())
}

export function useBrowserRunner(): BrowserRunnerState {
  return useSyncExternalStore(
    browserRunner.subscribe,
    browserRunner.getSnapshot,
    browserRunner.getSnapshot,
  )
}

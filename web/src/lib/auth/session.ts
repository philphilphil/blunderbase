/**
 * The seam between "a request came back 401" and "the page should show the login screen".
 *
 * It is a plain module-level bus rather than a context because the two places that learn a
 * session has ended — the fetch wrapper in `lib/api/client.ts` and the `/events` socket —
 * are both outside React's tree, and neither may import the provider without a cycle.
 * `AuthProvider` is the only listener that matters; `EventsProvider` listens for the way
 * back, so a socket stopped by a 4401 reconnects the moment a session exists again.
 */

/** Which of the backend's two unauthenticated states a guarded route reported. */
export type SessionLoss = 'unauthorized' | 'setup_required'

const lost = new Set<(reason: SessionLoss) => void>()
const restored = new Set<() => void>()

export function isSessionLoss(error: string): error is SessionLoss {
  return error === 'unauthorized' || error === 'setup_required'
}

export function onSessionLost(listener: (reason: SessionLoss) => void): () => void {
  lost.add(listener)
  return () => void lost.delete(listener)
}

/** Called from the API client and the socket. Never from a component. */
export function reportSessionLost(reason: SessionLoss): void {
  for (const listener of [...lost]) listener(reason)
}

export function onSessionRestored(listener: () => void): () => void {
  restored.add(listener)
  return () => void restored.delete(listener)
}

/** Called when the app is signed in again — after a login, a setup, or a reload. */
export function reportSessionRestored(): void {
  for (const listener of [...restored]) listener()
}

/**
 * Where the installed runner's token lives in this browser.
 *
 * Three things worth stating plainly, because each one is a way to get this wrong:
 *
 * - **The token is a credential.** It is a bearer token minted by the server, and anything
 *   holding it can be dispatched this deployment's analysis work. It goes in
 *   `localStorage` because a runner has to survive a reload and there is nowhere better in
 *   a page with no server side of its own — but that means `forget()` is *not* an
 *   uninstall. Clearing it here only makes this browser stop using it; the runner row and
 *   the token keep existing until the owner revokes them server-side, which is why the
 *   Engines page revokes first and forgets second.
 * - **The key is per deployment.** Origin plus `API_BASE`, so a browser pointed at a
 *   staging instance and at the real one holds two credentials and never presents one to
 *   the other. Two deployments behind one origin at different API bases are the case the
 *   base is in the key for.
 * - **Every access can throw.** A private window, a browser configured to block site data,
 *   an embedded webview: reading `window.localStorage` at all raises there. Every call is
 *   wrapped, and a browser that will not store anything simply behaves as one where
 *   nothing is installed.
 */
import { API_BASE } from '@/lib/api/client'

export interface RunnerCredential {
  runnerId: number
  runnerName: string
  token: string
}

/** The little of `Storage` this file uses, so a test can hand over a plain object. */
export interface CredentialStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const PREFIX = 'blunderbase.runner'

/** `blunderbase.runner:https://chess.example/api` — one entry per deployment. */
export function credentialKey(): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return `${PREFIX}:${origin}${API_BASE}`
}

/** `window.localStorage`, or null in a context that will not give it up. */
export function defaultStore(): CredentialStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readCredential(store: CredentialStore | null = defaultStore()): RunnerCredential | null {
  if (!store) return null
  let raw: string | null
  try {
    raw = store.getItem(credentialKey())
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const { runnerId, runnerName, token } = parsed as Record<string, unknown>
    if (typeof runnerId !== 'number' || typeof token !== 'string' || !token) return null
    return { runnerId, runnerName: typeof runnerName === 'string' ? runnerName : '', token }
  } catch {
    // Something else wrote under our key, or the entry was truncated. Either way there is
    // no credential here, and a half-parsed one would only fail at the handshake.
    return null
  }
}

export function writeCredential(
  credential: RunnerCredential,
  store: CredentialStore | null = defaultStore(),
): void {
  try {
    store?.setItem(credentialKey(), JSON.stringify(credential))
  } catch {
    // Storage is full or forbidden. The runner still works for the life of this tab.
  }
}

export function clearCredential(store: CredentialStore | null = defaultStore()): void {
  try {
    store?.removeItem(credentialKey())
  } catch {
    // Nothing to do about a store that will not let go.
  }
}

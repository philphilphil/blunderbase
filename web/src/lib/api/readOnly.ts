/**
 * The seam between "a write came back 403 `read_only`" and "the shell should say why".
 *
 * The public demo refuses every write at the door (`backend/api/readonly.py`), and the
 * refusal lands in whichever mutation happened to be the one clicked — a note, a setting,
 * an import. Each of those already renders its own failure, but none of them knows the
 * failure is a fact about the deployment rather than about the request, and teaching every
 * mutation site would be forty copies of one sentence. So the fetch wrapper reports it here
 * and the shell, which is mounted exactly once, says it once — the same shape as
 * `lib/auth/session.ts`, and for the same reason: the wrapper is outside React's tree.
 */

export const READ_ONLY = 'read_only'

const listeners = new Set<() => void>()

export function isReadOnlyRefusal(status: number, error: string): boolean {
  return status === 403 && error === READ_ONLY
}

export function onWriteRefused(listener: () => void): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** Called from the API client. Never from a component. */
export function reportWriteRefused(): void {
  for (const listener of [...listeners]) listener()
}

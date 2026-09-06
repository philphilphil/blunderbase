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
 *
 * The refusal's own text is replaced on the way through as well. The backend's detail is
 * written for a curl or an MCP client, in English, and each mutation site renders whatever
 * message its error carries in red under the control that failed — so the message every
 * one of them shows is the one short sentence below, in the visitor's language, rather
 * than a server sentence the shell's toast is about to say again.
 */
import { t } from '@lingui/core/macro'

export const READ_ONLY = 'read_only'

/** What a refused write says wherever its error is rendered. */
export function readOnlyMessage(): string {
  return t`This is a read-only demo.`
}

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

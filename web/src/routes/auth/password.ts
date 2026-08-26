import { ApiError } from '@/lib/api/client'

/** `backend/services/auth.py: MIN_PASSWORD_LENGTH`. Checked here so a short one costs no round trip. */
export const MIN_PASSWORD_LENGTH = 8

/**
 * What is wrong with a new password, before the server is asked. The server's own refusal
 * is `weak_password` and says the same thing, so this is a shortcut, never the only guard.
 */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `a password has to be at least ${MIN_PASSWORD_LENGTH} characters`
  }
  if (password !== confirm) return 'those two do not match'
  return null
}

/**
 * A failed auth call, in one line.
 *
 * `locked_out` carries the wait in its `detail` and in no other field, so the server's
 * sentence is passed through verbatim rather than parsed for a number to re-word — the
 * same for `weak_password`, which names the length rule. Only the two cases with nothing
 * useful to quote get words of ours.
 */
export function authErrorMessage(error: Error): string {
  if (!(error instanceof ApiError)) return 'could not reach Blunderbase — is the server running?'
  if (error.error === 'invalid_password') return 'that is not the password'
  if (error.error === 'http_error') return `the server answered ${error.status}`
  return error.message
}

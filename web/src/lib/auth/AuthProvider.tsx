/**
 * Which of the four screens the app is on: still asking, setup, login, or the app itself.
 *
 * `GET /auth/status` is the only source of truth, and everything that changes the answer
 * writes into that one query key — the login and setup mutations with what the server
 * handed back, a guarded 401 through `session.ts` with what it means. So there is no
 * second copy of "am I signed in" to fall out of step, and the gate is a `switch` over a
 * derived value rather than a state machine of its own.
 */
import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'

import { queryKeys } from '@/lib/api/keys'
import { useAuthStatus } from '@/lib/api/queries'
import { DEFAULT_MAIA_TARGET_ELO, SERVER_CAPABILITIES } from '@/lib/api/types'
import type { AuthStatus } from '@/lib/api/types'
import { RuntimeCapabilitiesProvider } from '@/lib/runtime/RuntimeCapabilitiesProvider'

import { onSessionLost, reportSessionRestored } from './session'

export type AuthPhase = 'loading' | 'setup' | 'login' | 'ready'

export interface AuthValue {
  status: AuthPhase
  /**
   * The status call itself never came back. That is the backend being down rather than the
   * session being over, so the screen says so instead of accusing the owner of being signed
   * out — and it stays `loading`, because nothing has been learned yet.
   */
  unreachable: boolean
  /** Ask again. The `/events` socket coming up does this too, for the case nobody clicks. */
  recheck: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

/** Pure, and the whole routing decision: what the server said maps onto one screen. */
export function phaseOf(status: AuthStatus | undefined): AuthPhase {
  if (!status) return 'loading'
  // A desktop launch with a missing/invalid launch token cannot be repaired with an owner
  // password, so it must never expose the server login form.
  if (status.capabilities && !status.capabilities.password_auth && !status.authenticated) {
    return 'loading'
  }
  if (status.setup_required) return 'setup'
  return status.authenticated ? 'ready' : 'login'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const query = useAuthStatus()
  const status = phaseOf(query.data)

  // A guarded route answering 401 mid-session is the same event as `/auth/status` saying
  // so, and is recorded the same way — which also stops the query refetching to be told
  // what it already knows.
  useEffect(
    () =>
      onSessionLost((reason) => {
        queryClient.setQueryData<AuthStatus>(queryKeys.auth(), (previous) => ({
          setup_required: reason === 'setup_required',
          authenticated: false,
          capabilities: previous?.capabilities ?? SERVER_CAPABILITIES,
          // The deployment's Maia level outlives the session that was told about it.
          maia_target_elo: previous?.maia_target_elo ?? DEFAULT_MAIA_TARGET_ELO,
        }))
      }),
    [queryClient],
  )

  // Everything the session cached goes with the session. This runs in an effect rather
  // than beside the state change on purpose: by the time it fires the app has already been
  // swapped for the login screen, so no observer is left to answer a removal by refetching
  // — which would be a 401 for every query on the page.
  const wasReady = useRef(false)
  useEffect(() => {
    if (status === 'ready') {
      if (!wasReady.current) {
        wasReady.current = true
        reportSessionRestored()
      }
      return
    }
    if (!wasReady.current) return
    wasReady.current = false
    void queryClient.cancelQueries()
    queryClient.removeQueries({
      predicate: (cached) => cached.queryKey[0] !== queryKeys.auth()[0],
    })
  }, [status, queryClient])

  const { refetch } = query
  const recheck = useCallback(() => void refetch(), [refetch])

  const value = useMemo<AuthValue>(
    () => ({ status, unreachable: query.isError, recheck }),
    [status, query.isError, recheck],
  )

  return (
    <AuthContext.Provider value={value}>
      <RuntimeCapabilitiesProvider
        capabilities={query.data?.capabilities ?? SERVER_CAPABILITIES}
      >
        {children}
      </RuntimeCapabilitiesProvider>
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}

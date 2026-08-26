import type { ReactNode } from 'react'

import { AuthProvider, useAuth } from '@/lib/auth/AuthProvider'
import { AuthLoading, LoginPage, SetupPage } from '@/routes/auth'

/**
 * Which screen the app is: the whole routing decision in one `switch`.
 *
 * The shell is not rendered — not hidden, not behind an overlay — until the status call
 * says there is a session, so a signed-out browser never mounts a page that would fire a
 * dozen guarded requests to be refused. It sits inside `<Providers>` rather than around
 * them so that the query cache, the theme and the `/events` socket are the same ones on
 * both sides of the door.
 */
function Gate({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  switch (status) {
    case 'loading':
      return <AuthLoading />
    case 'setup':
      return <SetupPage />
    case 'login':
      return <LoginPage />
    default:
      return <>{children}</>
  }
}

export function AuthGate({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <Gate>{children}</Gate>
    </AuthProvider>
  )
}

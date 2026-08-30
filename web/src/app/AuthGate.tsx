import type { ReactNode } from 'react'

import { AuthProvider, useAuth } from '@/lib/auth/AuthProvider'
import { EventsProvider } from '@/lib/events/EventsProvider'
import { AuthLoading, LoginPage, SetupPage } from '@/routes/auth'

/**
 * Which screen the app is: the whole routing decision in one `switch`.
 *
 * The shell is not rendered — not hidden, not behind an overlay — until the status call
 * says there is a session, so a signed-out browser never mounts a page that would fire a
 * dozen guarded requests to be refused. `/events` mounts only on the authenticated side:
 * a desktop launch rotates its cookie, so a socket opened during the status request could
 * be refused with the previous launch's cookie and undo a successful bootstrap.
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
      return <EventsProvider>{children}</EventsProvider>
  }
}

export function AuthGate({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <Gate>{children}</Gate>
    </AuthProvider>
  )
}

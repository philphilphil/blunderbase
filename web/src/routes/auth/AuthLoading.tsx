import { Trans } from '@lingui/react/macro'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth/AuthProvider'

/**
 * What is on screen while `/auth/status` is in flight — the app's own ground and nothing
 * else, so a signed-in owner never sees a login form flash past on the way to their games.
 *
 * The word waits a moment: on a local backend the answer arrives in a few milliseconds, and
 * a spinner that appears and vanishes inside one blink is worse than an empty ground. If
 * the call fails outright, that is the backend being down rather than a session ending, and
 * it says so at once — there is nothing to wait for.
 */
export function AuthLoading() {
  const { unreachable, recheck } = useAuth()
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 250)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div
      data-testid="auth-loading"
      className="flex h-full min-h-0 items-center justify-center bg-void px-6"
    >
      {unreachable ? (
        <div className="flex max-w-[20rem] flex-col items-center gap-2.5 text-center">
          <p className="text-xs text-ink">
            <Trans>Blunderbase is not answering.</Trans>
          </p>
          <p className="text-[0.6875rem] leading-[1.6] text-dim">
            <Trans>
              The page is here but the server behind it is not, so there is nothing to sign
              in to yet. It reconnects on its own once the backend is back.
            </Trans>
          </p>
          <Button variant="outline" size="sm" onClick={recheck}>
            <Trans>Try again</Trans>
          </Button>
        </div>
      ) : slow ? (
        <p className="text-xs text-dim">
          <Trans>Checking your session…</Trans>
        </p>
      ) : null}
    </div>
  )
}

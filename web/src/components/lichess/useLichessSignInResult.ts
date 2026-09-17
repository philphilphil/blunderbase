import { useLingui } from '@lingui/react/macro'
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useLichessConnection } from '@/lib/api/queries'
import { toast } from '@/lib/toast'

/**
 * The web app coming back from Lichess: say how the sign-in went, once, and take the
 * `?lichess=` marker off the address so a reload does not say it again. Mounted by the shell,
 * because the sign-in returns to whichever screen it was started from. The desktop app never
 * gets the marker — its sign-in finishes in the person's browser (`ConnectLichess.tsx`).
 */
export function useLichessSignInResult() {
  const { t } = useLingui()
  const [params, setParams] = useSearchParams()
  const outcome = params.get('lichess')
  const connection = useLichessConnection({ enabled: outcome === 'connected' })
  const username = connection.data?.username

  useEffect(() => {
    if (!outcome) return
    if (outcome === 'connected') {
      // Wait for the name, so the sentence can say whose account it was.
      if (!connection.isFetched) return
      toast.success(username ? t`Connected to Lichess as ${username}` : t`Connected to Lichess`)
    } else if (outcome === 'denied') {
      toast.info(t`Lichess was not connected.`)
    } else if (outcome === 'expired') {
      toast.error(t`That Lichess sign-in expired. Press Connect Lichess again.`)
    } else {
      toast.error(t`Lichess could not complete the sign-in. Try again.`)
    }
    const next = new URLSearchParams(params)
    next.delete('lichess')
    setParams(next, { replace: true })
  }, [outcome, connection.isFetched, username, params, setParams, t])
}

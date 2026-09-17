/**
 * "Connect Lichess": the sign-in that replaced pasting a personal API token.
 *
 * One Lichess token does two jobs — the masters and rated books refuse anonymous requests,
 * and the live import follows the owner's event stream — so one button gets it, from
 * wherever the missing token is first felt: the explorer's reference tabs, a reference
 * game, the correspondence book and the Lichess box on Import.
 *
 * The button asks the backend for Lichess's approval page and sends the browser there.
 * The callback address is built from where the page itself is loaded rather than left to
 * the server, because only the page knows the address a reverse proxy or a LAN IP gave it.
 * In the web app the whole tab goes, and Lichess sends it back to the same screen with
 * `?lichess=` saying how it went (`useLichessSignInResult.ts`). The desktop app cannot do
 * that: its window has none of the person's Lichess cookies, so they would have to type
 * their Lichess password into it. It opens the approval page in their own browser instead,
 * and the callback there is answered with a page to close; this window learns about the
 * new token over `/events`, which is why the button only says where to look meanwhile.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { apiUrl } from '@/lib/api/client'
import { useConnectLichess } from '@/lib/api/queries'
import { hasNativeBridge, openNatively } from '@/lib/desktop/nativeBridge'
import { cn } from '@/lib/utils'

export function ConnectLichessButton({
  reconnect = false,
  size = 'sm',
  className,
}: {
  /** Say "Reconnect" — for a token Lichess refused or one that has no name yet. */
  reconnect?: boolean
  size?: 'sm' | 'default'
  className?: string
}) {
  const { t } = useLingui()
  const connect = useConnectLichess()
  const [inBrowser, setInBrowser] = useState(false)

  function start() {
    const desktop = hasNativeBridge()
    connect.mutate(
      {
        redirect_uri: new URL(apiUrl('/lichess/callback'), window.location.href).href,
        return_to: `${window.location.pathname}${window.location.search}`,
        desktop,
      },
      {
        onSuccess: ({ url }) => {
          if (!desktop) {
            window.location.assign(url)
            return
          }
          void openNatively(url)
          setInBrowser(true)
        },
      },
    )
  }

  return (
    <div className={cn('flex flex-col items-start gap-1.5', className)}>
      <Button type="button" size={size} disabled={connect.isPending} onClick={start}>
        {reconnect ? t`Reconnect Lichess` : t`Connect Lichess`}
      </Button>
      {inBrowser ? (
        <p className="text-[0.6875rem] text-dim">
          <Trans>Finish signing in in your browser. This updates by itself.</Trans>
        </p>
      ) : null}
      {connect.error ? (
        <p className="text-[0.6875rem] text-blunder">{connect.error.message}</p>
      ) : null}
    </div>
  )
}

/**
 * Where a reference book would have been, when it cannot be read.
 *
 * Not an error card: there is nothing wrong with the position, Lichess simply has not been
 * connected yet. A refused token says so, because the person did connect once and deserves
 * to know why it stopped — revoked on lichess.org, or a year old.
 */
export function LichessConnectCard({ reason }: { reason: 'missing' | 'rejected' }) {
  const { t } = useLingui()
  return (
    <div className="flex flex-col items-start gap-2.5 rounded-xl border border-edge-strong bg-panel p-5">
      <span className="text-[0.75rem] font-semibold text-ink">
        {reason === 'rejected' ? t`Lichess refused the connection` : t`Connect Lichess`}
      </span>
      <p className="text-[0.78125rem] leading-relaxed text-soft">
        {reason === 'rejected'
          ? t`Lichess no longer accepts the stored sign-in. It may have been revoked, or it expired after a year. Connect again to read the masters and lichess databases.`
          : t`The masters and lichess databases only answer signed-in requests. Connect your Lichess account to read them; the same connection imports your Lichess games as soon as they end.`}
      </p>
      <ConnectLichessButton reconnect={reason === 'rejected'} />
    </div>
  )
}

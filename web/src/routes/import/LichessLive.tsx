/**
 * The Lichess box's connection line: who Blunderbase is signed in to Lichess as, and whether
 * new games are arriving live.
 *
 * It sits in the Lichess account box rather than on a settings page, because the thing it
 * changes is how that box's games arrive: signed in, a game lands a moment after it ends,
 * and the Sync button and the schedule become the fallback. So it says what the stream is
 * doing in the words of that box — live, connecting, refused — and when it is off, why: the
 * sign-in names an account the library has not synced yet (the stream only ever reports
 * that account's games), or Lichess is left out of syncing.
 *
 * A token pasted before the button existed still reads the explorer but carries no name,
 * so it is offered a reconnect rather than shown as connected to nobody.
 */
import { Trans, useLingui } from '@lingui/react/macro'

import { ConnectLichessButton } from '@/components/lichess/ConnectLichess'
import { useDisconnectLichess, useLichessConnection, useSyncSchedule } from '@/lib/api/queries'
import { useRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { cn } from '@/lib/utils'

export function LichessLive() {
  const { t } = useLingui()
  const capabilities = useRuntimeCapabilities()
  const connection = useLichessConnection()
  const schedule = useSyncSchedule()
  const disconnect = useDisconnectLichess()

  if (capabilities.read_only || !connection.data) return null
  const { connected, username, synced, stream } = connection.data

  if (!connected || !username) {
    return (
      <div className="flex flex-col items-start gap-1.5 border-t border-edge pt-2">
        <p className="text-[0.6875rem] leading-relaxed text-dim">
          {connected
            ? t`Connect again to import games as soon as they end.`
            : t`Connect Lichess to import games as soon as they end.`}
        </p>
        <ConnectLichessButton reconnect={connected} />
      </div>
    )
  }

  const excluded = schedule.data?.disabled_sources?.includes('lichess') === true
  let status: string
  if (stream === 'live') status = t`Live: new games arrive as soon as they end.`
  else if (stream === 'connecting') status = t`Connecting to Lichess…`
  else if (stream === 'rejected') status = t`Lichess refused the connection.`
  else if (!synced) status = t`Sync ${username} once to import new games live.`
  else if (excluded) status = t`Live import is off while Lichess is left out of sync.`
  else status = t`Live import is off.`

  return (
    <div className="flex flex-col items-start gap-1.5 border-t border-edge pt-2">
      <div className="flex w-full items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-soft">
          <Trans>
            Connected as <span className="font-medium text-ink">{username}</span>
          </Trans>
        </span>
        <button
          type="button"
          onClick={() => disconnect.mutate()}
          disabled={disconnect.isPending}
          className="text-[0.6875rem] text-dim hover:text-ink disabled:text-faint-2"
        >
          <Trans>Disconnect</Trans>
        </button>
      </div>
      <p className="flex items-center gap-1.5 text-[0.6875rem] text-dim" data-stream={stream}>
        <span
          aria-hidden
          className={cn(
            'size-1.5 rounded-full',
            stream === 'live' ? 'bg-accent-teal' : stream === 'rejected' ? 'bg-blunder' : 'bg-faint',
          )}
        />
        {status}
      </p>
      {stream === 'rejected' ? <ConnectLichessButton reconnect /> : null}
      {disconnect.error ? (
        <p className="text-[0.6875rem] text-blunder">{disconnect.error.message}</p>
      ) : null}
    </div>
  )
}

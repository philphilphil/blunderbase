/**
 * "Show the engine" — the button on a game whose verdict an import held back.
 *
 * `GameSummary.engine_hidden` is the per-game twin of the browser's ⇧E mode: set when the
 * game was imported with **New games** set to hold it back in the Analysis settings, so the owner reads the
 * game first and asks for the engine's opinion afterwards. This is the asking. It sits in
 * the transport row's actions band, beside Analyse…, because that is the row that
 * says what to *do* to the game, and it is the one control on the screen that is about
 * this game's verdict being kept from view — so it is the one place the reader looks for
 * the way to see it. On the phone the same row is under the board, so there is no second
 * copy of it anywhere.
 *
 * Only ever rendered while the game is hidden: once the engine speaks there is nothing
 * left for the button to say, and a "hide it again" control for every game would be a
 * cluttered row in exchange for a gesture almost nobody makes. The PUT accepts it anyway,
 * for the client that wants it.
 *
 * While ⇧E is also on the button stays, and the tooltip says so: pressing it clears this
 * game's own flag, but the screen stays quiet until the mode is turned off too — otherwise
 * a press would seem to have done nothing.
 *
 * The row's tool button, plain. Its word used to be in the accent, but accent text is
 * reserved for links (the clarity pass), and a blue border or fill would make it read as a
 * toggle that is already on; the eye icon and the words say what it does.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { Eye } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useSetGameEngineHidden } from '@/lib/api/queries'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

export function EngineRevealButton({
  gameId,
  hidden,
  modeHidden,
  className,
}: {
  gameId: number
  /** `GameSummary.engine_hidden` — the button exists only while this is true. */
  hidden: boolean | undefined
  /** Whether ⇧E is on as well, so the tooltip can say the screen will stay quiet. */
  modeHidden: boolean
  className?: string
}) {
  const { t } = useLingui()
  const reveal = useSetGameEngineHidden({
    onError: (error) => toast.error(error.message),
  })
  if (!hidden) return null
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => reveal.mutate({ gameId, hidden: false })}
      disabled={reveal.isPending}
      title={
        modeHidden
          ? t`The engine was held back on this game when it was imported. Show it — the screen stays quiet until ⇧E is off as well.`
          : t`The engine was held back on this game when it was imported, so you could read it first. Show its evaluations, badges and lines now.`
      }
      // The row's tool button: accent text is a link's, and this does something.
      className={cn('flex-none max-md:h-auto max-md:py-1.5', className)}
    >
      <Eye aria-hidden />
      <Trans comment="Button in the transport row that reveals the engine on a game imported with it hidden">
        Show the engine
      </Trans>
    </Button>
  )
}

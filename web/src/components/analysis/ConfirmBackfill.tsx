import { Loader2 } from 'lucide-react'
import { useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { startBackfillRun } from '@/lib/analysis'
import { useStartBackfill } from '@/lib/api/queries'
import type { Tier } from '@/lib/api/types'
import { formatCount } from '@/routes/games/format'

/**
 * The question asked before the app is taken over, not after.
 *
 * A pass over the whole library is a decision about the evening rather than a click, so
 * the sentence has to say how much work it is, what it costs and how to get out again —
 * and it has to be said *before* `startBackfillRun` swaps the shell for the takeover
 * (`components/shell/BackfillTakeover.tsx`), because after that there is nothing left to
 * ask on.
 *
 * One dialog for both tiers and both places that start a pass — the Games page's "Analyse
 * all" and the Analysis page's two backfill buttons — because it is one decision with one
 * set of consequences, and three spellings of it would be three chances to understate the
 * cost. What differs by tier is only the sentence: a deep pass over a library is not the
 * same evening as a quick one, and the copy says so rather than leaving the owner to read
 * it off an estimate.
 */
export function ConfirmBackfill({
  tier,
  pending,
  onClose,
}: {
  tier: Tier
  pending: number
  onClose: () => void
}) {
  const start = useStartBackfill({
    onSuccess: (started) => {
      // A pass with nothing in it is no pass: the preview was stale, and the button
      // relabelling itself is the whole answer.
      if (started.queued > 0) {
        startBackfillRun({ tier: started.tier, total: started.queued, startedAt: Date.now() })
      }
      onClose()
    },
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !start.isPending) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, start.isPending])

  const games = `${formatCount(pending)} ${pending === 1 ? 'game gets' : 'games get'}`

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-void/75 px-6 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !start.isPending) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="backfill-confirm-title"
        className="bb-card flex w-full max-w-[22rem] flex-col gap-4 px-5 py-5 shadow-[0_1rem_3rem_var(--bb-shadow)]"
      >
        <div className="flex flex-col gap-1.5">
          <h2 id="backfill-confirm-title" className="text-[0.875rem] font-semibold text-ink">
            {tier === 'deep' ? 'Analyse the whole library, deeply' : 'Analyse the whole library'}
          </h2>
          <p className="text-[0.75rem] leading-[1.65] text-dim">
            {tier === 'deep' ? (
              <>
                {games} a deep pass. A deep pass costs many times what a quick one does — it
                is the budget someone waits on for a single game, spent over your whole
                library — so this is nights rather than hours. Blunderbase shows you nothing
                but the progress until it is through. You can stop it at any point.
              </>
            ) : (
              <>
                {games} a quick pass. That is hours of engine time, and Blunderbase shows you
                nothing but the progress until it is through. You can stop it at any point.
              </>
            )}
          </p>
        </div>

        {start.isError ? (
          <p className="text-[0.71875rem] leading-relaxed text-blunder">{start.error.message}</p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={start.isPending}>
            Not now
          </Button>
          <Button type="button" disabled={start.isPending} onClick={() => start.mutate(tier)}>
            {start.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Start the pass
          </Button>
        </div>
      </div>
    </div>
  )
}

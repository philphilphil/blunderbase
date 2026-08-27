import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { startBackfillRun } from '@/lib/analysis'
import { useBackfillPreview, useStartBackfill } from '@/lib/api/queries'

import { formatCount } from '../format'

/**
 * The one action the selection footer cannot express: every game in the library, not a
 * page of it.
 *
 * `/analysis/batch` takes at most 500 games per call, which is the right cap for a
 * selection and the wrong one for a ten-thousand-game night. This posts to
 * `/analysis/backfill` instead, and what comes back — a count, not runs — is what the
 * takeover counts down (`components/shell/BackfillTakeover.tsx`).
 *
 * The button carries the real number rather than a bare verb: "Analyse all 8,412" is the
 * one thing that tells the owner whether this is the hours-long job they think it is,
 * before they commit to it.
 */
const TIER = 'quick'

export function AnalyseAllButton() {
  const preview = useBackfillPreview(TIER)
  const [asking, setAsking] = useState(false)
  const pending = preview.data?.pending

  return (
    <>
      <button
        type="button"
        disabled={!pending}
        onClick={() => setAsking(true)}
        className="rounded-md border border-edge-input px-2.5 py-1.5 text-xs text-soft transition-colors hover:border-edge-hover hover:text-ink disabled:border-edge disabled:text-dim-2 disabled:hover:border-edge"
      >
        {pending === undefined
          ? 'Analyse all'
          : pending === 0
            ? 'All analysed'
            : `Analyse all ${formatCount(pending)}`}
      </button>

      {asking && pending ? (
        <ConfirmAnalyseAll pending={pending} onClose={() => setAsking(false)} />
      ) : null}
    </>
  )
}

/**
 * Asked before the app is taken over, not after: a pass this long is a decision about the
 * evening, so the sentence says how long, what it costs and how to get out again.
 */
function ConfirmAnalyseAll({ pending, onClose }: { pending: number; onClose: () => void }) {
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
        aria-labelledby="analyse-all-title"
        className="bb-card flex w-full max-w-[22rem] flex-col gap-4 px-5 py-5 shadow-[0_1rem_3rem_var(--bb-shadow)]"
      >
        <div className="flex flex-col gap-1.5">
          <h2 id="analyse-all-title" className="text-[0.875rem] font-semibold text-ink">
            Analyse the whole library
          </h2>
          <p className="text-[0.75rem] leading-[1.65] text-dim">
            {formatCount(pending)} {pending === 1 ? 'game gets' : 'games get'} a quick pass.
            That is hours of engine time, and Blunderbase shows you nothing but the progress
            until it is through. You can stop it at any point.
          </p>
        </div>

        {start.isError ? (
          <p className="text-[0.71875rem] leading-relaxed text-blunder">{start.error.message}</p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={start.isPending}>
            Not now
          </Button>
          <Button type="button" disabled={start.isPending} onClick={() => start.mutate(TIER)}>
            {start.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Start the pass
          </Button>
        </div>
      </div>
    </div>
  )
}

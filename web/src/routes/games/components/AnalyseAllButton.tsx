import { useState } from 'react'

import { ConfirmBackfill } from '@/components/analysis/ConfirmBackfill'
import { useBackfillPreview } from '@/lib/api/queries'

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
 *
 * Quick, and only quick: the tier picker belongs on the Analysis page, where the estimate
 * that makes a deep pass a decision is shown beside it. This one stays a single button on
 * the library, where the question is "and the rest of them" rather than "with what".
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
        <ConfirmBackfill tier={TIER} pending={pending} onClose={() => setAsking(false)} />
      ) : null}
    </>
  )
}


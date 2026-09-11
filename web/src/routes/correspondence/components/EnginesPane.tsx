/**
 * The right column: one pane per engine that is searching this node or has a verdict on it,
 * stacked.
 *
 * The stack is what "Stockfish and Leela at the same time" looks like — both thinking, both
 * visible, both hoverable — and it is the shape the mode is for. A position can carry two
 * verdicts that disagree, and the disagreement is the most valuable thing on the screen; a
 * column that showed one engine at a time would hide it behind a tab.
 *
 * The order is `searches.ts`'s: running first, then parked and queued, then the stored
 * verdicts nothing is working on. What a pane draws is `EnginePane`'s business; this decides
 * only which panes there are and what a node with none of them says instead.
 *
 * The clock ticks here rather than in each pane: a running search's "2d 4h" is the only
 * thing on the column that moves on its own, and one interval for the stack is one
 * re-render a minute instead of one per engine.
 */
import { Trans } from '@lingui/react/macro'
import { useEffect, useState } from 'react'

import type { CorrespondenceTreeNode } from '@/lib/api/types'
import type { HoveredLine } from '@/lib/board/useLinePreview'

import { enginePanes, isLive } from '../searches'
import { EnginePane } from './EnginePane'

export interface EnginesPaneProps {
  node: CorrespondenceTreeNode | null
  previewLine?: string | null
  onHover: (line: HoveredLine | null) => void
  onPause: (id: number) => void
  onResume: (id: number) => void
  onStop: (id: number) => void
  onPin?: (engineId: number | null) => void
  busy?: boolean
}

/** A minute: the coarsest unit `formatSpan` prints under a day, so nothing lags visibly. */
const TICK_MS = 30_000

export function EnginesPane({
  node,
  previewLine,
  onHover,
  onPause,
  onResume,
  onStop,
  onPin,
  busy,
}: EnginesPaneProps) {
  const panes = enginePanes(node)
  const running = panes.some((pane) => pane.search && isLive(pane.search))
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [running])

  if (!node || panes.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5 px-4 py-6 text-center">
        <p className="text-[0.75rem] text-dim">
          <Trans>No engine has looked at this position yet.</Trans>
        </p>
        <p className="text-[0.6875rem] leading-[1.55] text-dim-2">
          <Trans>
            Search with… puts one on it for as long as you let it. Several engines can work
            on the same position at once, each in a pane of its own.
          </Trans>
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto" data-testid="correspondence-engines">
      {panes.map((pane) => (
        <EnginePane
          key={pane.key}
          pane={pane}
          node={node}
          now={now}
          previewLine={previewLine}
          onHover={onHover}
          onPause={onPause}
          onResume={onResume}
          onStop={onStop}
          onPin={onPin}
          busy={busy}
        />
      ))}
    </div>
  )
}

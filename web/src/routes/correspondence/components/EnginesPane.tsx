/**
 * The right column's top half: what the engines say about the selected node.
 *
 * In this step there is nothing to say. No worker starts a search and no task writes an
 * evaluation, so the pane's whole job is to hold its place and be honest about why it is
 * empty — the stack of live panes, one per engine, with their lines and their Pause arrives
 * with step 2 of `docs/correspondence.md`.
 *
 * It does draw a stored verdict where one exists, because an evaluation is keyed by
 * position: a node whose position was reached in an already-analysed game can carry a
 * number before this mode has run a single engine of its own.
 *
 * Every number here goes through `inNodeFrame` first. The rows arrive from the side to
 * move's point of view, the way `MoveEval` stores a score, and the tree, the candidates
 * table and this pane are read side by side — so they are turned into the node's frame
 * once, here, rather than appearing with opposite signs in adjacent columns.
 */
import { Trans, useLingui } from '@lingui/react/macro'

import type { CorrespondenceTreeNode } from '@/lib/api/types'
import { formatVariation } from '@/lib/analysis/streamModel'
import { cachedReplay } from '@/lib/board/linePreview'
import { formatNodes, formatScore } from '@/lib/chess/evaluation'
import { useNotation } from '@/lib/chess/notationPrefs'

import { inNodeFrame } from '../format'

export function EnginesPane({ node }: { node: CorrespondenceTreeNode | null }) {
  const { t } = useLingui()
  const notate = useNotation()
  const evals = node?.evals ?? []

  if (evals.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5 px-4 py-6 text-center">
        <p className="text-[0.75rem] text-dim">
          <Trans>No engine has looked at this position yet.</Trans>
        </p>
        <p className="text-[0.6875rem] leading-[1.55] text-dim-2">
          <Trans>
            Searches — one engine on one position for as long as you let it, several at once
            — arrive in the next step. Until then the tree is where the thinking is kept.
          </Trans>
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {evals.map((one) => (
        <div key={`${one.engine_id ?? one.engine_name}`} className="border-b border-hairline">
          <div className="flex items-center gap-2 bg-panel px-2.5 py-1.5">
            <strong className="text-[0.6875rem] font-semibold text-ink">{one.engine_name}</strong>
            <span className="font-mono text-[0.625rem] text-dim">
              {one.depth ? t`depth ${one.depth}` : null}
            </span>
            <span className="flex-1" />
            <span className="font-mono text-[0.6875rem] font-semibold text-body">
              {formatScore(inNodeFrame(one, node))}
            </span>
          </div>
          {(one.best_lines ?? []).map((line) => (
            <div
              key={line.multipv}
              className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2 border-t border-hairline px-2.5 py-1.5"
            >
              <span className="font-mono text-[0.6875rem] font-semibold text-body">
                {formatScore(inNodeFrame(line, node))}
              </span>
              <span className="font-mono text-[0.625rem] leading-[1.55] text-soft">
                {node
                  ? formatVariation(
                      node.ply,
                      cachedReplay(node.fen, line.pv).moves.map((move) => notate(move.san)),
                    )
                  : line.pv.join(' ')}
              </span>
            </div>
          ))}
          {one.nodes ? (
            <div className="border-t border-hairline px-2.5 py-1 font-mono text-[0.625rem] text-dim-2">
              {formatNodes(one.nodes)} <Trans>nodes</Trans>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

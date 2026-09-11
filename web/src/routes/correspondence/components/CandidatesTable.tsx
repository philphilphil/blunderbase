/**
 * The decision table: the selected node's children, sorted by what the tree has backed up
 * from underneath them.
 *
 * This is the table the move is chosen from, which is why it is sorted by **backed** rather
 * than by the engine's own number — the engine's first choice being refuted four moves
 * later is the one thing this whole mode exists to notice, and a table sorted by the
 * refuted number would hide it. `tree.ts`'s `candidatesOf` owns the ordering; excluded
 * moves sink to the bottom whatever their number says.
 *
 * Hovering a row previews the line it starts on the board (`lib/board/linePreview`), so
 * "what happens after this" is a pointer rather than four clicks.
 *
 * The engines column carries the same three marks the tree does — a task waiting or being
 * worked on, and a stale verdict — because this is the table the move is chosen from, and
 * "that number is from a task that has not run yet" changes what the row is worth.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { Pin } from 'lucide-react'

import type { CorrespondenceTreeNode } from '@/lib/api/types'
import { formatScore } from '@/lib/chess/evaluation'
import { useNotation } from '@/lib/chess/notationPrefs'
import { cn } from '@/lib/utils'

import { MARK_CLASS, MARK_GLYPHS } from '../format'
import { backedDirection, candidatesOf, inWhiteFrame, mainlineFrom } from '../tree'

export function CandidatesTable({
  node,
  selectedId,
  onSelect,
  onHover,
}: {
  node: CorrespondenceTreeNode | null
  selectedId: number | null
  onSelect: (id: number) => void
  /** The line this row starts, as UCI — null when the pointer leaves the table. */
  onHover: (line: { id: number; pv: string[] } | null) => void
}) {
  const { t } = useLingui()
  const notate = useNotation()
  const rows = candidatesOf(node)

  if (rows.length === 0) {
    return (
      <div className="px-3 py-3 text-[0.71875rem] text-dim">
        <Trans>
          No move has been considered here yet. Play one on the board to put it in the tree.
        </Trans>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto" onMouseLeave={() => onHover(null)}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-[0.625rem] tracking-[0.1em] text-faint uppercase">
            <th className="h-6 px-2.5 text-left font-normal">
              <Trans>Move</Trans>
            </th>
            <th className="h-6 px-2.5 text-left font-normal">
              <Trans>Own</Trans>
            </th>
            <th className="h-6 px-2.5 text-left font-normal">
              <Trans>Backed</Trans>
            </th>
            <th className="h-6 px-2.5 text-left font-normal">
              <Trans>Depth</Trans>
            </th>
            <th className="h-6 px-2.5 text-left font-normal">
              <Trans>Engines</Trans>
            </th>
            <th className="h-6 px-2.5 text-left font-normal">
              <Trans>Mark</Trans>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((child) => {
            const direction = backedDirection(child)
            const engines = child.evals.map((one) => one.engine_name).filter(Boolean)
            return (
              <tr
                key={child.id}
                data-testid={`candidate-${child.id}`}
                onClick={() => onSelect(child.id)}
                onMouseEnter={() =>
                  onHover({
                    id: child.id,
                    pv: mainlineFrom(child)
                      .map((step) => step.uci ?? '')
                      .filter(Boolean),
                  })
                }
                className={cn(
                  'cursor-pointer border-t border-hairline text-[0.75rem] hover:bg-raised',
                  child.id === selectedId && 'bg-selected',
                  child.mark === 'excluded' && 'opacity-60',
                )}
              >
                <td className="h-[1.875rem] px-2.5 font-mono font-semibold text-ink">
                  {notate(child.san ?? child.uci ?? '')}
                </td>
                <td className="px-2.5 font-mono text-body">
                  {formatScore(inWhiteFrame(child.own, child.frame))}
                </td>
                <td
                  className={cn(
                    'px-2.5 font-mono',
                    direction === 'down'
                      ? 'text-mistake'
                      : direction === 'up'
                        ? 'text-good'
                        : 'text-body',
                  )}
                  title={
                    direction === 'down'
                      ? t`Refuted further down: the minimax under this move is worse for the side that plays it than its own number`
                      : direction === 'up'
                        ? t`Better than it looked: the minimax under this move is better for the side that plays it than its own number`
                        : undefined
                  }
                >
                  {formatScore(inWhiteFrame(child.backed, child.frame))}
                </td>
                <td className="px-2.5 font-mono tabular text-dim">
                  {child.own?.depth ?? '—'}
                </td>
                <td className="px-2.5 font-mono text-[0.625rem] text-dim">
                  {child.task ? (
                    <span
                      data-testid={`candidate-task-${child.id}`}
                      className="mr-1 text-accent-teal"
                      title={
                        child.task.status === 'running'
                          ? t`A task is being worked on here`
                          : t`A task is waiting in the analysis queue`
                      }
                    >
                      {child.task.status === 'running' ? '◍' : '◌'}
                    </span>
                  ) : null}
                  {child.pinned_engine_id ? (
                    <span title={t`One engine's verdict is pinned here`}>
                      <Pin
                        className="mr-1 inline size-2.5 align-[-0.0625rem] text-accent-teal"
                        aria-label={t`one engine's verdict is pinned here`}
                      />
                    </span>
                  ) : null}
                  {engines.length > 0 ? engines.join(' ') : '—'}
                  {child.disagree ? (
                    <span className="ml-1 text-mistake" title={t`Two engines disagree here`}>
                      ≠
                    </span>
                  ) : null}
                  {child.stale ? (
                    <span
                      className="ml-1 text-inaccuracy"
                      title={t`This number is stale: too shallow, or from a version of the engine you no longer have`}
                    >
                      ⟳
                    </span>
                  ) : null}
                </td>
                <td className={cn('px-2.5 font-mono', child.mark ? MARK_CLASS[child.mark] : '')}>
                  {child.mark ? MARK_GLYPHS[child.mark] : ''}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

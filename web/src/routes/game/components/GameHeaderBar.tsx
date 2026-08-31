import { SourceBadge } from '@/components/badges/SourceBadge'
import { RunStatusBadge, TierBadge, UnanalysedBadge } from '@/components/badges/TierBadge'
import type { GameRunSummary, GameSummary, RunResponse } from '@/lib/api/types'
import { formatNodes } from '@/lib/chess/evaluation'
import { relative } from '@/lib/mcp/status'
import { cn } from '@/lib/utils'

import { formatResult, formatTimeControl } from '../gameModel'

/**
 * The one line above the board: what the game *is* — opening, ECO, where it came from, at
 * what time control, how it ended — and, quiet and right-aligned, what has been done to it.
 *
 * One line, and a fixed one. The players used to be a third line here and are now the rows
 * flanking the board (`BoardPanel`), because this bar is the board's height budget spent on
 * text: every line here is a line the board is not. `BoardPanel`'s budget names this
 * element's `h-[1.875rem]` by number, so the height is declared rather than emergent —
 * `overflow-hidden` and `whitespace-nowrap` mean a long opening name is truncated instead of
 * wrapping the bar to two lines behind the budget's back.
 *
 * The date is not here: `AppShell`'s breadcrumb already carries it (`GamePage` passes it),
 * and the one thing this line cannot afford is a second copy of something.
 */
export function GameHeaderBar({
  game,
  best,
  active,
  className,
}: {
  game: GameSummary
  /** The deepest finished run, as the tier chip reports it. */
  best: GameRunSummary | null
  /** A run that is queued or running right now, from `/analysis/runs`. */
  active: RunResponse | null
  className?: string
}) {
  const timeControl = formatTimeControl(game)

  return (
    <div
      data-testid="game-header"
      className={cn(
        'flex h-[1.875rem] flex-none items-center gap-2 overflow-hidden whitespace-nowrap',
        className,
      )}
    >
      {/* The only element on the line allowed to shrink: everything after it is a chip or a
          handful of mono characters, and a truncated ECO or result says nothing at all. */}
      <h1 className="min-w-0 truncate text-sm font-semibold text-ink">
        {game.opening ?? 'Unnamed opening'}
      </h1>
      {game.eco ? (
        <span className="flex-none rounded-sm border border-edge px-[0.3125rem] py-px font-mono text-[0.6875rem] tabular text-dim">
          {game.eco}
        </span>
      ) : null}
      <SourceBadge source={game.source} size="sm" className="flex-none" />
      {timeControl ? (
        <span className="flex-none font-mono text-[0.6875rem] text-dim">{timeControl}</span>
      ) : null}
      <span className="flex-none text-faint-2">·</span>
      <span className="flex-none font-mono text-[0.6875rem] tabular text-soft">
        {formatResult(game.result)}
      </span>
      {game.rated === false ? (
        <span className="flex-none text-[0.6875rem] text-faint">casual</span>
      ) : null}

      {/* The spacer is what makes the analysis state right-aligned rather than a sixth fact
          about the game: it is about the app's work, not about the game. */}
      <div className="flex-1" />

      {active ? (
        <RunStatusBadge status={active.status} className="flex-none" />
      ) : best ? (
        <TierBadge
          tier={best.tier}
          depth={best.depth}
          nodes={nodeLabel(best)}
          className="flex-none"
        />
      ) : (
        <UnanalysedBadge className="flex-none" />
      )}
      <span className="flex-none font-mono text-[0.625rem] text-faint">
        {best?.finished_at ? `analysed ${relative(best.finished_at)}` : 'never analysed'}
      </span>
    </div>
  )
}

function nodeLabel(run: GameRunSummary): string | null {
  const nodes = formatNodes(run.nodes)
  const multipv = run.multipv && run.multipv > 1 ? ` · MPV ${run.multipv}` : ''
  return nodes === '—' ? null : `${nodes}n${multipv}`
}

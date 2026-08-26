import { SourceBadge } from '@/components/badges/SourceBadge'
import { RunStatusBadge, TierBadge, UnanalysedBadge } from '@/components/badges/TierBadge'
import type { GameRunSummary, GameSummary, RunResponse } from '@/lib/api/types'
import { formatNodes } from '@/lib/chess/evaluation'
import { relative } from '@/lib/mcp/status'
import { cn } from '@/lib/utils'

import { formatGameDate, formatResult, formatTimeControl } from '../gameModel'

/**
 * The block above the board: opening, where the game came from, both players with their
 * ratings and the result, and on the right what analysis has been done to it and when.
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
  const winner = game.result === '1-0' ? 'white' : game.result === '0-1' ? 'black' : null

  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-[0.3125rem]">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-sm font-semibold text-ink">
            {game.opening ?? 'Unnamed opening'}
          </h1>
          {game.eco ? (
            <span className="flex-none rounded-sm border border-edge px-[0.3125rem] py-px font-mono text-[0.6875rem] tabular text-dim">
              {game.eco}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[0.6875rem] text-dim">
          <SourceBadge source={game.source} size="sm" />
          {timeControl ? <span className="font-mono">{timeControl}</span> : null}
          <span className="text-faint-2">·</span>
          <span className="font-mono tabular">{formatResult(game.result)}</span>
          {game.rated === false ? <span className="text-faint">casual</span> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[0.71875rem]">
          <Player
            name={game.white}
            rating={game.white_rating}
            isOwner={game.color === 'white'}
            won={winner === 'white'}
          />
          <span className="text-faint-2">vs</span>
          <Player
            name={game.black}
            rating={game.black_rating}
            isOwner={game.color === 'black'}
            won={winner === 'black'}
          />
        </div>
      </div>

      <div className="flex flex-none flex-col items-end gap-[0.3125rem]">
        {active ? (
          <RunStatusBadge status={active.status} />
        ) : best ? (
          <TierBadge tier={best.tier} depth={best.depth} nodes={nodeLabel(best)} />
        ) : (
          <UnanalysedBadge />
        )}
        <span className="font-mono text-[0.625rem] text-faint">
          {best?.finished_at ? `analysed ${relative(best.finished_at)}` : 'never analysed'}
        </span>
        <span className="font-mono text-[0.625rem] text-faint">{formatGameDate(game.played_at)}</span>
      </div>
    </div>
  )
}

function nodeLabel(run: GameRunSummary): string | null {
  const nodes = formatNodes(run.nodes)
  const multipv = run.multipv && run.multipv > 1 ? ` · MPV ${run.multipv}` : ''
  return nodes === '—' ? null : `${nodes}n${multipv}`
}

function Player({
  name,
  rating,
  isOwner,
  won,
}: {
  name: string | null | undefined
  rating: number | null | undefined
  isOwner: boolean
  won: boolean
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('size-[0.4375rem] rounded-full', won ? 'bg-good' : 'bg-edge-strong')} />
      <span className={cn('truncate', isOwner ? 'font-medium text-ink' : 'text-soft')}>
        {name ?? 'unknown'}
      </span>
      <span className="font-mono text-[0.65625rem] tabular text-faint">{rating ?? '—'}</span>
    </span>
  )
}

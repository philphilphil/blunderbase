import { Trans, useLingui } from '@lingui/react/macro'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { SourceBadge } from '@/components/badges/SourceBadge'
import { RunStatusBadge, TierBadge, UnanalysedBadge } from '@/components/badges/TierBadge'
import type { GameRunSummary, GameSummary, RunResponse } from '@/lib/api/types'
import { formatNodes } from '@/lib/chess/evaluation'
import { relative } from '@/lib/mcp/status'
import { cn } from '@/lib/utils'

import { formatResult, formatTimeControl } from '../gameModel'

/**
 * The bar across the top of the game screen: what the game *is* — opening, ECO, where it
 * came from, at what time control, how it ended — and, quiet and right-aligned, what has
 * been done to it.
 *
 * It spans the whole workspace rather than sitting inside the board column, which is where
 * it used to be. A title that starts a third of the way across the window and stops at the
 * board's right edge does not read as the page's title, and it left the panes to the right
 * of it with nothing above them at all. Spanning, it is the screen's own heading and the
 * rule under it is the top edge of the pane matrix.
 *
 * One line, and a fixed one: `BoardPanel`'s height budget names this element's `h-[2.625rem]`
 * by number, so the height is declared rather than emergent — `overflow-hidden` and
 * `whitespace-nowrap` mean a long opening name is truncated instead of wrapping the bar to
 * two lines behind the budget's back. The players are the rows flanking the board
 * (`BoardPanel`) rather than a second line here, for the same reason.
 *
 * The date is not here: `AppShell`'s breadcrumb already carries it (`GamePage` passes it),
 * and the one thing this line cannot afford is a second copy of something.
 *
 * When the game was opened from the library, two arrows and a counter lead the line: the
 * run the table was showing, steppable without going back to it (`gameTrail`). They are
 * first because they are about *which* game this is, which is what the rest of the line
 * describes — and they are simply absent on a game reached any other way, rather than
 * present and dead.
 */
export function GameHeaderBar({
  game,
  best,
  active,
  trail,
  className,
}: {
  game: GameSummary
  /** The deepest finished run, as the tier chip reports it. */
  best: GameRunSummary | null
  /** A run that is queued or running right now, from `/analysis/runs`. */
  active: RunResponse | null
  /** How to leave this game for the one either side of it in the run it was opened from. */
  trail?: {
    onPrevious: (() => void) | null
    onNext: (() => void) | null
  } | null
  className?: string
}) {
  const { t } = useLingui()
  const timeControl = formatTimeControl(game)
  const analysedAt = best?.finished_at ? relative(best.finished_at) : null

  return (
    <div
      data-testid="game-header"
      className={cn(
        'flex h-[2.625rem] flex-none items-center gap-2 overflow-hidden border-b border-edge-strong bg-surface px-4 whitespace-nowrap',
        className,
      )}
    >
      {trail ? (
        // No counter beside them. The run is the whole filtered library in the table's
        // order, not the page that happened to be up, so any number here would either be a
        // place in a page nobody is looking at or a running total of a library — and
        // neither is a thing the reader wanted to know. The two arrows say all there is:
        // there is a game that way, or there is not.
        <div className="flex flex-none overflow-hidden rounded-md border border-edge bg-elevated">
          <StepButton
            label={t`Previous game`}
            hint="["
            onClick={trail.onPrevious}
            icon={ChevronLeft}
          />
          <StepButton
            label={t`Next game`}
            hint="]"
            onClick={trail.onNext}
            icon={ChevronRight}
            last
          />
        </div>
      ) : null}

      {/* The only element on the line allowed to shrink: everything after it is a chip or a
          handful of mono characters, and a truncated ECO or result says nothing at all. */}
      <h1 className="min-w-0 truncate text-sm font-semibold text-ink">
        {game.opening ?? t`Unnamed opening`}
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
        <span className="flex-none text-[0.6875rem] text-faint">
          <Trans>casual</Trans>
        </span>
      ) : null}
      {game.is_owner_game === false ? (
        <span
          title={t`Added from the reference explorer. Analysed and annotated like any other game, and counted in no statistic.`}
          className="flex-none rounded-sm border border-dashed border-edge-strong px-[0.3125rem] py-px text-[0.625rem] text-dim"
        >
          <Trans>not your game</Trans>
        </span>
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
        {analysedAt ? t`analysed ${analysedAt}` : t`never analysed`}
      </span>
    </div>
  )
}

/** One end of the run: the same cell the board's transport is built from, at bar height. */
function StepButton({
  label,
  hint,
  onClick,
  icon: Icon,
  last,
}: {
  label: string
  hint: string
  onClick: (() => void) | null
  icon: typeof ChevronLeft
  last?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (${hint})`}
      disabled={!onClick}
      onClick={() => onClick?.()}
      className={cn(
        'px-1.5 py-1 text-soft transition-colors hover:bg-selected hover:text-ink disabled:cursor-default disabled:text-faint-2 disabled:hover:bg-transparent',
        !last && 'border-r border-edge',
      )}
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  )
}

function nodeLabel(run: GameRunSummary): string | null {
  const nodes = formatNodes(run.nodes)
  const multipv = run.multipv && run.multipv > 1 ? ` · MPV ${run.multipv}` : ''
  return nodes === '—' ? null : `${nodes}n${multipv}`
}

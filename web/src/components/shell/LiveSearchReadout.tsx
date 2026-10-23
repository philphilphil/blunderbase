import { Trans, useLingui } from '@lingui/react/macro'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatElapsed, useLiveSearchReading } from '@/lib/analysis'
import { formatNodes } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'
import { useSearchClock } from '@/routes/correspondence/useSearchClock'

/** How long a search has to stay on one position before the titlebar mentions it. */
export const LONG_SEARCH_MS = 10_000

/**
 * A live search that has been left to run, as a readout in the titlebar: the green dot,
 * how long the engine has been on this position, and how many nodes it has seen.
 *
 * The page's own readout (depth, nodes, speed) is beside the lines, which on the game page
 * sit behind the engine pane's Live tab and on the live board along the bottom edge — fine
 * for reading the lines, and nowhere near where a glance goes while waiting minutes for a
 * search to settle. Time is the figure that readout does not give, and the one that answers
 * "has it been long enough"; nodes is the other half of that answer, since a minute on a
 * runner is not a minute on a laptop. Depth and the engine wait in the tooltip.
 *
 * Only once the search has stayed on one position for `LONG_SEARCH_MS`. Every move restarts
 * the search, so a readout from the first second would flash on and off with each arrow key
 * while scrubbing; ten seconds in, somebody is waiting on it. A readout, so no face and no
 * border, in the queue's place on the bar and drawn the way the queue is.
 *
 * The clock ticks every second from the engine's last reported time rather than waiting
 * for the next one: at depth 40 an `info` line can be half a minute away, and a clock that
 * stands that long reads as a search that has hung.
 *
 * The node count leaves below `lg` the way the queue's word does: the clock alone already
 * says a search is running and for how long.
 */
export function LiveSearchReadout({ className }: { className?: string }) {
  const reading = useLiveSearchReading()
  const now = useSearchClock(reading !== null)
  const { t } = useLingui()
  if (!reading || reading.timeMs === null) return null
  const timeMs = reading.timeMs + Math.max(0, now - reading.at)
  if (timeMs < LONG_SEARCH_MS) return null

  // Named, because these are the placeholders a translator sees.
  const elapsed = formatElapsed(timeMs)
  const nodes = reading.nodes ? formatNodes(reading.nodes) : null
  const engine = reading.engine
  const depth = reading.depth
  const summary = depth
    ? t`${engine} has searched this position for ${elapsed}, to depth ${depth}`
    : t`${engine} has searched this position for ${elapsed}`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          data-testid="live-search-readout"
          aria-label={summary}
          className={cn('flex flex-none items-center gap-2 text-label', className)}
        >
          <span aria-hidden className="size-1.5 flex-none animate-pulse rounded-full bg-good" />
          <span className="font-mono tabular text-ink">{elapsed}</span>
          {nodes ? (
            <span className="font-mono tabular text-dim max-lg:hidden">
              <Trans>{nodes} nodes</Trans>
            </span>
          ) : null}
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-[15rem]">
        <p>{summary}</p>
      </TooltipContent>
    </Tooltip>
  )
}

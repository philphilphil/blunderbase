/**
 * Design 2c's "games in this line": the games that actually reached this position, from
 * `/explorer/positions`, each one a link into the game view.
 *
 * The way to all of them is a `TextLink` named for where it goes, "Open in Games ›": it
 * navigates, so it is a link (accent text is kept for links), and "library" was the old
 * name of the Games page. Rows are the shared `ROW` so they hover like every list.
 */
import { Trans } from '@lingui/react/macro'
import { useNavigate } from 'react-router-dom'

import { ROW } from '@/components/ui/row'
import { Skeleton } from '@/components/ui/skeleton'
import { TextLink } from '@/components/ui/text-link'
import type { PositionOccurrence } from '@/lib/api/types'
import { cn } from '@/lib/utils'

import { formatGameDate, formatResult, outcomeTone } from '@/routes/games/format'

export function GamesInLine({
  games,
  loading,
  total,
  libraryHref,
}: {
  games: PositionOccurrence[]
  loading: boolean
  /** How many games the tree says reached here; the list itself is capped. */
  total: number
  /** The Games page filtered to this line, or null when there is no ECO to filter by. */
  libraryHref: string | null
}) {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 max-md:flex-none">
      <div className="flex items-baseline gap-2">
        <span className="text-data font-semibold text-ink">
          <Trans>Games in this line</Trans>
        </span>
        <div className="flex-1" />
        {libraryHref && total > 0 ? (
          <TextLink to={libraryHref} className="text-label">
            <Trans>Open in Games</Trans>
          </TextLink>
        ) : null}
      </div>

      {loading ? (
        <div className="flex flex-col gap-1" data-testid="games-in-line-loading">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-[1.8125rem] rounded-[0.3125rem]" />
          ))}
        </div>
      ) : games.length === 0 ? (
        <p className="rounded-[0.3125rem] border border-dashed border-edge-strong px-3 py-5 text-center text-data text-dim">
          <Trans>Nothing has reached this position yet.</Trans>
        </p>
      ) : (
        // The list scrolls inside the right-hand pane on desktop; below `md` the page is
        // the only scroller, so it runs on in normal flow instead.
        <div className="flex min-h-0 flex-col overflow-y-auto font-mono text-data tabular max-md:overflow-visible">
          {games.map((occurrence) => (
            <button
              key={`${occurrence.game.id}-${occurrence.ply}`}
              type="button"
              onClick={() => navigate(`/games/${occurrence.game.id}`)}
              className={cn(
                ROW,
                'flex h-[1.8125rem] flex-none items-center gap-2.5 whitespace-nowrap rounded-sm px-2.5 text-left',
              )}
            >
              {/* `27 Dec 16` is nine mono glyphs — the cell has to hold them on one line. */}
              <span className="w-[4.25rem] flex-none text-soft">
                {formatGameDate(occurrence.game.played_at)}
              </span>
              <span className="min-w-0 flex-1 truncate font-sans text-lead text-body">
                {occurrence.game.opponent ?? '—'}
              </span>
              <span className="w-11 flex-none text-right text-soft">
                {occurrence.game.opponent_rating ?? '—'}
              </span>
              <span className="w-14 flex-none text-right text-body">
                {occurrence.move_san ?? '—'}
              </span>
              <span
                className={cn(
                  'w-[2.125rem] flex-none text-center font-semibold',
                  outcomeTone(occurrence.game.outcome),
                )}
              >
                {formatResult(occurrence.game.result)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

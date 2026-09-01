/**
 * The games Lichess returns for the position — the reference sources' answer to "games in
 * this line", and where the reference explorer stops being a table of numbers.
 *
 * A count says a move is played; a game shows what happens after it, which is the thing
 * actually worth taking from a masters database. Each row opens the game read-only at
 * `/reference/:source/:id` rather than importing it: these are other people's games, and
 * nothing on this page is allowed to become a row in the owner's library.
 *
 * Shaped like `GamesInLine` — one mono line per game, fixed columns, click to open — so the
 * two lists occupy the same place under the table and read the same way whichever source
 * the page is on. The columns differ because the facts do: there is no `played_at` and no
 * outcome-for-the-owner here, so it is the two players with their ratings, the result, the
 * year, and (lichess only) the time control.
 */
import { useNavigate } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import type { ReferenceSource, ReferenceTopGame } from '@/lib/api/types'
import { cn } from '@/lib/utils'
import { formatResult } from '@/routes/games/format'

import { resultOf } from '../reference'

/** Green for the winner's name, the way the library's rows tone an outcome. */
function nameTone(side: 'white' | 'black', winner: 'white' | 'black' | null | undefined): string {
  if (!winner) return 'text-body'
  return winner === side ? 'text-good' : 'text-soft'
}

export function ModelGames({
  source,
  games,
  loading,
}: {
  source: ReferenceSource
  games: ReferenceTopGame[]
  loading: boolean
}) {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 max-md:flex-none">
      <div className="flex items-baseline gap-2">
        <span className="text-[0.75rem] font-semibold text-ink">Model games</span>
        <span className="text-[0.6875rem] text-dim">
          {source === 'masters' ? 'from the masters database' : 'from rated lichess games'}
        </span>
      </div>

      {loading ? (
        <div className="flex flex-col gap-1" data-testid="model-games-loading">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-[1.8125rem] rounded-[0.3125rem]" />
          ))}
        </div>
      ) : games.length === 0 ? (
        <p className="rounded-[0.3125rem] border border-dashed border-edge-strong px-3 py-5 text-center text-[0.75rem] text-dim">
          This database has no game to show from here.
        </p>
      ) : (
        <div className="flex min-h-0 flex-col overflow-y-auto font-mono text-[0.71875rem] tabular max-md:overflow-visible">
          {games.map((game) => (
            <button
              key={game.id}
              type="button"
              onClick={() => navigate(`/reference/${source}/${game.id}`)}
              className="flex h-[1.8125rem] flex-none items-center gap-2.5 whitespace-nowrap rounded-[0.3125rem] px-2.5 text-left transition-colors hover:bg-elevated-2"
            >
              <span
                className={cn(
                  'min-w-0 flex-1 truncate font-sans text-[0.78125rem]',
                  nameTone('white', game.winner),
                )}
              >
                {game.white.name}
              </span>
              <span className="w-9 flex-none text-right text-dim-2">
                {game.white.rating ?? '—'}
              </span>
              <span className="w-[2.5rem] flex-none text-center font-semibold text-soft">
                {formatResult(resultOf(game.winner))}
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate font-sans text-[0.78125rem]',
                  nameTone('black', game.winner),
                )}
              >
                {game.black.name}
              </span>
              <span className="w-9 flex-none text-right text-dim-2">
                {game.black.rating ?? '—'}
              </span>
              <span className="w-9 flex-none text-right text-faint">{game.year ?? '—'}</span>
              {source === 'lichess' ? (
                <span className="w-[3.75rem] flex-none truncate text-right text-faint">
                  {game.speed ?? ''}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

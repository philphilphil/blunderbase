/**
 * Design 2a, "Recent games" — moved into the rail as a QueueCard-shaped list, one row per
 * game, so it sits beside the queue instead of stretching across the main column. Twelve
 * rows fit where five cards used to; opening/source/tier no longer have room on the line,
 * so they ride along in the row's `title` tooltip instead of disappearing.
 */
import { Link } from 'react-router-dom'

import { ClassificationBadge } from '@/components/badges/ClassificationBadge'
import { SectionHead } from '@/components/shell/Section'
import { useGameCards } from '@/lib/api/queries'
import type { GameCard as GameCardRow, WorstMoment } from '@/lib/api/types'
import { formatWinLoss } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

import { Bar, EmptyBlock, ErrorBlock } from '@/routes/stats/kit/states'

const LIST = 12
/** How many thin bars the loading skeleton stacks — enough to read as a list, not the full 12. */
const SKELETON_ROWS = 6

/** Reused from the old strip: the letter and colour a game's result reads as. */
const OUTCOME = {
  win: { letter: 'W', text: 'text-good' },
  loss: { letter: 'L', text: 'text-blunder' },
  draw: { letter: 'D', text: 'text-soft' },
} as const

function outcomeOf(game: GameCardRow) {
  if (game.outcome === 'win' || game.outcome === 'loss' || game.outcome === 'draw') {
    return OUTCOME[game.outcome]
  }
  return { letter: '·', text: 'text-dim' }
}

function worstOf(game: GameCardRow): WorstMoment | null {
  return game.worst_moments?.[0] ?? null
}

/** Everything that used to be a chip on the card, folded into one tooltip line. */
function titleOf(game: GameCardRow): string {
  const opening = `${game.opening ?? 'Unnamed opening'}${game.eco ? ` ${game.eco}` : ''}`
  const tier = game.analyzed ? (game.deep ? 'deep' : 'quick') : 'unanalysed'
  return `${opening} · ${game.source} · ${tier}`
}

function GameRow({ game }: { game: GameCardRow }) {
  const outcome = outcomeOf(game)
  const worst = worstOf(game)
  return (
    <Link
      to={`/games/${game.id}`}
      title={titleOf(game)}
      // A 28px line is a comfortable list row under a mouse and a cramped one under a
      // thumb, so the phone gets a taller one. The rule above each row but the first is
      // what makes the list a list rather than a stack of pills: `-mt-px` collapses it into
      // the row above so the hairlines do not double up.
      className="-mt-px flex items-center gap-2 border-t border-hairline px-1 py-[0.4375rem] transition-colors first:mt-0 first:border-t-0 hover:bg-raised max-md:py-2.5"
    >
      <span className={cn('font-mono text-[0.6875rem] font-semibold', outcome.text)}>
        {outcome.letter}
      </span>
      <span className="flex-1 truncate text-[0.71875rem] text-ink">
        {game.opponent ?? 'Unknown'}
      </span>
      <span className="font-mono text-[0.625rem] tabular text-dim">
        {game.opponent_rating ?? '—'}
      </span>
      <span className={cn('font-mono text-[0.6875rem] tabular', worst ? 'text-body' : 'text-dim-2')}>
        {worst ? formatWinLoss(worst.win_loss) : '—'}
      </span>
      {worst ? <ClassificationBadge classification={worst.classification} size="sm" /> : null}
    </Link>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1.5" data-testid="loading">
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <Bar key={index} className="h-4 w-full" />
      ))}
    </div>
  )
}

export function RecentGamesList() {
  const query = useGameCards({ limit: LIST })
  const games = query.data?.games ?? []

  return (
    <section className="flex flex-none flex-col gap-2">
      <SectionHead
        title="Recent games"
        end={
          <Link to="/games" className="text-[0.6875rem] text-accent-teal hover:text-accent-link">
            {query.data ? `All ${query.data.total.toLocaleString()}` : 'All games'}
          </Link>
        }
      />
      {query.isPending ? (
        <ListSkeleton />
      ) : query.isError ? (
        <ErrorBlock
          error={query.error}
          onRetry={() => void query.refetch()}
          className="flex-none"
        />
      ) : games.length === 0 ? (
        <EmptyBlock
          className="flex-none"
          action={
            <Link
              to="/library/import"
              className="rounded-md bg-accent-teal px-2.5 py-1 text-[0.6875rem] font-semibold text-accent-ink hover:bg-accent-hover"
            >
              Import games
            </Link>
          }
        >
          No games in the database yet. Sync an account or drop a PGN in and this fills up.
        </EmptyBlock>
      ) : (
        <div className="flex flex-col border-b border-hairline">
          {games.map((game) => (
            <GameRow key={game.id} game={game} />
          ))}
        </div>
      )}
    </section>
  )
}

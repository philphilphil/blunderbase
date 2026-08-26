/**
 * Design 2a, "Recent games" — the five-card strip over `/games?cards=true`.
 *
 * The design's third row is an accuracy figure. This backend computes no accuracy, so the
 * card leads on the number it does have: the win percentage the worst move of the game
 * gave away, with that move's glyph beside it.
 */
import { Link } from 'react-router-dom'

import { ClassificationBadge } from '@/components/badges/ClassificationBadge'
import { SourceBadge } from '@/components/badges/SourceBadge'
import { useGameCards } from '@/lib/api/queries'
import type { GameCard as GameCardRow, WorstMoment } from '@/lib/api/types'
import { TIER_STYLES } from '@/lib/chess/classification'
import { formatWinLoss } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

import { Bar, EmptyBlock, ErrorBlock } from '@/routes/stats/kit/states'

const STRIP = 5

/** The 2px top rule the design colours each card with. */
const OUTCOME = {
  win: { letter: 'W', line: 'var(--bb-good)', text: 'text-good' },
  loss: { letter: 'L', line: 'var(--bb-blunder)', text: 'text-blunder' },
  draw: { letter: 'D', line: 'var(--bb-muted)', text: 'text-soft' },
} as const

function outcomeOf(game: GameCardRow) {
  if (game.outcome === 'win' || game.outcome === 'loss' || game.outcome === 'draw') {
    return OUTCOME[game.outcome]
  }
  return { letter: '·', line: 'var(--bb-faint-2)', text: 'text-dim' }
}

function worstOf(game: GameCardRow): WorstMoment | null {
  return game.worst_moments?.[0] ?? null
}

/** The 10px analysis chip the strip uses, in the tier palette design 1c sets. */
function TierChip({ game }: { game: GameCardRow }) {
  if (!game.analyzed) {
    return (
      <span className="rounded-sm border border-dashed border-edge-strong px-1.5 py-px text-[0.625rem] text-dim-2">
        unanalysed
      </span>
    )
  }
  const style = TIER_STYLES[game.deep ? 'deep' : 'quick']
  return (
    <span className={cn('rounded-sm border px-1.5 py-px text-[0.625rem]', style.chipClass)}>
      {game.deep ? 'deep' : 'quick'}
    </span>
  )
}

function GameStripCard({ game }: { game: GameCardRow }) {
  const outcome = outcomeOf(game)
  const worst = worstOf(game)
  return (
    <Link
      to={`/games/${game.id}`}
      className="flex min-w-0 flex-1 flex-col gap-[0.4375rem] rounded-xl border border-line bg-panel p-[0.6875rem] transition-colors hover:border-edge-strong"
      style={{ borderTop: `0.125rem solid ${outcome.line}` }}
    >
      <div className="flex items-center gap-[0.4375rem]">
        <span className={cn('font-mono text-[0.6875rem] font-semibold', outcome.text)}>
          {outcome.letter}
        </span>
        <span className="truncate text-xs font-medium text-ink">{game.opponent ?? 'Unknown'}</span>
        <span className="font-mono text-[0.625rem] tabular text-dim">
          {game.opponent_rating ?? '—'}
        </span>
      </div>
      <div className="truncate text-[0.6875rem] text-soft-2">
        {game.opening ?? 'Unnamed opening'}{' '}
        <span className="font-mono text-dim-2">{game.eco ?? ''}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={cn('font-mono text-[0.6875rem] tabular', worst ? 'text-body' : 'text-dim-2')}>
          {worst ? formatWinLoss(worst.win_loss) : '—'}
        </span>
        <span className="text-[0.625rem] text-dim-2">worst</span>
        <div className="flex-1" />
        {worst ? <ClassificationBadge classification={worst.classification} size="sm" /> : null}
      </div>
      {/* Wraps: five cards across 1440 leave ~195px of card, and the two chips at the
          app's scale are wider than that together. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <SourceBadge source={game.source} size="sm" />
        <TierChip game={game} />
      </div>
    </Link>
  )
}

function StripSkeleton() {
  return (
    <div className="flex gap-2.5" data-testid="loading">
      {Array.from({ length: STRIP }, (_, index) => (
        <div
          key={index}
          className="flex flex-1 flex-col gap-[0.4375rem] rounded-xl border border-line border-t-2 bg-panel p-[0.6875rem]"
        >
          <Bar className="h-3 w-3/4" />
          <Bar className="h-2.5 w-full" />
          <Bar className="h-2.5 w-1/2" />
          <Bar className="h-3.5 w-2/3" />
        </div>
      ))}
    </div>
  )
}

export function RecentGamesStrip() {
  const query = useGameCards({ limit: STRIP })
  const games = query.data?.games ?? []

  return (
    <section className="flex flex-col gap-[0.5625rem]">
      <div className="flex items-baseline gap-2">
        <h2 className="text-xs font-semibold text-ink">Recent games</h2>
        <div className="flex-1" />
        <Link to="/games" className="text-[0.6875rem] text-accent-teal hover:text-accent-link">
          {query.data ? `all ${query.data.total.toLocaleString()}` : 'all games'}
        </Link>
      </div>
      {query.isPending ? (
        <StripSkeleton />
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
              to="/import"
              className="rounded-md bg-accent-teal px-2.5 py-1 text-[0.6875rem] font-semibold text-accent-ink hover:bg-accent-hover"
            >
              Import games
            </Link>
          }
        >
          No games in the database yet. Sync an account or drop a PGN in and this fills up.
        </EmptyBlock>
      ) : (
        <div className="flex gap-2.5">
          {games.map((game) => (
            <GameStripCard key={game.id} game={game} />
          ))}
        </div>
      )}
    </section>
  )
}

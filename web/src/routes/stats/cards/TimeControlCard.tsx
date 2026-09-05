/**
 * Design 2d, "Performance by time control" — the table over `/stats/performance_by_speed`.
 *
 * The design's last two columns are aggregate ACPL and accuracy. Neither exists in this
 * stats endpoint: the game page can derive one game's ACPL from its move evaluations, but
 * no service aggregates it across a bucket or computes accuracy. So the columns are the
 * two the data does support — blunders per game and the
 * average rating the bucket was played at — rather than an invented number.
 */
import type { I18n, MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'

import { SPEEDS, type StatsBucket } from '@/lib/api/types'
import { cn } from '@/lib/utils'

import { Async, LoadingRows, StatCard, type StatsQuery } from '../kit/states'
import { asPercent, buckets, numOr } from '../kit/analytics'

const SPEED_LABELS: Record<string, MessageDescriptor> = {
  bullet: msg`Bullet`,
  blitz: msg`Blitz`,
  rapid: msg`Rapid`,
  classical: msg`Classical`,
  correspondence: msg({
    message: 'Corr.',
    comment: 'Short for "correspondence", the speed of a game played over days',
  }),
  unknown: msg`Unknown`,
}

/**
 * The same speeds as words inside a sentence. A second table rather than the label
 * lowercased: lowercasing a translated noun is an English habit ("schnellschach" is wrong).
 */
const SPEED_WORDS: Record<string, MessageDescriptor> = {
  bullet: msg`bullet`,
  blitz: msg`blitz`,
  rapid: msg`rapid`,
  classical: msg`classical`,
  correspondence: msg({
    message: 'corr.',
    comment: 'Short for "correspondence", inside a sentence',
  }),
  unknown: msg`unknown`,
}

/** Fastest first, the way the design lists them; anything unrecognised falls to the end. */
function speedRank(key: string): number {
  const index = (SPEEDS as readonly string[]).indexOf(key)
  return index === -1 ? SPEEDS.length : index
}

function scoreTone(score: number): string {
  if (score >= 52) return 'text-good'
  if (score < 45) return 'text-blunder'
  return 'text-body'
}

function blunderTone(perGame: number): string {
  if (perGame <= 1) return 'text-good'
  if (perGame <= 2) return 'text-mistake'
  return 'text-blunder'
}

interface Row {
  key: string
  label: string
  games: number
  wins: number
  draws: number
  losses: number
  score: number
  blundersPerGame: number
  rating: number | null
  analyzed: number
}

/** A descriptor rather than a sentence, so the card resolves it in the reader's language. */
function sentence(rows: Row[], i18n: I18n): MessageDescriptor | undefined {
  const scored = rows.filter((row) => row.analyzed > 0)
  if (scored.length < 2) return undefined
  const fast = scored[0]
  const slow = scored[scored.length - 1]
  const gap = fast.blundersPerGame - slow.blundersPerGame
  if (Math.abs(gap) < 0.15) return msg`The clock barely changes how many pieces you give away.`
  // Named locals: the identifier is what a translator sees as the placeholder.
  const word = (row: Row) => (SPEED_WORDS[row.key] ? i18n._(SPEED_WORDS[row.key]) : row.key)
  const quick = fast.label
  const patient = word(slow)
  if (gap > 0) {
    const extra = gap.toFixed(1)
    return msg`${quick} costs you ${extra} more blunders a game than ${patient}. Time is the cheapest thing you can buy.`
  }
  const extra = Math.abs(gap).toFixed(1)
  const brisk = word(fast)
  return msg`You blunder ${extra} more per game at ${patient} than at ${brisk}, which is the opposite of the usual excuse.`
}

export function TimeControlCard({ query }: { query: StatsQuery }) {
  const { i18n, t } = useLingui()
  const rows: Row[] = buckets(query.data)
    .map((bucket: StatsBucket) => {
      const label = SPEED_LABELS[bucket.key]
      return {
        key: bucket.key,
        label: label ? i18n._(label) : bucket.key,
        games: numOr(bucket, 'games'),
        wins: numOr(bucket, 'wins'),
        draws: numOr(bucket, 'draws'),
        losses: numOr(bucket, 'losses'),
        score: asPercent(numOr(bucket, 'score')) ?? 0,
        blundersPerGame: numOr(bucket, 'blunders_per_game'),
        rating: numOr(bucket, 'avg_rating'),
        analyzed: numOr(bucket, 'analyzed_games'),
      }
    })
    .sort((a, b) => speedRank(a.key) - speedRank(b.key))

  const busiest = rows.reduce<Row | null>(
    (best, row) => (best === null || row.games > best.games ? row : best),
    null,
  )
  const said = query.data ? sentence(rows, i18n) : undefined

  return (
    <StatCard
      compact
      title={t`Performance by time control`}
      aside={
        <span className="font-mono text-[0.625rem] tabular text-dim-2">
          <Trans>score · blunders</Trans>
        </span>
      }
      footer={said ? i18n._(said) : undefined}
    >
      <Async
        query={query}
        loading={<LoadingRows compact rows={4} />}
        empty={rows.length === 0}
        emptyMessage={<Trans>No games in this window. Import a few, or widen the window.</Trans>}
      >
        {/* Six numeric columns are ~22rem at their narrowest, so below `md` this one table
            scrolls sideways inside itself rather than reflowing. Stacking a row would put
            "Blitz" over "1,284" over "48.2" over "1.4" over "1612" and lose the only thing
            the table is for — reading one speed against another down a column. */}
        <div className="flex min-h-0 flex-1 flex-col max-md:overflow-x-auto">
          <div className="flex h-[1.125rem] flex-none items-center gap-2.5 border-b border-hairline text-[0.5625rem] tracking-[0.06em] text-dim-2 uppercase max-md:min-w-[22rem]">
            <span className="w-[4.75rem] flex-none">
              <Trans comment="Table column: the time control a bucket of games was played at">
                Control
              </Trans>
            </span>
            <span className="w-11 flex-none text-right">
              <Trans>Games</Trans>
            </span>
            <span className="flex-1">
              <Trans comment="Table column: the win/draw/loss bar">Score</Trans>
            </span>
            <span className="w-12 flex-none text-right">
              <Trans comment="Table column: score as a percentage">Score%</Trans>
            </span>
            <span className="w-12 flex-none text-right">
              <Trans comment="Table column, abbreviated: blunders per game">Bl/g</Trans>
            </span>
            <span className="w-11 flex-none text-right">
              <Trans>Rating</Trans>
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-start pt-0.5 font-mono text-[0.6875rem] tabular max-md:min-w-[22rem]">
            {rows.map((row) => {
              const played = Math.max(1, row.wins + row.draws + row.losses)
              const highlight = busiest?.key === row.key && rows.length > 1
              const { wins, draws, losses } = row
              return (
                <div
                  key={row.key}
                  className={cn(
                    'flex h-[1.25rem] items-center gap-2.5 rounded-[0.25rem] px-0.5',
                    highlight
                      ? 'bg-accent-teal/6 shadow-[inset_0_0_0_0.0625rem_color-mix(in_srgb,var(--bb-accent)_22%,transparent)]'
                      : 'hover:bg-elevated-2',
                  )}
                >
                  <span
                    className={cn(
                      'w-[4.75rem] flex-none truncate',
                      highlight ? 'text-bright' : 'text-body',
                    )}
                  >
                    {row.label}
                  </span>
                  <span
                    className={cn(
                      'w-11 flex-none text-right',
                      highlight ? 'text-body' : 'text-soft',
                    )}
                  >
                    {row.games}
                  </span>
                  <span
                    className="flex h-[0.3125rem] flex-1 overflow-hidden rounded-full"
                    title={t({
                      message: `${wins}W · ${draws}D · ${losses}L`,
                      comment: 'The initials of win, draw and loss after each count',
                    })}
                  >
                    <span className="bg-good" style={{ width: `${(row.wins / played) * 100}%` }} />
                    <span
                      className="bg-faint"
                      style={{ width: `${(row.draws / played) * 100}%` }}
                    />
                    <span
                      className="bg-blunder"
                      style={{ width: `${(row.losses / played) * 100}%` }}
                    />
                  </span>
                  <span className={cn('w-12 flex-none text-right', scoreTone(row.score))}>
                    {row.score.toFixed(1)}
                  </span>
                  <span
                    className={cn(
                      'w-12 flex-none text-right',
                      row.analyzed > 0 ? blunderTone(row.blundersPerGame) : 'text-faint',
                    )}
                  >
                    {row.analyzed > 0 ? row.blundersPerGame.toFixed(1) : '—'}
                  </span>
                  <span className="w-11 flex-none text-right text-body">
                    {row.rating === null ? '—' : Math.round(row.rating)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </Async>
    </StatCard>
  )
}

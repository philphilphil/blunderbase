/**
 * Design 2d, "Blunders by game phase" — three labelled meters over `/stats/blunders_by_phase`.
 *
 * The share is the share of *blunders*, not of moves: the question the card answers is
 * where they happen, and the blunder rate underneath it is what says whether that is
 * because more moves are played there.
 */
import type { I18n, MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Plural, Trans, useLingui } from '@lingui/react/macro'

import type { StatsBucket } from '@/lib/api/types'

import { Async, LoadingRows, MeterRow, StatCard, type StatsQuery } from '../kit/states'
import { asPercent, buckets, numOr, total } from '../kit/analytics'

/** The backend's `phase_of`: ply < 24 is the opening, and thin material is an endgame. */
const PHASES: { key: string; label: MessageDescriptor; sub: MessageDescriptor }[] = [
  { key: 'opening', label: msg`Opening`, sub: msg`moves 1–12` },
  { key: 'middlegame', label: msg`Middlegame`, sub: msg`moves 13+` },
  { key: 'endgame', label: msg`Endgame`, sub: msg`thin material` },
]

/** Largest share reads as the problem, second as the runner-up, the rest stay quiet. */
const RANK_COLORS = ['var(--bb-blunder)', 'var(--bb-mistake)', 'var(--bb-faint-2)']

/**
 * The phases as words inside a sentence. A second table rather than the label lowercased:
 * lowercasing a translated noun is an English habit ("eröffnung" is wrong in German).
 */
const PHASE_WORDS: Record<string, MessageDescriptor> = {
  opening: msg`opening`,
  middlegame: msg`middlegame`,
  endgame: msg`endgame`,
}

/** A descriptor rather than a sentence, so the card resolves it in the reader's language. */
function sentence(
  rows: { key: string; blunders: number; share: number }[],
  all: number,
  i18n: I18n,
): MessageDescriptor {
  if (all === 0)
    return msg`No blunders in this window. Either you were careful or nothing has been analysed.`
  const worst = rows[0]
  if (!worst || worst.blunders === 0)
    return msg`Every blunder in this window fell outside the three phases.`
  const share = worst.share.toFixed(0)
  const phase = PHASE_WORDS[worst.key] ? i18n._(PHASE_WORDS[worst.key]) : worst.key
  return msg`${share}% of them happen in the ${phase}, where the position stops explaining itself.`
}

export function BlundersByPhaseCard({
  query,
  className,
}: {
  query: StatsQuery
  className?: string
}) {
  const { i18n, t } = useLingui()
  const found = buckets(query.data)
  const overall = total(query.data)
  const all = numOr(overall, 'blunder')

  const rows = PHASES.map(({ key, label, sub }) => {
    const bucket = found.find((entry: StatsBucket) => entry.key === key)
    const blunders = numOr(bucket, 'blunder')
    return {
      key,
      label: i18n._(label),
      sub: i18n._(sub),
      blunders,
      moves: numOr(bucket, 'moves'),
      rate: asPercent(numOr(bucket, 'blunder_rate')) ?? 0,
      share: all > 0 ? (blunders / all) * 100 : 0,
    }
  })
  const ranked = [...rows].sort((a, b) => b.blunders - a.blunders)
  const colorOf = (key: string) =>
    RANK_COLORS[
      Math.min(
        ranked.findIndex((row) => row.key === key),
        RANK_COLORS.length - 1,
      )
    ]

  return (
    <StatCard
      compact
      className={className}
      title={t`Blunders by game phase`}
      aside={
        <span className="font-mono text-[0.625rem] tabular text-dim-2">
          <Plural value={all} one="# blunder" other="# blunders" />
        </span>
      }
      footer={query.data ? i18n._(sentence(ranked, all, i18n)) : undefined}
    >
      <Async
        query={query}
        loading={<LoadingRows compact rows={3} className="justify-start" />}
        empty={numOr(overall, 'moves') === 0}
        emptyMessage={
          <Trans>No analysed moves in this window. Run an analysis pass and the phases fill in.</Trans>
        }
      >
        <div className="flex flex-1 flex-col justify-start gap-2">
          {rows.map((row) => {
            // Named locals rather than expressions in the template: the identifier is what
            // a translator sees as the placeholder.
            const blunders = row.blunders
            const moves = row.moves.toLocaleString()
            const rate = row.rate.toFixed(1)
            return (
              <MeterRow
                compact
                key={row.key}
                label={row.label}
                sub={row.sub}
                value={row.blunders.toLocaleString()}
                share={row.share}
                color={colorOf(row.key)}
                emphasis={ranked[0]?.key === row.key && row.blunders > 0}
                title={t`${blunders} blunders in ${moves} moves — ${rate}% of them`}
              />
            )
          })}
        </div>
      </Async>
    </StatCard>
  )
}

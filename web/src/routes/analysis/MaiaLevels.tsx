import { plural } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

import type { CoverageMaia } from '@/lib/api/types'
import { formatCount } from '@/routes/games/format'

/**
 * Which Maia levels the library actually carries, against the ones configured now.
 *
 * Two readings that a single "has Maia" number cannot hold apart. A library analysed while
 * Maia was centred on each game's *own* rating has a human-move policy on every game and
 * none of it at the level the owner asks about today — plenty of Maia, and still a full
 * fill's worth of work.
 *
 * Those leftovers are the orphan levels, and on the library this was built for there are
 * 113 of them, almost all covering a single game. Listing them would be 113 rows of noise
 * over one sentence's worth of meaning, so the resting state is the sentence and the rows
 * are behind a press — collapsed, they are not rendered at all rather than hidden, because
 * a hundred rows nobody asked for is a hundred rows either way.
 */
export function MaiaLevels({ maia }: { maia: CoverageMaia }) {
  const { t } = useLingui()
  const [showing, setShowing] = useState(false)
  const orphans = maia.orphan_levels
  const pairs = orphans.reduce((sum, level) => sum + level.games, 0)
  // Named locals: an identifier is what a translator sees as the placeholder, and the two
  // counts are formatted before the sentence so the plural only has to choose the word.
  const missing = formatCount(maia.missing_games)
  const levelCount = formatCount(orphans.length)
  const pairCount = formatCount(pairs)

  return (
    <section
      aria-labelledby="maia-levels-title"
      className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-3.5"
    >
      <header className="flex items-baseline gap-2">
        <h2 id="maia-levels-title" className="text-xs font-semibold text-ink">
          <Trans>Maia levels</Trans>
        </h2>
        <div className="flex-1" />
        <span className="font-mono text-[0.6875rem] tabular text-dim-2">
          {maia.missing_games === 0 ? (
            <Trans>every analysed game has every level</Trans>
          ) : (
            <Trans>{missing} missing a level</Trans>
          )}
        </span>
      </header>

      <div className="flex flex-wrap gap-2">
        {maia.per_level.map((level) => (
          <div
            key={level.elo}
            className="flex min-w-24 flex-col gap-1 rounded-md border border-brilliant/28 bg-brilliant/8 px-2.5 py-2"
          >
            <span className="font-mono text-[0.6875rem] tabular text-brilliant">{level.elo}</span>
            <span className="font-mono text-[0.8125rem] leading-none tabular text-ink">
              {formatCount(level.games)}
            </span>
            <span className="text-[0.5625rem] text-dim-2">
              <Trans>games</Trans>
            </span>
          </div>
        ))}
        {maia.per_level.length === 0 ? (
          <span className="text-[0.6875rem] text-dim-2">
            <Trans>No levels configured.</Trans>
          </span>
        ) : null}
      </div>

      {orphans.length === 0 ? null : (
        <div className="flex flex-col gap-2 border-t border-hairline pt-2.5">
          <button
            type="button"
            aria-expanded={showing}
            onClick={() => setShowing(!showing)}
            className="flex items-center gap-1.5 self-start text-[0.6875rem] text-soft transition-colors hover:text-ink"
          >
            {showing ? (
              <ChevronDown className="size-3 text-faint" aria-hidden />
            ) : (
              <ChevronRight className="size-3 text-faint" aria-hidden />
            )}
            {t`${levelCount} ${plural(orphans.length, {
              one: 'level',
              other: 'levels',
            })} no longer configured, across ${pairCount} game-level ${plural(pairs, {
              one: 'pair',
              other: 'pairs',
            })}`}
          </button>
          <p className="text-[0.625rem] leading-[1.5] text-dim-2">
            <Trans>
              Maia used to be asked at each game&rsquo;s own rating rather than at a fixed set,
              so the library carries a level for nearly every rating it has ever seen. They
              cost nothing and answer nothing — a fill is what puts the configured levels on
              those games.
            </Trans>
          </p>
          {showing ? (
            <ul className="flex flex-wrap gap-1.5">
              {orphans.map((level) => (
                <li
                  key={level.elo}
                  className="bb-chip px-1.5 py-0.5 font-mono text-[0.625rem] tabular text-dim"
                >
                  {`${level.elo} · ${formatCount(level.games)}`}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  )
}

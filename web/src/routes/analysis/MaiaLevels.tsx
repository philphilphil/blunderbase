import { plural } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
 *
 * The configured levels are a flat list of facts (a level, its count), not tiles: bordered,
 * tinted boxes had the silhouette of something to press, and nothing here is. The Maia
 * purple stays on the level, as a dot and its figure, which is the data colour Maia wears
 * everywhere. Showing the orphans is a disclosure, so it is a secondary button saying so,
 * with the sentence it discloses beside it as plain text.
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
        <h2 id="maia-levels-title" className="text-data font-semibold text-ink">
          <Trans>Maia levels</Trans>
        </h2>
        <div className="flex-1" />
        <span className="font-mono text-label tabular text-dim-2">
          {maia.missing_games === 0 ? (
            <Trans>every analysed game has every level</Trans>
          ) : (
            <Trans>{missing} missing a level</Trans>
          )}
        </span>
      </header>

      {maia.per_level.length === 0 ? (
        <span className="text-label text-dim-2">
          <Trans>No levels configured.</Trans>
        </span>
      ) : (
        <dl className="flex flex-col">
          {maia.per_level.map((level) => (
            <div
              key={level.elo}
              className="flex items-baseline gap-2 border-b border-hairline py-1.5 last:border-b-0"
            >
              <dt className="flex items-center gap-1.5">
                <span aria-hidden className="size-1.5 flex-none rounded-full bg-brilliant" />
                <span className="font-mono text-data tabular text-brilliant">{level.elo}</span>
              </dt>
              <div className="flex-1" />
              <dd className="flex items-baseline gap-1">
                <span className="font-mono text-data tabular text-ink">
                  {formatCount(level.games)}
                </span>
                <span className="text-label text-dim-2">
                  <Trans>games</Trans>
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {orphans.length === 0 ? null : (
        <div className="flex flex-col gap-2 border-t border-hairline pt-2.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-expanded={showing}
            onClick={() => setShowing(!showing)}
            className="h-auto min-h-7 self-start py-1 text-left whitespace-normal"
          >
            {showing ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
            {t`${levelCount} ${plural(orphans.length, {
              one: 'level',
              other: 'levels',
            })} no longer configured, across ${pairCount} game-level ${plural(pairs, {
              one: 'pair',
              other: 'pairs',
            })}`}
          </Button>
          <p className="text-meta leading-[1.5] text-dim-2">
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
                <li key={level.elo}>
                  <Badge className="font-mono tabular">
                    {`${level.elo} · ${formatCount(level.games)}`}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  )
}

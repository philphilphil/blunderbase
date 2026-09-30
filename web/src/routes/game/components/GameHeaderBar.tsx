import { Trans, useLingui } from '@lingui/react/macro'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { SourceBadge } from '@/components/badges/SourceBadge'
import { RunStatusBadge, UnanalysedBadge } from '@/components/badges/RunBadge'
import { CollectionChips } from '@/components/collections/CollectionChip'
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group'
import { TextLink } from '@/components/ui/text-link'
import type { GameRunSummary, GameSummary, RunResponse } from '@/lib/api/types'
import { SOURCE_STYLES } from '@/lib/chess/classification'
import { relative } from '@/lib/mcp/status'
import { cn } from '@/lib/utils'

import { formatGameDate, formatResult, formatTimeControl } from '../gameModel'

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
 * The date is here, between the time control and the result. It used to sit in the bar's
 * trail, but a trail is a list of places you can go back to, and "5 Sept 2026" is not one:
 * it is a fact of the game like its time control (the clarity pass). The bar now carries
 * the list the game came from and the players as the page's title, so this line is the
 * content's heading, and the opening is its first word rather than a second page title
 * (`font-medium`, not an `h1`).
 *
 * The game's collections close the facts, as the same tinted chips the library's rows
 * carry, each a link to the library filtered to it. They are the owner's filing rather than a
 * fact of the game, so they come after everything the game says about itself, and they are
 * the first of those facts to leave a narrow bar; a long list clips at a fixed width rather
 * than pushing the opening's name out.
 *
 * When the game was opened from the library, two arrows lead the line: the run the table
 * was showing, steppable without going back to it (`gameTrail`). They are first because
 * they are about *which* game this is, which is what the rest of the line describes — and
 * they are simply absent on a game reached any other way, rather than present and dead.
 * They are a `ButtonGroup` (attached faces, "do one of these"), their names say which run
 * they walk ("Next game in League 2026"), and from `lg` that run's name stands beside
 * them, because two bare arrows did not say along what.
 *
 * Chips only for exceptions. The ECO, the source, the time control, the date and the
 * result are plain text in the type scale, told apart by weight and tone rather than each
 * boxed — a row of bordered chips was the noisiest line on the screen while saying the
 * least. The source is a link out (accent and `↗`, a `TextLink`) where the game has a page
 * on its site, since that is what pressing it does. What keeps a chip is what is
 * unusual about this game ("not your game") or about the app's work on it (a run queued,
 * running or failed; never analysed).
 */
export function GameHeaderBar({
  game,
  best,
  active,
  trail,
  className,
}: {
  game: GameSummary
  /** The finished run that answers for the game (`gameModel.bestRun`): when it finished. */
  best: GameRunSummary | null
  /** A run that is queued or running right now, from `/analysis/runs`. */
  active: RunResponse | null
  /** How to leave this game for the one either side of it in the run it was opened from. */
  trail?: {
    /** The run's name, as the trail names it ("Games", "Losses as black", "League 2026"). */
    name: string
    onPrevious: (() => void) | null
    onNext: (() => void) | null
  } | null
  className?: string
}) {
  const { t } = useLingui()
  const timeControl = formatTimeControl(game)
  const analysedAt = best?.finished_at ? relative(best.finished_at) : null
  const source = SOURCE_STYLES[game.source]

  return (
    <div
      data-testid="game-header"
      className={cn(
        // A container, so what leaves on a narrow game area is decided by the bar's own
        // width (see the `@max-` classes below) rather than by clipping whatever is last.
        '@container flex h-[2.625rem] flex-none items-center gap-2 overflow-hidden border-b border-edge-strong bg-surface px-4 whitespace-nowrap',
        className,
      )}
    >
      {trail ? (
        // No counter beside them. The run is the whole filtered library in the table's
        // order, not the page that happened to be up, so any number here would either be a
        // place in a page nobody is looking at or a running total of a library — and
        // neither is a thing the reader wanted to know. The two arrows say all there is:
        // there is a game that way, or there is not.
        <div className="flex flex-none items-center gap-2">
          <ButtonGroup label={t`Games in ${trail.name}`} size="xs">
            <StepButton
              label={t`Previous game in ${trail.name}`}
              hint="["
              spent={t`No game before this one in ${trail.name}`}
              onClick={trail.onPrevious}
              icon={ChevronLeft}
            />
            <StepButton
              label={t`Next game in ${trail.name}`}
              hint="]"
              spent={t`No game after this one in ${trail.name}`}
              onClick={trail.onNext}
              icon={ChevronRight}
            />
          </ButtonGroup>
          <span className="hidden max-w-[12rem] truncate text-label text-dim lg:inline">
            {trail.name}
          </span>
        </div>
      ) : null}

      {/* The only element on the line allowed to shrink: everything after it is a chip or a
          handful of mono characters, and a truncated ECO or result says nothing at all. It
          keeps a floor, so a narrow bar drops the lesser facts below rather than squeezing
          the opening's name down to an ellipsis. */}
      <span
        data-testid="game-opening"
        className="min-w-[6rem] truncate text-heading font-medium text-ink-2"
      >
        {game.opening ?? t`Unnamed opening`}
      </span>
      {game.eco ? (
        <span className="flex-none font-mono text-label tabular text-dim">{game.eco}</span>
      ) : null}
      {/* The source is the way to the game on its own site, where it has one: the same fact,
          made clickable, rather than a sixth thing on the line, and drawn as what it is, a
          link out (accent, `↗`). Without a page to open it is the plain dot and name. */}
      {game.url ? (
        <TextLink
          href={game.url}
          external
          title={t`Open this game on the site it came from`}
          className="flex-none gap-1.5 text-label"
        >
          <span aria-hidden className={cn('size-1.5 flex-none rounded-full', source.dotClass)} />
          {source.label}
        </TextLink>
      ) : (
        <SourceBadge source={game.source} variant="plain" className="flex-none" />
      )}
      {timeControl ? (
        <span className="flex-none font-mono text-label text-soft @max-[40rem]:hidden">
          {timeControl}
        </span>
      ) : null}
      <span className="flex-none text-faint @max-[40rem]:hidden">·</span>
      <span
        data-testid="game-date"
        className="flex-none font-mono text-label tabular text-soft @max-[34rem]:hidden"
      >
        {formatGameDate(game.played_at)}
      </span>
      <span className="flex-none text-faint">·</span>
      <span className="flex-none font-mono text-label tabular text-body">
        {formatResult(game.result)}
      </span>
      {game.rated === false ? (
        <span className="flex-none text-label text-dim-2 @max-[40rem]:hidden">
          <Trans>casual</Trans>
        </span>
      ) : null}
      {game.is_owner_game === false ? (
        <span
          title={t`Added from the reference explorer. Analysed and annotated like any other game, and counted in no statistic.`}
          className="flex-none rounded-sm border border-dashed border-edge-strong px-[0.3125rem] py-px text-meta text-dim"
        >
          <Trans>not your game</Trans>
        </span>
      ) : null}
      <CollectionChips
        ids={game.collections}
        className="max-w-[18rem] flex-none @max-[44rem]:hidden"
      />

      {/* The spacer is what makes the analysis state right-aligned rather than a sixth fact
          about the game: it is about the app's work, not about the game. */}
      <div className="flex-1" />

      {/* No chip for a finished run: what it searched is the engine pane's Run tab's to
          say, and "analysed …" beside this already says one happened. */}
      {active ? (
        <RunStatusBadge status={active.status} className="flex-none" />
      ) : best ? null : (
        <UnanalysedBadge className="flex-none" />
      )}
      {/* First to leave on a narrow bar: the badge beside it already says whether a run
          exists, and "when" is the least of what this line tells. */}
      <span className="flex-none font-mono text-meta text-dim-2 @max-[48rem]:hidden">
        {analysedAt ? t`analysed ${analysedAt}` : t`never analysed`}
      </span>
    </div>
  )
}

/**
 * One end of the run: a cell of the pair, the same attached faces as the board's transport.
 * A spent end drops its face (the one disabled look) and keeps a title saying why, so the
 * pair keeps its outline and the reader learns the run has ended there. The correspondence
 * game's header walks its list with the same pair.
 */
export function StepButton({
  label,
  hint,
  spent,
  onClick,
  icon: Icon,
}: {
  label: string
  hint: string
  /** The title while there is no game that way. */
  spent: string
  onClick: (() => void) | null
  icon: typeof ChevronLeft
}) {
  return (
    <ButtonGroupItem
      aria-label={label}
      aria-keyshortcuts={hint}
      title={onClick ? `${label} (${hint})` : spent}
      disabled={!onClick}
      onClick={() => onClick?.()}
      className="min-w-6 px-1"
    >
      <Icon aria-hidden className="size-3.5" />
    </ButtonGroupItem>
  )
}

import type { I18n } from '@lingui/core'
import { msg, plural } from '@lingui/core/macro'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { Loader2, ListX, Microscope, Wand2, Zap } from 'lucide-react'
import { type ComponentType, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { useClearQueue, useMaiaFill, useQueueStatus, useStartBackfill } from '@/lib/api/queries'
import type { AnalysisCoverage, Tier } from '@/lib/api/types'
import { formatCount } from '@/routes/games/format'

import { estimateLabel } from './estimate'

/**
 * The four passes an owner can start over the whole library, each carrying what it would
 * cost before it is pressed.
 *
 * This is the reason the page exists. The only whole-library button the app had was an
 * "Analyse all" on the library screen, which said how many games and nothing about how
 * long — so a pass that turned out to be forty hours was one click away from an owner who
 * thought it was twenty minutes. That button is gone; this is where it went. Every card here shows the same two numbers: how many
 * games the press would queue, and what this deployment's own finished runs say that
 * costs. The estimate sits *on* the button rather than in a footnote because the moment it
 * is worth reading is the moment before the click.
 *
 * Starting a backfill queues ordinary runs and nothing more: the press POSTs and the pass
 * sits in the same queue an import's passes sit in, watched from the titlebar's queue
 * widget and stopped from the card next door. The burst of `analysis.done` frames that
 * produces is absorbed where every other burst is — the invalidation coalescing and the
 * per-root cooldowns in `lib/events/EventsProvider.tsx` (`FLUSH_MS`, `COOLDOWN_MS`) — so
 * the app has no reason to hide itself while a pass drains.
 */

function remainingEstimate(
  seconds: number | null,
  concurrency: number,
  pending: number,
  i18n: I18n,
) {
  if (seconds === 0) return null
  const label = estimateLabel(seconds, concurrency)
  return label && pending === 0 ? i18n._(msg`${label} remaining`) : label
}

function ActionCard({
  icon: Icon,
  title,
  blurb,
  figure,
  estimate,
  children,
  footer,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  blurb: ReactNode
  /** What the press would take on, already worded — "6,879 games", "nothing to queue". */
  figure: string
  /** The wall-clock cost, or null where nothing has been measured yet. */
  estimate: string | null
  /** The button. */
  children: ReactNode
  /** A receipt or a refusal, under the button. */
  footer?: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2.5 rounded-xl border border-line bg-panel p-3.5">
      <header className="flex items-center gap-2">
        <Icon className="size-3.5 flex-none text-faint" aria-hidden />
        <h3 className="text-xs font-semibold text-ink">{title}</h3>
      </header>

      <p className="flex-1 text-[0.6875rem] leading-[1.5] text-dim">{blurb}</p>

      <div className="flex items-baseline gap-2 border-t border-hairline pt-2.5">
        <span className="font-mono text-[0.75rem] tabular text-soft">{figure}</span>
        <div className="flex-1" />
        <span className="font-mono text-[0.6875rem] tabular text-dim-2">{estimate ?? ''}</span>
      </div>

      <div className="flex flex-col gap-2">{children}</div>
      {footer}
    </section>
  )
}

/** One of the two backfills: the count, the estimate, and the press that fills the queue. */
function BackfillCard({
  tier,
  pending,
  seconds,
  concurrency,
}: {
  tier: Tier
  pending: number
  seconds: number | null
  concurrency: number
}) {
  const { i18n, t } = useLingui()
  // One mutation per card, so the quick card's receipt is never the deep card's.
  const start = useStartBackfill()
  const receipt = start.data ?? null
  const deep = tier === 'deep'
  // Named locals: the identifier is what a translator sees as the placeholder.
  const waiting = formatCount(pending)
  const queued = formatCount(receipt?.queued ?? 0)
  const outstanding = formatCount(receipt?.outstanding ?? 0)

  return (
    <ActionCard
      icon={deep ? Microscope : Zap}
      title={deep ? t`Backfill deep` : t`Backfill quick`}
      blurb={
        deep
          ? t`A full deep pass over every game that has never had one — the budget a single game gets when somebody is waiting on it, spent over the library. Many times the cost of a quick pass.`
          : t`The pass every imported game gets automatically, over the games that arrived before it existed or were imported with analysis off.`
      }
      figure={
        pending === 0
          ? t`nothing to queue`
          : t`${waiting} ${plural(pending, { one: 'game', other: 'games' })}`
      }
      estimate={remainingEstimate(seconds, concurrency, pending, i18n)}
      footer={
        <>
          {receipt ? (
            <p role="status" className="text-[0.6875rem] leading-[1.5] text-dim">
              {receipt.queued === 0
                ? t`Nothing to queue — every game already has a pass of this tier.`
                : t`Queued ${queued} ${plural(receipt.queued, {
                    one: 'game',
                    other: 'games',
                  })}; ${outstanding} ${plural(receipt.outstanding, {
                    one: 'run',
                    other: 'runs',
                  })} outstanding at this tier.`}
            </p>
          ) : null}
          {start.isError ? (
            <p role="alert" className="text-[0.6875rem] leading-[1.5] text-blunder">
              {start.error.message}
            </p>
          ) : null}
        </>
      }
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={start.isPending || pending === 0}
        onClick={() => start.mutate(tier)}
      >
        {start.isPending ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : deep ? (
          <Microscope aria-hidden />
        ) : (
          <Zap aria-hidden />
        )}
        {deep ? <Trans>Backfill deep</Trans> : <Trans>Backfill quick</Trans>}
      </Button>
    </ActionCard>
  )
}

/**
 * The Maia fill belongs here rather than on the Maia configuration page: queueing thousands of runs over the
 * library is not a setting, whatever changing the levels is.
 */
function MaiaFillCard({
  missing,
  seconds,
  concurrency,
}: {
  missing: number
  seconds: number | null
  concurrency: number
}) {
  const { i18n, t } = useLingui()
  const fill = useMaiaFill()
  const receipt = fill.data ?? null
  // Named locals: the identifier is what a translator sees as the placeholder.
  const waiting = formatCount(missing)
  const queued = formatCount(receipt?.queued ?? 0)
  const complete = formatCount(receipt?.already_complete ?? 0)

  return (
    <ActionCard
      icon={Wand2}
      title={t`Fill missing Maia levels`}
      blurb={t`Adds the configured levels to games that already have a pass. Maia-only — nothing is searched again — so it costs minutes where a re-analysis would cost the weekend.`}
      figure={
        missing === 0
          ? t`nothing to queue`
          : t`${waiting} ${plural(missing, { one: 'game', other: 'games' })}`
      }
      estimate={remainingEstimate(seconds, concurrency, missing, i18n)}
      footer={
        <>
          {receipt ? (
            <p role="status" className="text-[0.6875rem] leading-[1.5] text-dim">
              {receipt.queued === 0
                ? t`Nothing to queue — every analysed game already has every level.`
                : t`Queued ${queued} ${plural(receipt.queued, {
                    one: 'game',
                    other: 'games',
                  })}; ${complete} ${plural(receipt.already_complete, {
                    one: 'game',
                    other: 'games',
                  })} already complete.`}
            </p>
          ) : null}
          {fill.isError ? (
            <p role="alert" className="text-[0.6875rem] leading-[1.5] text-blunder">
              {fill.error.message}
            </p>
          ) : null}
        </>
      }
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={fill.isPending || missing === 0}
        onClick={() => fill.mutate(undefined)}
      >
        {fill.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Wand2 aria-hidden />}
        <Trans>Fill missing levels</Trans>
      </Button>
    </ActionCard>
  )
}

/**
 * The undo for a queue built up by mistake.
 *
 * The titlebar has this control too, and only while something is queued — which is exactly
 * when it is hardest to find, because the widget it hangs off is busy. Here it is where
 * the buttons that fill the queue are, and it says what it dropped afterwards.
 */
function ClearQueueCard() {
  const { t } = useLingui()
  const queue = useQueueStatus()
  const clear = useClearQueue()
  const queued = queue.data?.queued ?? 0
  const running = queue.data?.running ?? 0
  const receipt = clear.data ?? null
  // Named locals: the identifier is what a translator sees as the placeholder.
  const waiting = formatCount(queued)
  const onEngine = formatCount(running)
  const dropped = formatCount(receipt?.dropped ?? 0)
  const outstanding = formatCount(receipt?.outstanding ?? 0)

  return (
    <ActionCard
      icon={ListX}
      title={t`Clear the queue`}
      blurb={t`Drops everything still queued, whatever tier or shape it is queued in. Runs already on an engine are left to finish, and no game loses the analysis it already has.`}
      figure={
        queued === 0
          ? t`nothing queued`
          : t`${waiting} ${plural(queued, { one: 'run', other: 'runs' })} queued`
      }
      estimate={running > 0 ? t`${onEngine} running` : null}
      footer={
        <>
          {receipt ? (
            <p role="status" className="text-[0.6875rem] leading-[1.5] text-dim">
              {t`Dropped ${dropped} ${plural(receipt.dropped, {
                one: 'run',
                other: 'runs',
              })}; ${outstanding} ${plural(receipt.outstanding, {
                one: 'run',
                other: 'runs',
              })} still outstanding.`}
            </p>
          ) : null}
          {clear.isError ? (
            <p role="alert" className="text-[0.6875rem] leading-[1.5] text-blunder">
              {clear.error.message}
            </p>
          ) : null}
        </>
      }
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={clear.isPending || queued === 0}
        onClick={() => clear.mutate()}
      >
        {clear.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <ListX aria-hidden />}
        <Trans>Clear the queue</Trans>
      </Button>
    </ActionCard>
  )
}

export function LibraryActions({ coverage }: { coverage: AnalysisCoverage }) {
  const { concurrency } = coverage.estimates

  return (
    <div className="flex flex-col gap-2">
      <div className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <BackfillCard
          tier="quick"
          pending={coverage.missing.quick}
          seconds={coverage.estimates.quick_seconds}
          concurrency={concurrency}
        />
        <BackfillCard
          tier="deep"
          pending={coverage.missing.deep}
          seconds={coverage.estimates.deep_seconds}
          concurrency={concurrency}
        />
        <MaiaFillCard
          missing={coverage.maia.missing_games}
          seconds={coverage.estimates.maia_seconds}
          concurrency={concurrency}
        />
        <ClearQueueCard />
      </div>
      <p className="text-[0.625rem] leading-[1.5] text-dim-2">
        <Trans>
          Times are approximate: measured off this deployment&rsquo;s own finished runs at the
          budget configured now, including matching work already queued or running, over{' '}
          <Plural value={concurrency} one="one run at a time" other="# runs at a time" />. A blank
          means too few runs have finished at that budget to be worth averaging.
        </Trans>
      </p>
    </div>
  )
}

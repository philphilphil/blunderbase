import { Loader2, ListX, Microscope, Wand2, Zap } from 'lucide-react'
import { useState, type ComponentType, type ReactNode } from 'react'

import { ConfirmBackfill } from '@/components/analysis/ConfirmBackfill'
import { Button } from '@/components/ui/button'
import { useClearQueue, useMaiaFill, useQueueStatus } from '@/lib/api/queries'
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
 * Starting a backfill goes through `ConfirmBackfill` and `startBackfillRun` exactly as the
 * library screen's button does — the takeover that unmounts the shell is what keeps ten
 * thousand `analysis.done` frames from refetching every mounted page, which is a real
 * production incident and not a stylistic choice.
 */

/** A count with the noun it counts, so no sentence has to say "1 games". */
function plural(count: number, one: string, many = `${one}s`): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`
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
  /** What the press would take on, already worded — "6,879 games", "nothing left". */
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

/** One of the two backfills: the count, the estimate, and the confirm before the takeover. */
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
  const [asking, setAsking] = useState(false)
  const deep = tier === 'deep'

  return (
    <ActionCard
      icon={deep ? Microscope : Zap}
      title={deep ? 'Backfill deep' : 'Backfill quick'}
      blurb={
        deep
          ? 'A full deep pass over every game that has never had one — the budget a single game gets when somebody is waiting on it, spent over the library. Many times the cost of a quick pass.'
          : 'The pass every imported game gets automatically, over the games that arrived before it existed or were imported with analysis off.'
      }
      figure={pending === 0 ? 'nothing left' : plural(pending, 'game')}
      estimate={estimateLabel(seconds, concurrency)}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending === 0}
        onClick={() => setAsking(true)}
      >
        {deep ? <Microscope aria-hidden /> : <Zap aria-hidden />}
        {deep ? 'Backfill deep…' : 'Backfill quick…'}
      </Button>

      {asking && pending > 0 ? (
        <ConfirmBackfill tier={tier} pending={pending} onClose={() => setAsking(false)} />
      ) : null}
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
  const fill = useMaiaFill()
  const receipt = fill.data ?? null

  return (
    <ActionCard
      icon={Wand2}
      title="Fill missing Maia levels"
      blurb="Adds the configured levels to games that already have a pass. Maia-only — nothing is searched again — so it costs minutes where a re-analysis would cost the weekend."
      figure={missing === 0 ? 'every game has every level' : plural(missing, 'game')}
      estimate={estimateLabel(seconds, concurrency)}
      footer={
        <>
          {receipt ? (
            <p role="status" className="text-[0.6875rem] leading-[1.5] text-dim">
              {receipt.queued === 0
                ? 'Nothing to queue — every analysed game already has every level.'
                : `Queued ${plural(receipt.queued, 'game')}; ${plural(receipt.already_complete, 'game')} already complete.`}
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
        Fill missing levels
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
  const queue = useQueueStatus()
  const clear = useClearQueue()
  const queued = queue.data?.queued ?? 0
  const running = queue.data?.running ?? 0
  const receipt = clear.data ?? null

  return (
    <ActionCard
      icon={ListX}
      title="Clear the queue"
      blurb="Drops everything still queued, whatever tier or shape it is queued in. Runs already on an engine are left to finish, and no game loses the analysis it already has."
      figure={queued === 0 ? 'nothing queued' : `${plural(queued, 'run')} queued`}
      estimate={running > 0 ? `${formatCount(running)} running` : null}
      footer={
        <>
          {receipt ? (
            <p role="status" className="text-[0.6875rem] leading-[1.5] text-dim">
              {`Dropped ${plural(receipt.dropped, 'run')}; ${plural(receipt.outstanding, 'run')} still outstanding.`}
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
        Clear the queue
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
        Times are approximate: measured off this deployment&rsquo;s own finished runs at the
        budget configured now, over{' '}
        {concurrency === 1 ? 'one run at a time' : `${concurrency} runs at a time`}. A blank
        means too few runs have finished at that budget to be worth averaging.
      </p>
    </div>
  )
}

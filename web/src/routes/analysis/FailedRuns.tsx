import { Loader2, RotateCcw } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api/client'
import { useFailedRuns, useRetryFailed } from '@/lib/api/queries'
import type { RunResponse, Tier } from '@/lib/api/types'
import { TIER_STYLES } from '@/lib/chess/classification'
import { cn } from '@/lib/utils'
import { formatCount } from '@/routes/games/format'
// The same absolute stamp the sync history uses, and for the same reason: a list of
// failures is read as a log, where "3 days ago" is worse than the day it happened.
import { stamp } from '@/routes/import/format'

/**
 * The failures, and the one press that picks them back up.
 *
 * A failed run had nowhere to be seen: the socket announces it once, the queue widget
 * shows it while it is recent, and after that a game with a failed pass looks exactly like
 * a game with no pass. This is the listing, newest first.
 *
 * Grouped by the message rather than listed run by run, because a few hundred failures are
 * almost never a few hundred problems — on the library this was built for, 372 of 382 share
 * one error string, which is one deployment mistake (a tier with no engine on the day the
 * import ran) repeated once per game. One row per message says that; 382 rows hide it.
 *
 * Retrying queues a *new* run per game under the tier that failed; the failed row stays,
 * because it is the record of what went wrong. The refusal worth naming is a 409: the tier
 * behind these failures still has no engine, so a retry would only fail again — and the
 * fix is a page away rather than in this listing.
 */

/** How many of a group's games are named before the rest become a count. */
const NAMED_GAMES = 4

interface Group {
  message: string
  runs: RunResponse[]
  tiers: Tier[]
}

/** One row per distinct error message, in the order the messages were first seen. */
function groupByError(runs: RunResponse[]): Group[] {
  const groups = new Map<string, Group>()
  for (const run of runs) {
    const message = run.error?.trim() || 'no message was recorded'
    const group = groups.get(message) ?? { message, runs: [], tiers: [] }
    group.runs.push(run)
    if (!group.tiers.includes(run.tier)) group.tiers.push(run.tier)
    groups.set(message, group)
  }
  return [...groups.values()]
}

/** The message for a refusal, with the 409 spelled out rather than passed through. */
function RetryError({ error }: { error: Error }) {
  const unavailable = error instanceof ApiError && error.status === 409

  return (
    <p role="alert" className="text-[0.6875rem] leading-[1.5] text-blunder">
      {unavailable ? (
        <>
          Nothing was queued: the tier these runs failed under still has no engine that can
          take them, so a retry would fail the same way.{' '}
          <Link to="/settings/engines" className="text-accent-teal hover:text-accent-link">
            Register or enable an engine
          </Link>{' '}
          for it first.
        </>
      ) : (
        error.message
      )}
    </p>
  )
}

export function FailedRuns({ failed }: { failed: number }) {
  // Coverage has already counted them, so a library with no failures asks for no listing.
  const runs = useFailedRuns(undefined, { enabled: failed > 0 })
  const retry = useRetryFailed()
  const groups = groupByError(runs.data ?? [])
  const receipt = retry.data ?? null
  const listed = runs.data?.length ?? 0

  return (
    <section
      aria-labelledby="failed-runs-title"
      className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-3.5"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h2 id="failed-runs-title" className="text-xs font-semibold text-ink">
          Failed runs
        </h2>
        <span className="font-mono text-[0.6875rem] tabular text-blunder">
          {formatCount(failed)}
        </span>
        <div className="flex-1" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={retry.isPending || failed === 0}
          onClick={() => retry.mutate(undefined)}
        >
          {retry.isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <RotateCcw aria-hidden />
          )}
          Retry them all
        </Button>
      </header>

      {receipt ? (
        <p role="status" className="text-[0.6875rem] leading-[1.5] text-dim">
          {receipt.queued === 0
            ? `Nothing queued — all ${formatCount(receipt.skipped)} of them are over games that have since been analysed, or over a position rather than a game.`
            : `Queued ${formatCount(receipt.queued)} ${receipt.queued === 1 ? 'game' : 'games'}; skipped ${formatCount(receipt.skipped)}.`}
        </p>
      ) : null}
      {retry.isError ? <RetryError error={retry.error} /> : null}

      {failed === 0 ? (
        <p className="text-[0.6875rem] leading-[1.5] text-dim-2">
          Nothing has failed. A run that does will be listed here until it is retried.
        </p>
      ) : runs.isPending ? (
        <p className="text-[0.6875rem] text-dim-2">Reading the failures…</p>
      ) : (
        <>
          <ul className="flex flex-col gap-px">
            {groups.map((group) => (
              <li
                key={group.message}
                className="flex flex-col gap-1 rounded-[0.3125rem] bg-blunder/5 px-2 py-2"
              >
                <div className="flex items-start gap-2">
                  <span className="font-mono text-[0.65625rem] tabular text-blunder">
                    {`${formatCount(group.runs.length)}×`}
                  </span>
                  {group.tiers.map((tier) => (
                    <span
                      key={tier}
                      className={cn(
                        'rounded-sm border px-1.5 py-px text-[0.59375rem]',
                        TIER_STYLES[tier].chipClass,
                      )}
                    >
                      {tier}
                    </span>
                  ))}
                  <span className="flex-1 text-[0.6875rem] leading-[1.45] text-body-3">
                    {group.message}
                  </span>
                  <span className="flex-none font-mono text-[0.625rem] tabular text-dim-2">
                    {stamp(group.runs[0]?.finished_at ?? group.runs[0]?.created_at)}
                  </span>
                </div>
                <GameList runs={group.runs} />
              </li>
            ))}
          </ul>

          {failed > listed ? (
            <p className="text-[0.625rem] text-dim-2">
              {`Showing the newest ${formatCount(listed)} of ${formatCount(failed)}. Retrying takes on every one of them, not only the ones listed.`}
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}

/** The first few games behind a group, as links, and how many more there are. */
function GameList({ runs }: { runs: RunResponse[] }) {
  // Distinct games, not runs: a game whose pass failed twice is one game to re-analyse and
  // one link to offer, and listing it twice would both mislead and collide as a React key.
  const games = [
    ...new Set(
      runs.map((run) => run.game_id).filter((id): id is number => typeof id === 'number'),
    ),
  ]
  if (games.length === 0) {
    return (
      <span className="text-[0.625rem] text-dim-2">
        Over a position rather than a game — nothing to re-analyse.
      </span>
    )
  }
  const named = games.slice(0, NAMED_GAMES)
  const rest = games.length - named.length
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[0.625rem] text-dim-2">
      {named.map((id) => (
        <Link
          key={id}
          to={`/games/${id}`}
          className="font-mono tabular text-dim hover:text-accent-link"
        >
          {`#${id}`}
        </Link>
      ))}
      {rest > 0 ? <span>{`and ${formatCount(rest)} more`}</span> : null}
    </span>
  )
}

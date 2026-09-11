/**
 * Every engine on every game, on one screen — IDeA's status window, which is the thing a
 * multi-game correspondence player looks at first.
 *
 * A card per search rather than a row per game: a game can carry two engines and a machine
 * can carry four searches, and the question this section answers is "what is my hardware
 * doing", not "what are my games doing" — the tables above already answer that one.
 *
 * The parked ones are here too, greyed and marked, because a parked process is still
 * spending memory. Leaving them out would make the section disagree with the capacity strip
 * three lines above it. So are the **tasks**, marked as tasks: they are the other half of
 * what the hardware is doing, and a dozen of them out on a runner is exactly the thing this
 * section exists to show. A task carries its budget rather than a depth — nothing streams
 * pictures out of the analysis queue — and the host it names is where its engine lives.
 *
 * Each card carries the game, the move, the engine's own number and both of its counters —
 * depth and nodes — because for Leela the second is the one that means anything.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { Link } from 'react-router-dom'

import type { CorrespondenceGameSummary, CorrespondenceSearch } from '@/lib/api/types'
import { formatNodes, formatScore } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

import { opponentOf } from '../format'
import { formatSpan, isLive, isTask, isWarm, runningSeconds } from '../searches'

/** The game a search belongs to, by id, so a card can name it and link to it. */
export function gamesById(
  games: readonly CorrespondenceGameSummary[],
): Map<number, CorrespondenceGameSummary> {
  return new Map(games.map((game) => [game.game_id, game]))
}

function Card({
  search,
  game,
  host,
  now,
}: {
  search: CorrespondenceSearch
  game: CorrespondenceGameSummary | undefined
  /** Where this one is being worked: a runner's name, or null for this machine. */
  host: string | null
  now: number
}) {
  const { t } = useLingui()
  const live = isLive(search)
  const warm = isWarm(search)
  const task = isTask(search)
  const snapshot = live ? (search.snapshot ?? null) : null
  const elapsed = runningSeconds(search, now)
  const detail = [
    game ? opponentOf(game) : null,
    // A task sends no snapshots — it is a run in the analysis queue and nobody is watching
    // it half a second at a time — so what it can say about its size is its budget, which
    // is what it was queued with.
    task && search.limit_nodes ? t`up to ${formatNodes(search.limit_nodes)} nodes` : null,
    snapshot?.depth ? t`depth ${snapshot.depth}` : null,
    snapshot?.nodes ? t`${formatNodes(snapshot.nodes)} nodes` : null,
    live && elapsed !== null ? formatSpan(elapsed) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const body = (
    <div
      data-testid={`running-search-${search.id}`}
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-0.5 rounded-md border border-line bg-surface px-2.5 py-2',
        !live && 'opacity-70',
      )}
    >
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="truncate text-[0.75rem] font-semibold text-ink">
          {search.engine_name ?? t`Engine`}
        </span>
        {task ? (
          <span
            className="flex-none rounded-sm border border-edge px-1 text-[0.5625rem] text-dim uppercase"
            title={t`A bounded look through the analysis queue`}
          >
            <Trans>task</Trans>
          </span>
        ) : null}
      </span>
      {/*
        The search's own top line, from the SIDE TO MOVE's point of view — this card has no
        node beside it to turn the number into a mover's frame the way the tree does, and
        inventing one would be worse than saying whose it is.
      */}
      <span
        title={t`from the side to move's point of view`}
        className="self-center font-mono text-[0.8125rem] font-semibold text-body"
      >
        {formatScore(snapshot?.lines?.[0] ?? null)}
      </span>
      <span className="col-span-2 truncate text-[0.625rem] text-dim">{detail || '—'}</span>
      <span className="col-span-2 flex items-center gap-1.5 text-[0.625rem] text-dim-2">
        <span
          aria-hidden
          className={cn(
            'size-[0.3125rem] rounded-full',
            live ? 'bg-good' : warm ? 'bg-mistake' : 'bg-faint',
          )}
        />
        {task && live ? (
          <Trans>being worked on</Trans>
        ) : task ? (
          <Trans>waiting in the analysis queue</Trans>
        ) : live ? (
          <Trans>searching</Trans>
        ) : warm ? (
          <Trans>parked, warm</Trans>
        ) : search.status === 'paused' ? (
          <Trans>paused, cold</Trans>
        ) : (
          <Trans>waiting for a slot</Trans>
        )}
        {/* Where the work is. A search says so on its own row; a task says where its
            engine lives, which is the same answer — a task runs on its engine's host, and
            that is the whole reason a runner's engine may be the task engine. */}
        <span className="ml-auto">{host ?? <Trans>this machine</Trans>}</span>
      </span>
    </div>
  )

  return game ? (
    <Link to={`/correspondence/${game.game_id}`} className="block no-underline hover:opacity-95">
      {body}
    </Link>
  ) : (
    body
  )
}

export function RunningNow({
  searches,
  games,
  hosts,
  now,
}: {
  searches: readonly CorrespondenceSearch[]
  games: readonly CorrespondenceGameSummary[]
  /** Engine id → the runner it lives on, absent or null for this machine. */
  hosts?: ReadonlyMap<number, string | null>
  /** Now, in milliseconds — the page owns the clock so one tick redraws the whole section. */
  now: number
}) {
  const byId = gamesById(games)
  if (searches.length === 0) {
    return (
      <p className="py-4 text-[0.75rem] text-dim">
        <Trans>No engine is on a correspondence position right now.</Trans>
      </p>
    )
  }
  return (
    <div
      data-testid="correspondence-running"
      className="grid gap-2.5 pt-3 [grid-template-columns:repeat(auto-fill,minmax(17rem,1fr))]"
    >
      {searches.map((search) => (
        <Card
          key={search.id}
          search={search}
          game={search.game_id === null ? undefined : byId.get(search.game_id ?? -1)}
          host={(search.engine_id === null ? null : hosts?.get(search.engine_id ?? -1)) ?? null}
          now={now}
        />
      ))}
    </div>
  )
}

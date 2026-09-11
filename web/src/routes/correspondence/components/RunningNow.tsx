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
 * three lines above it.
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
import { formatSpan, isLive, isWarm, runningSeconds } from '../searches'

/** The game a search belongs to, by id, so a card can name it and link to it. */
export function gamesById(
  games: readonly CorrespondenceGameSummary[],
): Map<number, CorrespondenceGameSummary> {
  return new Map(games.map((game) => [game.game_id, game]))
}

function Card({
  search,
  game,
  now,
}: {
  search: CorrespondenceSearch
  game: CorrespondenceGameSummary | undefined
  now: number
}) {
  const { t } = useLingui()
  const live = isLive(search)
  const warm = isWarm(search)
  const snapshot = live ? (search.snapshot ?? null) : null
  const elapsed = runningSeconds(search, now)
  const detail = [
    game ? opponentOf(game) : null,
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
      <span className="truncate text-[0.75rem] font-semibold text-ink">
        {search.engine_name ?? t`Engine`}
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
        {live ? (
          <Trans>searching</Trans>
        ) : warm ? (
          <Trans>parked, warm</Trans>
        ) : search.status === 'paused' ? (
          <Trans>paused, cold</Trans>
        ) : (
          <Trans>waiting for a slot</Trans>
        )}
        {search.runner_id === null || search.runner_id === undefined ? (
          <span className="ml-auto">
            <Trans>this machine</Trans>
          </span>
        ) : null}
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
  now,
}: {
  searches: readonly CorrespondenceSearch[]
  games: readonly CorrespondenceGameSummary[]
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
          now={now}
        />
      ))}
    </div>
  )
}

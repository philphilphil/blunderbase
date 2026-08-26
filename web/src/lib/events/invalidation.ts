import type { QueryKey } from '@tanstack/react-query'

import { queryKeys } from '@/lib/api/keys'

import type { AnyEvent } from './types'

/**
 * Which cached queries one socket event makes stale.
 *
 * Returned keys are *prefixes*: `['games']` is invalidated with the default
 * `exact: false`, so it takes every games list and every game detail with it. Kept
 * deliberately narrow where an event fires often — `analysis.progress` arrives once per
 * analysed ply and must not drag the games table along with it.
 *
 * `live.updated` returns nothing on purpose: the frame carries the whole `LiveState`, so
 * the events provider writes it into the cache instead of refetching `/live`.
 */
export function invalidationsFor(event: AnyEvent): QueryKey[] {
  switch (event.event) {
    // A sync writes games, so the tables, the counts and the aggregates all move; every
    // imported game is also enqueued for a quick pass, which the queue widget shows.
    case 'import.started':
    case 'import.game':
    case 'import.finished':
      return [queryKeys.imports(), queryKeys.games(), queryKeys.stats(), queryKeys.queue()]

    // Lifecycle: the queue always, the game's own analysis rows too. `queued` already
    // changes a game's badge from "unanalysed" to "queued".
    case 'analysis.queued':
    case 'analysis.running':
      return [queryKeys.analysis(), queryKeys.games()]

    // Nothing about a run row changes while it works, only how far along it is.
    case 'analysis.progress':
      return [queryKeys.queue()]

    // New evals: classifications, eval curves, worst moments, explorer eval drops.
    case 'analysis.done':
    case 'analysis.failed':
      return [
        queryKeys.analysis(),
        queryKeys.games(),
        queryKeys.stats(),
        queryKeys.explorer(),
      ]

    // A note the coach wrote over MCP. Notes ride along in the game detail payload, so
    // that one game is refetched, but the games *table* is untouched.
    case 'note.created':
    case 'note.updated': {
      const keys: QueryKey[] = [queryKeys.notes()]
      const gameId = (event as { game_id?: number | null }).game_id
      if (typeof gameId === 'number') keys.push(['games', 'detail', gameId])
      return keys
    }

    // A link coming or going changes where work can run: the runner rows, the backlog's
    // split between destinations, and the engines themselves — a disconnect flips
    // `enabled` on that runner's rows and with it which tiers are available (`['engines']`
    // is a prefix of `['engines', 'tiers']`).
    case 'runner.connected':
    case 'runner.disconnected':
      return [queryKeys.runners(), queryKeys.queue(), queryKeys.engines()]

    // Fires per slot taken and freed, so it must not drag the engine list along.
    case 'runner.updated':
      return [queryKeys.runners(), queryKeys.queue()]

    // Carried whole on the socket, and a keepalive is not news. `stream.snapshot` arrives
    // twice a second per open board — refetching on it would be a refetch loop.
    case 'stream.started':
    case 'stream.snapshot':
    case 'stream.ended':
    case 'live.updated':
    case 'ping':
      return []

    default:
      return []
  }
}

/** Drop keys that another key in the list already covers, so one refetch does the work. */
export function dedupeKeys(keys: QueryKey[]): QueryKey[] {
  const unique = new Map<string, QueryKey>()
  for (const key of keys) unique.set(JSON.stringify(key), key)
  const candidates = [...unique.values()]
  return candidates.filter(
    (key) => !candidates.some((other) => other !== key && isPrefixOf(other, key)),
  )
}

function isPrefixOf(prefix: QueryKey, key: QueryKey): boolean {
  if (prefix.length >= key.length) return false
  return prefix.every((part, index) => JSON.stringify(part) === JSON.stringify(key[index]))
}

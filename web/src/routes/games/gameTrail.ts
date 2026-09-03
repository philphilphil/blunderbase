/**
 * The library run a game was opened from, walkable without going back to the table.
 *
 * Reviewing is a batch job — twenty games from Saturday, or every loss with the French —
 * and the way that went was: open a game, read it, go back, find your place in the table,
 * open the next one. `[` and `]` on the game screen replace that (and two buttons, because
 * a keybinding with no affordance is a feature only its author knows about).
 *
 * What is kept is the *query*, not a list of ids: the filters and the sort the table was
 * showing, plus how far down that ordering this game sits. So stepping runs off the end of
 * the page the reader happened to be on and keeps going — the run is the whole filtered
 * library in the order the table put it in, which is what "the next game" means to someone
 * who was reading the table. A page's worth would have stopped at 25 for no reason the
 * reader could see.
 *
 * The neighbours are asked for rather than remembered, three rows at a time around where
 * the reader stands. That is one small request per game opened, and it is what makes the
 * run survive the library changing underneath it: the game either side is whatever is
 * either side *now*, not whatever was there when the table was last drawn.
 *
 * Session-only and a module-level value, for the same reasons as `sessionVariations`: the
 * page component unmounts on the way to the game and this does not, and a run that outlived
 * a reload would be a promise about a table nobody is looking at any more.
 */
import { useQuery } from '@tanstack/react-query'
import { useCallback, useSyncExternalStore } from 'react'

import * as api from '@/lib/api/endpoints'
import type { GameQuery } from '@/lib/api/endpoints'
import { queryKeys } from '@/lib/api/keys'

interface Trail {
  /** The table's filters and sort — everything but the paging. */
  query: GameQuery
  /** Where this game sits in that ordering, counted from 0 across the whole library. */
  offset: number
  /** Which game the offset is about, so a game reached another way inherits nothing. */
  gameId: number
}

let trail: Trail | null = null
const listeners = new Set<() => void>()

function announce() {
  for (const listener of listeners) listener()
}

/** Hand over the query the table was showing, and where in it the opened game sits. */
export function rememberTrail(next: Trail): void {
  trail = next
  announce()
}

/**
 * Follow the run one game along. Called as the game screen navigates, so the next screen
 * knows where it is without the table having been involved.
 */
export function advanceTrail(delta: number, gameId: number): void {
  if (!trail) return
  trail = { ...trail, offset: Math.max(0, trail.offset + delta), gameId }
  announce()
}

/** For the tests, which are one session each. */
export function resetTrail(): void {
  trail = null
  announce()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export interface TrailPosition {
  /** The game either side of this one in the run, or null at either end of the library. */
  previous: number | null
  next: number | null
}

/**
 * The games either side of this one in the run it was opened from, or null when it is not
 * in one — a game opened from the dashboard, from a note, from the palette or from a link.
 * Nothing is offered then, rather than something arbitrary: the run has to be one the
 * reader chose for stepping along it to mean anything.
 */
export function useGameTrail(gameId: number | null): TrailPosition | null {
  const read = useCallback(() => trail, [])
  const here = useSyncExternalStore(subscribe, read, read)
  const on = here !== null && gameId !== null && here.gameId === gameId

  // Three rows centred on where the reader stands — the game before, this one, the game
  // after — which is the whole of what the two arrows need. At the top of the library the
  // window starts at 0 and holds only this game and its follower.
  const from = on ? Math.max(0, here.offset - 1) : 0
  const query = { ...here?.query, limit: 3, offset: from }
  const window = useQuery({
    queryKey: queryKeys.gameCards(query),
    queryFn: () => api.listGameCards(query),
    enabled: on,
  })

  if (!on) return null
  const ids = window.data?.games.map((game) => game.id) ?? []
  // Found by id rather than by arithmetic on the offset: a game imported or deleted since
  // the table was drawn has moved everything after it, and the id is the only thing in the
  // window that still means what it meant.
  const at = ids.indexOf(gameId)
  if (at === -1) return { previous: null, next: null }
  return { previous: ids[at - 1] ?? null, next: ids[at + 1] ?? null }
}

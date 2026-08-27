/**
 * The human model on a position nobody analysed in batch — the analysis board's Maia
 * column.
 *
 * Off the game line every position is new, and the reader gets there by clicking through a
 * line: querying on every intermediate position would be a request per keystroke of the
 * mouse. So the FEN is debounced, and answers are cached forever under their position
 * (`useMaiaPolicy`), which makes walking back up a line free.
 *
 * A deployment with no backend-local Maia answers `409`. That is a standing fact rather
 * than a failure, so it is reported as `unavailable` and the caller renders nothing at all
 * — the spec's "degrade, don't error".
 */
import { useEffect, useState } from 'react'

import { ApiError } from '@/lib/api/client'
import { useMaiaPolicy } from '@/lib/api/queries'

import { maiaLive, type MaiaLiveView } from './gameModel'

/** How long the board has to sit still before the position is worth asking about. */
export const LIVE_DEBOUNCE_MS = 300
/** How far the rollout looks ahead — four moves of "what two humans would do next". */
export const ROLLOUT_PLIES = 8

export interface LiveMaia {
  view: MaiaLiveView | null
  /** A query is in flight, or one is about to be: the panel says so rather than blinking. */
  pending: boolean
  /** No backend-local Maia. The live section hides itself entirely. */
  unavailable: boolean
}

/** `value`, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    if (Object.is(value, settled)) return
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, settled, ms])
  return settled
}

export function useLiveMaia(fen: string | null, elo: number | null): LiveMaia {
  const settled = useDebounced(fen, LIVE_DEBOUNCE_MS)
  const asked = fen === null ? null : settled
  const query = useMaiaPolicy({ fen: asked, elo, rolloutPlies: ROLLOUT_PLIES })
  // What the cache holds answers for `asked`, which lags the board by the debounce window
  // (and answers instantly, from cache, for a position walked back to). A policy for the
  // position the reader has just left is not a weaker answer, it is the wrong one: an
  // arrow drawn from a square that is now empty, and rows offering moves that are no
  // longer legal — one click of which wedges the analysis line. So it is withheld until
  // the question has caught up with the board, and `pending` says why the column is bare.
  const current = asked === fen

  const unavailable = query.error instanceof ApiError && query.error.status === 409
  return {
    view: unavailable || !current ? null : maiaLive(query.data),
    pending: fen !== null && (!current || query.isFetching),
    unavailable,
  }
}

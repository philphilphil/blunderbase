/**
 * The lines the reader has walked, kept in the move list for the rest of the session.
 *
 * A game carries one line and the API has nowhere to put a second, so a variation the
 * reader clicks through has always died the moment they stepped out of it. This keeps it:
 * every line abandoned or replaced is handed over here, and the move list draws it under
 * the move it hangs off until the tab is closed.
 *
 * Session-only, and deliberately so. The store is a module-level `Map` — not
 * `localStorage`, not the backend — so kept lines survive navigating between games inside
 * the open app (the page component unmounts, this does not) and are gone on reload. That
 * is the whole promise: "the lines I clicked through today", with no store to prune and no
 * schema to migrate.
 *
 * Lines are held as UCI, which is what the analysis board replays; the SAN the move list
 * draws is derived at render (`sanVariation`) against the game being shown, so a line can
 * never disagree with the position it hangs off.
 */
import { useCallback, useSyncExternalStore } from 'react'

export interface KeptVariation {
  /** Stable for as long as the line is kept, so a click can name it. */
  id: number
  /** The number of game plies the line branches from — its first move is ply `base`. */
  base: number
  /** The line in UCI, as it actually replayed on the analysis board. */
  moves: string[]
}

/** Enough to hold an evening's reading of one game without turning the table into a tree. */
export const MAX_KEPT_VARIATIONS = 20

/**
 * What a game is called in this store. A library game is its id; a reference game has no
 * id in the library — that is the whole point of it — so it is named by its book and its
 * id there (`masters:xyz`). Two different keys either way, which is all this store asks.
 */
export type GameKey = number | string

const store = new Map<GameKey, KeptVariation[]>()
const listeners = new Set<() => void>()
let nextId = 1

/** One shared empty array, so an untouched game keeps a stable snapshot identity. */
const EMPTY: KeptVariation[] = []

/** `a` is `b`, or the start of it. */
export function isPrefix(a: readonly string[], b: readonly string[]): boolean {
  return a.length <= b.length && a.every((uci, index) => uci === b[index])
}

function read(gameId: GameKey): KeptVariation[] {
  return store.get(gameId) ?? EMPTY
}

function notify(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Keep `moves`, played from the game position after `base` plies.
 *
 * Two lines off the same position where one is the head of the other are one line the
 * reader walked twice, not two, so only the longer is kept: a new line already covered by
 * a kept one is dropped, and a kept one the new line continues is replaced where it stands
 * rather than stacked under itself. Bases are independent — the same moves off two
 * different positions are two different lines.
 */
export function keepVariation(
  gameId: GameKey,
  base: number,
  moves: readonly string[],
): void {
  if (moves.length === 0) return
  const current = read(gameId)
  if (current.some((kept) => kept.base === base && isPrefix(moves, kept.moves))) return

  const line: KeptVariation = { id: nextId, base, moves: [...moves] }
  nextId += 1

  const next: KeptVariation[] = []
  let placed = false
  for (const kept of current) {
    if (kept.base === base && isPrefix(kept.moves, moves)) {
      // The new line continues this one. There can only ever be one such entry — two would
      // be heads of each other, which is exactly what this rule prevents — but were there
      // a second it would simply fall away rather than leaving the line drawn twice.
      if (!placed) {
        next.push(line)
        placed = true
      }
      continue
    }
    next.push(kept)
  }
  if (!placed) next.push(line)

  // Oldest first, so the cap drops what was walked longest ago.
  store.set(gameId, next.slice(-MAX_KEPT_VARIATIONS))
  notify()
}

/**
 * Forget one kept line — what pinning it is: the server holds it now, so the session store
 * has no business holding a second copy of the same walk. Silent about an id it does not
 * have, so a pin that lands twice is not an error.
 */
export function dropVariation(gameId: GameKey, id: number): void {
  const current = read(gameId)
  const next = current.filter((kept) => kept.id !== id)
  if (next.length === current.length) return
  store.set(gameId, next)
  notify()
}

/** Test seam: forget every kept line, as a reload would. */
export function resetSessionVariations(): void {
  store.clear()
  nextId = 1
  notify()
}

export interface SessionVariations {
  /** The game's kept lines, oldest first. */
  kept: KeptVariation[]
  keep: (base: number, moves: readonly string[]) => void
  /** Forget one, because the server has taken it over. */
  drop: (id: number) => void
}

/** The kept lines for one game, and the way to add to and remove from them. */
export function useSessionVariations(gameId: GameKey): SessionVariations {
  const snapshot = useCallback(() => read(gameId), [gameId])
  const kept = useSyncExternalStore(subscribe, snapshot, () => EMPTY)
  const keep = useCallback(
    (base: number, moves: readonly string[]) => keepVariation(gameId, base, moves),
    [gameId],
  )
  const drop = useCallback((id: number) => dropVariation(gameId, id), [gameId])
  return { kept, keep, drop }
}

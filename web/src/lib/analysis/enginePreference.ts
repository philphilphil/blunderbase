/**
 * Which engine the analysis board was last pointed at, in this browser.
 *
 * The picker in `AnalysisControls` used to start at "deep tier" on every page load, so an
 * owner who analyses on the machine down the hall picked it again on every game. Which
 * engine to think with is a preference, not a fact about a position, so it belongs beside
 * the theme and the Maia level rather than in component state that dies with the route.
 *
 * Plain read and write rather than the `useSyncExternalStore` adapter the other preferences
 * use (`lib/board/linePreviewPrefs.ts`, `routes/game/maiaPreferences.ts`): one analysis
 * board is on screen at a time, and `useStreamSession` takes ownership of the pick the
 * moment it mounts — it has to be free to fall back to the deep tier when the remembered
 * engine is not on the roster *without* erasing what the owner chose. Nothing else reads
 * the value, so there is nothing for a subscription to keep in step.
 */
export const STREAM_ENGINE_KEY = 'bb.stream.engine'

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    // Storage disabled: the pick holds for this session only.
    return null
  }
}

/** The engine id the owner last picked, or null for "let the server take the deep tier". */
export function readStreamEnginePick(): number | null {
  let raw: string | null = null
  try {
    raw = storage()?.getItem(STREAM_ENGINE_KEY) ?? null
  } catch {
    return null
  }
  if (raw === null) return null
  const id = Number(raw)
  // Anything that is not an engine id is no pick, and the deep tier stands.
  return Number.isInteger(id) && id > 0 ? id : null
}

export function writeStreamEnginePick(id: number | null): void {
  try {
    const store = storage()
    if (id === null) store?.removeItem(STREAM_ENGINE_KEY)
    else store?.setItem(STREAM_ENGINE_KEY, String(id))
  } catch {
    // Quota or a private window: the pick still holds for this session.
  }
}

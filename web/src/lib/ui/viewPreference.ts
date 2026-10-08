/**
 * A per-browser choice of how a screen lays out its list — the notes' stream / sheet / list,
 * the collections' grid / table.
 *
 * A reading preference, not a filter, which is why it is not in the URL: a filter says
 * *which* things, this says how they are drawn, and a link should arrive in whichever shape
 * the person who opens it reads in. localStorage behind `useSyncExternalStore`, the same
 * way as `lib/board/arrowPrefs`; anything unreadable, or a value this build does not know,
 * reads as the default rather than throwing. Storage that refuses a write still leaves the
 * choice standing for the session.
 */
import { useSyncExternalStore } from 'react'

export interface ViewPreference<V extends string> {
  use: () => V
  /** The value now, for code outside React; a component reads it with `use` to follow it. */
  get: () => V
  set: (view: V) => void
  /** Test seam: forget what was read, so the next read hits storage again. */
  reset: () => void
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    // Storage disabled: the choice holds for this session and is not written down.
    return null
  }
}

export function viewPreference<V extends string>(
  key: string,
  views: readonly V[],
  fallback: V,
): ViewPreference<V> {
  let cache: V | null = null
  const listeners = new Set<() => void>()

  function read(): V {
    try {
      const stored = storage()?.getItem(key)
      return views.find((view) => view === stored) ?? fallback
    } catch {
      return fallback
    }
  }

  function snapshot(): V {
    if (cache === null) cache = read()
    return cache
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== key) return
      cache = read()
      for (const each of listeners) each()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      listeners.delete(listener)
      window.removeEventListener('storage', onStorage)
    }
  }

  return {
    use: () => useSyncExternalStore(subscribe, snapshot, () => fallback),
    get: snapshot,
    set(view) {
      cache = view
      try {
        storage()?.setItem(key, view)
      } catch {
        // Quota or a private window: the toggle still holds for this session.
      }
      for (const listener of listeners) listener()
    },
    reset() {
      cache = null
      for (const listener of listeners) listener()
    },
  }
}

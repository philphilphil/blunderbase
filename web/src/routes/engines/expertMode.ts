/**
 * Whether the Engines page shows the specialist machinery — UCI options, test runs — or
 * just the roster and the binary basics. Global to the page, not per-engine: it is a
 * reading level, not a fact about any one row. Follows `dashboard/ratingSpeeds.ts`'s
 * localStorage + `useSyncExternalStore` idiom.
 */
import { useSyncExternalStore } from 'react'

export const ENGINE_EXPERT_MODE_KEY = 'blunderbase.engineExpertMode'

let cache: boolean | null = null
const listeners = new Set<() => void>()

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    // Storage disabled: the toggle holds for this render only.
    return null
  }
}

function readExpertMode(): boolean {
  const store = storage()
  if (!store) return false
  try {
    // Off by default — the machinery it gates is what breaks a bad engine, not what
    // anyone needs on first visit.
    return store.getItem(ENGINE_EXPERT_MODE_KEY) === 'true'
  } catch {
    // Corrupt or unreadable: stay basic rather than throwing.
    return false
  }
}

function snapshot(): boolean {
  if (cache === null) cache = readExpertMode()
  return cache
}

function write(next: boolean): void {
  cache = next
  const store = storage()
  try {
    store?.setItem(ENGINE_EXPERT_MODE_KEY, String(next))
  } catch {
    // Quota or a private window: the toggle still holds for this session.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== ENGINE_EXPERT_MODE_KEY) return
    cache = readExpertMode()
    for (const each of listeners) each()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function setEngineExpertMode(next: boolean): void {
  write(next)
}

/** Test seam: forget what was read, so the next read hits storage again. */
export function resetEngineExpertMode(): void {
  cache = null
  for (const listener of listeners) listener()
}

export function useEngineExpertMode(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}

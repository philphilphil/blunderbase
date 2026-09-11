/**
 * "Your search finished" — the one thing about correspondence mode that has to reach the
 * owner when they are not looking at it.
 *
 * A search runs for hours or days. Whatever screen the owner is on when it ends, the news
 * is worth a line: the position is decided, or the engine died, or the limit they set was
 * reached and the slot is free again. So the listener is mounted by the shell rather than by
 * the correspondence pages, and it is silent unless the mode is on.
 *
 * **Only the ends nobody asked for.** `stopped` is the owner pressing Stop and needs no
 * announcement, and `queued`, `running` and `paused` are transitions they caused. What is
 * left is `done` and `failed`.
 *
 * The engine's name is not on the frame, so it is read out of the query cache — which still
 * holds the row, because invalidations are flushed on a timer and this listener runs before
 * that. A row already gone simply gets the sentence without a name in it, which is still
 * true.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'

import { queryKeys } from '@/lib/api/keys'
import { SETTING_DEFAULTS } from '@/lib/api/appSettings'
import { useAppSettings } from '@/lib/api/queries'
import type {
  CorrespondenceGameDetail,
  CorrespondenceSearch,
  CorrespondenceSearchList,
  CorrespondenceTreeNode,
} from '@/lib/api/types'
import { useEventListener } from '@/lib/events/EventsProvider'
import type { CorrespondenceSearchEvent } from '@/lib/events/types'
import { toast } from '@/lib/toast'

import { limitParts } from './searches'

/** The row as the cache still holds it, and the move it was searching. */
export interface CachedSearch {
  search: CorrespondenceSearch | null
  san: string | null
}

function findInTree(
  node: CorrespondenceTreeNode | null,
  searchId: number,
): { search: CorrespondenceSearch; san: string | null } | null {
  if (!node) return null
  const found = node.searches?.find((one) => one.id === searchId)
  if (found) return { search: found, san: node.san ?? null }
  for (const child of node.children) {
    const deeper = findInTree(child, searchId)
    if (deeper) return deeper
  }
  return null
}

/** The search row and the move it stands on, from whichever cached payload still has it. */
export function cachedSearch(
  client: ReturnType<typeof useQueryClient>,
  event: CorrespondenceSearchEvent,
): CachedSearch {
  if (typeof event.game_id === 'number') {
    const detail = client.getQueryData<CorrespondenceGameDetail>(
      queryKeys.correspondenceGame(event.game_id),
    )
    const inTree = findInTree(detail?.tree ?? null, event.search_id)
    if (inTree) return inTree
    const flat = detail?.searches?.find((one) => one.id === event.search_id)
    if (flat) return { search: flat, san: null }
  }
  for (const active of [true, false]) {
    const list = client.getQueryData<CorrespondenceSearchList>(
      queryKeys.correspondenceSearches(active),
    )
    const found = list?.searches.find((one) => one.id === event.search_id)
    if (found) return { search: found, san: null }
  }
  return { search: null, san: null }
}

export function useCorrespondenceSearchToasts(): void {
  const { t } = useLingui()
  const client = useQueryClient()
  const settings = useAppSettings()
  const on =
    (settings.data?.correspondence_enabled ?? SETTING_DEFAULTS.correspondence_enabled) === 1

  useEventListener('correspondence.search', (frame) => {
    if (!on) return
    const event = frame as CorrespondenceSearchEvent
    if (event.status !== 'done' && event.status !== 'failed') return
    const { search, san } = cachedSearch(client, event)
    const engine = search?.engine_name ?? t`The engine`
    const where = san ?? t`this position`

    if (event.status === 'failed') {
      toast.error(
        search?.error
          ? t`${engine} stopped on ${where}: ${search.error}`
          : t`${engine} stopped on ${where}.`,
      )
      return
    }
    const limited = search ? limitParts(search) !== null : false
    toast.success(
      limited
        ? t`${engine} reached its limit on ${where}.`
        : t`${engine} finished on ${where}.`,
    )
  })
}

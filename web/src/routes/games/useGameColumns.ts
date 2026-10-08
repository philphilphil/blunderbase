/**
 * The games list's columns as this reading of the screen has them: the owner's arrangement
 * (`GET /settings/game-columns`), less what ⇧E and an empty collections list take away
 * (`columnsFor`).
 *
 * One hook for the table and the page, because both decide something from the columns —
 * the table what to draw, the page which sort the library is read in (`sortHidden`) — and
 * reading one cache through one function is what keeps the header and the sort from ever
 * disagreeing about which columns there are. `columns` is memoised on what it is made of,
 * so the rows' memo holds across renders that change none of it.
 *
 * Until the arrangement has loaded, the list is drawn from this browser's copy of it, or the
 * default when there is none: a column choice is never worth a blank table. When it could
 * not be read at all, the list stays on this browser's copy rather than jumping back to the
 * default (and, sorted by a column the owner hid, re-sorting under them).
 *
 * Only an arrangement the server answered with is one to edit (`editable`). Every save is
 * the whole arrangement, so a box unticked over a stand-in — the default while the answer is
 * on its way to a new browser, an old copy here, or either after a failed read — would store
 * that stand-in as the owner's choice, on every device, with no warning. The menu waits.
 */
import { useCallback, useMemo } from 'react'

import { useCollections, useGameColumnsPref, useSaveGameColumns } from '@/lib/api/queries'
import { readLocalColumns } from '@/lib/games/demoColumns'
import { useRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { useEngineHidden } from '@/lib/ui/engineVisibility'

import {
  arrangeColumns,
  columnsFor,
  isDefaultArrangement,
  toColumnPref,
  type Arrangement,
  type LaidColumn,
} from './components/columns'

export interface GameColumnsState {
  /** The table's columns (`columnsFor`), the checkbox first. */
  columns: LaidColumn[]
  /** The owner's arrangement as this build reads it, unknown ids included (`arrangeColumns`). */
  arrangement: Arrangement
  /** Nothing to reset: the arrangement is this build's default. */
  isDefault: boolean
  /** Whether the owner has any collections, without which the Collections column is gone. */
  hasCollections: boolean
  /** ⇧E: Worst and Flags are gone, whatever the arrangement says. */
  engineHidden: boolean
  /**
   * The arrangement is the server's (or, on the demo, this browser's, the only one there
   * is), so a change can be saved on top of it. False while it is a stand-in.
   */
  editable: boolean
  /** The arrangement could not be read, so what is drawn is this browser's copy or the default. */
  failed: boolean
  /**
   * The arrangement is as known as it will be on this visit: read, failed, or drawn from this
   * browser's copy meanwhile. Until then the page does not know which sort it reads the
   * library in (`GamesPage`'s `readSort`).
   */
  resolved: boolean
  /** Store a new arrangement, whole; the list follows at once (`useSaveGameColumns`). */
  save: (next: Arrangement) => void
  /** Put this build's default back, and forget this browser's copy of the choice. */
  reset: () => void
}

export function useGameColumns(): GameColumnsState {
  const query = useGameColumnsPref()
  const { read_only: demo } = useRuntimeCapabilities()
  const engineHidden = useEngineHidden()
  const hasCollections = (useCollections().data?.collections?.length ?? 0) > 0
  const { save: send } = useSaveGameColumns()

  // A failed read drops the placeholder, so the copy is read again — once per failure.
  const failed = query.isError && query.data === undefined
  const fallback = useMemo(() => (failed ? readLocalColumns() : null), [failed])
  const pref = query.data ?? fallback
  const editable = demo || (query.data !== undefined && !query.isPlaceholderData)
  const resolved = demo || query.data !== undefined || query.isFetched

  const arrangement = useMemo(() => arrangeColumns(pref), [pref])
  const columns = useMemo(
    () => columnsFor(arrangement, engineHidden, hasCollections),
    [arrangement, engineHidden, hasCollections],
  )
  const isDefault = useMemo(() => isDefaultArrangement(arrangement), [arrangement])
  const save = useCallback((next: Arrangement) => send(toColumnPref(next)), [send])
  const reset = useCallback(() => send({ order: null, hidden: [] }), [send])

  return {
    columns,
    arrangement,
    isDefault,
    hasCollections,
    engineHidden,
    editable,
    failed,
    resolved,
    save,
    reset,
  }
}

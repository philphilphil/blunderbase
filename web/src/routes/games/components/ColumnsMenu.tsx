/**
 * "Columns" in the games screen's filter bar: which of the list's columns are shown, and in
 * what order (#42). A tool button that opens a checklist, the shape of the footer's Add to
 * (`TableFooter`) — a face, and a panel with `role="dialog"` under it, so the rows' arrow
 * keys and `/` stand down while it has the focus.
 *
 * In the filter bar's toolbar rather than over the table's header: a button laid over the
 * header covers some header whenever the table is not scrolled to its right end, and moves
 * with nothing the eye follows. The bar is where the screen's other commands already are,
 * and from there it never covers a column, a scrollbar or the fade that says there is more
 * to the right. Hidden below `md`, where a row is a card whose fields are fixed
 * (`columnsFor`): there is no table there to arrange.
 *
 * One row per column, in the arrangement's order — the top of the list is the left of the
 * table. The box shows or hides it. The grip at the row's start drags it to any place in
 * the list in one go (`dropColumn`), which across fifteen rows is what the arrows were too
 * slow for; the arrows stay beside it, because they are the move a keyboard or a screen
 * reader finds without being told how (the grip also takes Space and the arrow keys, dnd-kit's
 * keyboard sorting, and says so through its instructions). Either way a column the list
 * leaves out, Collections while there are none or one a newer build added, keeps its place,
 * and every move is saved at once, in order (`useSaveGameColumns`), so there is no Apply to
 * forget.
 *
 * The drag is dnd-kit's sortable rather than the browser's own drag and drop: that one paints
 * a ghost image the page cannot style, does nothing for a keyboard and behaves differently
 * in WebKit, where the desktop app runs. The rows only slide while dragging; nothing is
 * saved until the drop, so a cancelled drag (Escape) leaves the list as it was — and that
 * Escape is the drag's, not the panel's.
 *
 * One column has to stay. The last box left among the columns nothing else can take away
 * is disabled: Worst and Flags go with ⇧E and Collections with the last collection, so a
 * list kept alive by one of those alone could be emptied by a key press. Worst and Flags
 * stay editable under ⇧E — the choice is for when the engine is back — and say they are
 * off for now.
 *
 * Disabled until the arrangement on screen is the one the server holds: every save is the
 * whole arrangement, so an edit made over the default or an old copy standing in for it
 * would replace the owner's choice everywhere (`useGameColumns`'s `editable`). After a failed
 * read its title says so, since there is no panel to put a red line in.
 */
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Trans, useLingui } from '@lingui/react/macro'
import { ChevronDown, ChevronUp, Columns3, GripVertical } from 'lucide-react'
import type * as React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'

import { useGameColumns } from '../useGameColumns'
import {
  COLUMNS,
  dropColumn,
  known,
  moveColumn,
  setColumnHidden,
  type Column,
  type ColumnId,
} from './columns'
import { PopoverLabel } from './FilterPopover'

const BY_ID = new Map(COLUMNS.map((column) => [column.id, column] as const))

/** The columns ⇧E takes away whatever the owner chose (`columnsFor`). */
const ENGINE: ReadonlySet<ColumnId> = new Set(['worst', 'flags'])

/**
 * The columns something other than this menu can take away — ⇧E, or the last collection
 * going — so none of them alone counts as the column that has to stay.
 */
const REMOVABLE: ReadonlySet<ColumnId> = new Set([...ENGINE, 'collections'])

type Direction = 'up' | 'down'

export function ColumnsMenu() {
  const { t, i18n } = useLingui()
  const { arrangement, isDefault, hasCollections, engineHidden, editable, failed, save, reset } =
    useGameColumns()
  const [choosing, setOpen] = useState(false)
  // Shut while the arrangement on screen is a stand-in: any change would be saved over the
  // owner's real one (`useGameColumns`).
  const open = choosing && editable
  const host = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  /** The arrow just pressed, to hand the focus back to once the list has moved under it. */
  const refocus = useRef<{ id: ColumnId; direction: Direction } | 'first' | null>(null)
  /**
   * A drag is under way. Escape then cancels the drag, and must leave the panel open: this
   * listener is on the document before dnd-kit's (it is added when the panel opens, theirs
   * when a drag starts), so it still sees the drag as running when that Escape arrives.
   */
  const dragging = useRef(false)

  // A mouse drag starts after a few pixels, so a click on the grip is not a drag that goes
  // nowhere; the keyboard picks a row up with Space or Enter and moves it with the arrows.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (host.current && !host.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || dragging.current) return
      setOpen(false)
      // Back to where the panel came from, so the keyboard does not land on the page's top.
      trigger.current?.focus()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Opening puts the focus on the first box, so the keyboard starts inside the list.
  useEffect(() => {
    if (open) firstBox(panel.current)?.focus()
  }, [open])

  // A move reorders the rows, and moving the focused button out of the document and back
  // drops its focus; so the arrow pressed gets it back — or its other arrow, when the row
  // has just reached an end and the one pressed is now disabled. A reset disables itself,
  // so it hands the focus to the first box.
  useLayoutEffect(() => {
    const target = refocus.current
    if (!target || !panel.current) return
    refocus.current = null
    if (target === 'first') {
      firstBox(panel.current)?.focus()
      return
    }
    const other: Direction = target.direction === 'up' ? 'down' : 'up'
    const pressed = moveButton(panel.current, target.id, target.direction)
    ;(pressed && !pressed.disabled ? pressed : moveButton(panel.current, target.id, other))?.focus()
  }, [arrangement])

  const listed = known(arrangement).filter((id) => id !== 'collections' || hasCollections)
  const anchors = listed.filter((id) => !REMOVABLE.has(id) && !arrangement.hidden.has(id))

  const name = (column: Column) => i18n._(column.name ?? column.label!)

  function move(id: ColumnId, direction: Direction) {
    refocus.current = { id, direction }
    save(moveColumn(arrangement, id, direction, listed))
  }

  function drop({ active, over }: DragEndEvent) {
    dragging.current = false
    if (!over || active.id === over.id) return
    save(dropColumn(arrangement, String(active.id), String(over.id), listed))
  }

  // What a screen reader hears while a row is carried: its name and where it would land,
  // counted the way the list is read, rather than dnd-kit's English with the raw ids.
  const nameOf = (id: UniqueIdentifier) => {
    const column = BY_ID.get(String(id) as ColumnId)
    return column ? name(column) : String(id)
  }
  const placeOf = (id: UniqueIdentifier) => listed.indexOf(String(id) as ColumnId) + 1
  const count = listed.length
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const column = nameOf(active.id)
      return t`Picked up ${column}.`
    },
    onDragOver: ({ active, over }) => {
      if (!over) return undefined
      const column = nameOf(active.id)
      const place = placeOf(over.id)
      return t`${column} is at place ${place} of ${count}.`
    },
    onDragEnd: ({ active, over }) => {
      const column = nameOf(active.id)
      if (!over) return t`${column} dropped where it was.`
      const place = placeOf(over.id)
      return t`${column} dropped at place ${place} of ${count}.`
    },
    onDragCancel: ({ active }) => {
      const column = nameOf(active.id)
      return t`Moving ${column} cancelled; it is back in its place.`
    },
  }
  const instructions = t`To move a column, press Space or Enter on its grip, then the up and down arrow keys, and Space or Enter again to drop it. Escape cancels.`

  return (
    <div ref={host} className="relative flex-none max-md:hidden">
      <Button
        ref={trigger}
        type="button"
        variant="secondary"
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!editable}
        title={failed ? t`Could not read the column choice` : t`Choose and order the columns`}
        onClick={() => setOpen((current) => !current)}
        className="aria-expanded:bg-raised aria-expanded:shadow-none aria-expanded:hover:bg-raised"
      >
        <Columns3 aria-hidden />
        <Trans>Columns</Trans>
      </Button>
      {open ? (
        // Anchored to the button's right edge, since it sits at the bar's right end.
        <div
          ref={panel}
          role="dialog"
          aria-label={t`Columns`}
          className="bb-pop-in absolute top-[calc(100%+0.375rem)] right-0 z-30 flex max-h-[min(32rem,calc(100dvh-10rem))] w-max min-w-56 flex-col overflow-y-auto rounded-lg border border-edge bg-elevated p-1 shadow-[0_1.125rem_2.5rem_-1.125rem_var(--bb-shadow)]"
        >
          <div className="px-1.5 pt-1 pb-1.5">
            <PopoverLabel>
              <Trans>Columns</Trans>
            </PopoverLabel>
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            accessibility={{
              announcements,
              screenReaderInstructions: { draggable: instructions },
            }}
            onDragStart={() => {
              dragging.current = true
            }}
            onDragEnd={drop}
            onDragCancel={() => {
              dragging.current = false
            }}
          >
            <SortableContext items={listed} strategy={verticalListSortingStrategy}>
              {listed.map((id, index) => {
                const column = BY_ID.get(id)!
                const label = name(column)
                const shown = !arrangement.hidden.has(id)
                const alone = shown && anchors.length === 1 && anchors[0] === id
                const off = engineHidden && ENGINE.has(id)
                const hint = `columns-hint-${id}`
                return (
                  <SortableRow key={id} id={id} label={label}>
                    <div className="flex min-w-0 flex-col">
                      <Checkbox
                        checked={shown}
                        label={label}
                        disabled={alone}
                        title={alone ? t`One column has to stay` : undefined}
                        aria-describedby={off ? hint : undefined}
                        onCheckedChange={(next) => save(setColumnHidden(arrangement, id, !next))}
                        className="py-1"
                      />
                      {/* Under the name, lined up with it past the box (`size-4` + `gap-2`). */}
                      {off ? (
                        <span id={hint} className="pb-1 pl-6 text-meta text-dim">
                          <Trans>Off while the engine is hidden</Trans>
                        </span>
                      ) : null}
                    </div>
                    <span className="ml-auto flex flex-none items-center pl-3">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        data-move={`${id}:up`}
                        aria-label={t`Move ${label} up`}
                        title={t`Move ${label} up`}
                        disabled={index === 0}
                        onClick={() => move(id, 'up')}
                      >
                        <ChevronUp aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        data-move={`${id}:down`}
                        aria-label={t`Move ${label} down`}
                        title={t`Move ${label} down`}
                        disabled={index === listed.length - 1}
                        onClick={() => move(id, 'down')}
                      >
                        <ChevronDown aria-hidden />
                      </Button>
                    </span>
                  </SortableRow>
                )
              })}
            </SortableContext>
          </DndContext>
          <div className="mx-0.5 my-1 h-px flex-none bg-hairline" />
          <div className="flex justify-end px-1 pb-0.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isDefault}
              onClick={() => {
                refocus.current = 'first'
                reset()
              }}
            >
              <Trans>Reset to default</Trans>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * One row of the list as dnd-kit's sortable: the grip at its start is the only part that
 * picks it up, so the box and the arrows beside it stay ordinary clicks. While it is carried
 * it slides on the vertical axis only (the list has no other) and lifts to `raised` above
 * the rows it passes; the others slide aside to show where it would land.
 */
function SortableRow({
  id,
  label,
  children,
}: {
  id: ColumnId
  label: string
  children: React.ReactNode
}) {
  const { t } = useLingui()
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      data-column={id}
      style={{
        transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined,
        transition,
      }}
      className={cn(
        'flex items-center gap-1 rounded-md py-0.5 pr-1.5 pl-0.5',
        isDragging && 'relative z-10 bg-raised',
      )}
    >
      <Button
        ref={setActivatorNodeRef}
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t`Drag ${label} to another place`}
        title={t`Drag to move`}
        {...attributes}
        {...listeners}
        // `touch-none`: a finger on the grip drags the row instead of scrolling the panel.
        className={cn(
          'flex-none touch-none text-dim',
          isDragging ? 'cursor-grabbing' : 'cursor-grab',
        )}
      >
        <GripVertical aria-hidden />
      </Button>
      {children}
    </div>
  )
}

function firstBox(panel: HTMLElement | null): HTMLElement | null {
  return panel?.querySelector<HTMLElement>('[role="checkbox"]:not(:disabled)') ?? null
}

function moveButton(panel: HTMLElement, id: ColumnId, direction: Direction) {
  return panel.querySelector<HTMLButtonElement>(`[data-move="${id}:${direction}"]`)
}

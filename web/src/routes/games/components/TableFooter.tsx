/**
 * Design 2b's 46px footer, which now carries the paging as well as the selection.
 *
 * Both halves are here for the same reason: this strip is pinned, and everything it holds
 * is one click away wherever the reader has got to. That is what the table gained by
 * trading infinite scroll for pages — under a list that grew as you scrolled, the controls
 * at the end of it were somewhere you had to travel to.
 *
 * The design's "Add to study" and "Export PGN" still have no route behind them. What is
 * here is what is real: queue the analysis pass over the selection, and delete it. There is
 * no deeper pass to queue over a selection: asking for more is a choice about one game, made
 * in its Analyse dialog while looking at it.
 *
 * The selection half follows the control grammar (docs/design/README.md, "Controls"): the
 * count is data ("2 selected" in ink, not accent, which is for links), then Clear selection
 * as a tool button with its ×, a rule, and the commands in the order a selection is made
 * for them. "Add to ⌄" opens a menu, so it ends in the menu chevron; "Queue analysis" is the
 * region's one filled primary, last of the everyday commands; Delete… stands apart after a
 * gap as the red-outlined command, never the filled red: a filled red button on a strip
 * that appears every time a row is ticked is a warning about the page, not about the
 * action. The filled one is in the confirmation, which is also why its label ends in "…".
 * `size="sm"` is 28px inside the 46px line, which leaves the strip its breathing room.
 *
 * Below `md` the 46px line becomes as many lines as it needs. Nothing here shortens on a
 * phone: "Queue analysis" is what the button does, and a second line costs less than
 * guessing which word the owner would still recognise it by.
 *
 * "Add to" comes first among the actions because it is the one a selection is most often
 * made for, and it opens the shared collection checklist (`CollectionChecklist`) above
 * itself — the footer is pinned to the bottom, so a panel below it would open off screen.
 * With the Collection filter set the footer also offers "Remove from collection": the
 * checklist can do the same, but in a list narrowed to one collection taking games out is
 * the everyday act and deserves a button.
 * Both make the one line wider, so the words the pager implies leave earlier than they did.
 *
 * The paging half is the app's pickers and pager: Rows is a `PickerSelect` ("Rows: Fit
 * (13)", a value from a list, ⇅), and ‹ › are the `Pager`'s faces around a flat readout.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { ChevronDown, FolderMinus, Play, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { CollectionChecklist, type ChecklistGame } from '@/components/collections/CollectionChecklist'
import { Button } from '@/components/ui/button'
import { PickerSelect } from '@/components/ui/native-select'
import { Pager } from '@/components/ui/pager'

import { formatCount } from '../format'
import { pageRange, PAGE_SIZE_OPTIONS, type PageSizeChoice } from '../paging'

export interface TableFooterProps {
  selectedCount: number
  /**
   * The selected rows with the collections each is in, for Add to…'s ticks. The same rows
   * `selectedCount` counts.
   */
  selectedGames?: readonly ChecklistGame[]
  /** "+ New collection from these N…" — the page opens `CollectionDialog` with them. */
  onNewCollection?: () => void
  /** The Collection filter is set: offer to take the selection out of that collection. */
  inCollection?: boolean
  removing?: boolean
  onRemoveFromCollection?: () => void
  /** Rows on this page. */
  loadedCount: number
  total: number
  queueing: boolean
  deleting: boolean
  onQueue: () => void
  onDelete: () => void
  onClearSelection: () => void
  /** Set after a queue or a delete so the footer can say what happened. */
  message: string | null
  /** 1-based. */
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  pageSize: PageSizeChoice
  onPageSizeChange: (size: PageSizeChoice) => void
  /** The page size as a row count — what was asked for, which the last page falls short of. */
  rowsPerPage: number
  /** What "Fit" currently resolves to, so the option can say it. */
  fitRows: number
}

export function TableFooter({
  selectedCount,
  selectedGames = [],
  onNewCollection,
  inCollection = false,
  removing = false,
  onRemoveFromCollection,
  loadedCount,
  total,
  queueing,
  deleting,
  onQueue,
  onDelete,
  onClearSelection,
  message,
  page,
  pageCount,
  onPageChange,
  pageSize,
  onPageSizeChange,
  rowsPerPage,
  fitRows,
}: TableFooterProps) {
  const { t } = useLingui()
  const { first, last } = pageRange(page, rowsPerPage, loadedCount, total)
  // Named, because every one of these is what a translator sees as the placeholder.
  const selected = formatCount(selectedCount)
  const firstRow = formatCount(first)
  const lastRow = formatCount(last)
  const games = formatCount(total)

  return (
    <div className="@container flex h-[2.875rem] flex-none items-center gap-3 border-t border-hairline bg-panel px-5 max-md:h-auto max-md:flex-wrap max-md:gap-x-3 max-md:gap-y-1.5 max-md:px-3 max-md:py-2.5">
      {selectedCount > 0 ? (
        <>
          <span className="flex-none text-data font-medium tabular text-ink">
            <Trans>{selected} selected</Trans>
          </span>
          <Button type="button" size="sm" variant="secondary" onClick={onClearSelection}>
            <X aria-hidden />
            <Trans>Clear selection</Trans>
          </Button>
          <span aria-hidden className="h-4 w-px flex-none bg-hairline max-md:hidden" />
          <AddTo games={selectedGames} onNew={onNewCollection} />
          {inCollection && onRemoveFromCollection ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={removing}
              onClick={onRemoveFromCollection}
              aria-label={t`Remove from collection`}
            >
              <FolderMinus aria-hidden />
              {/* The long form where there is room; "Remove", with the Collection picker set
                  over the table, says the same thing where there is not. */}
              <span className="md:@max-[60rem]:hidden">
                <Trans>Remove from collection</Trans>
              </span>
              <span aria-hidden className="hidden md:@max-[60rem]:inline">
                <Trans context="button">Remove</Trans>
              </span>
            </Button>
          ) : null}
          <Button type="button" size="sm" disabled={queueing} onClick={onQueue}>
            <Play aria-hidden />
            <Trans>Queue analysis</Trans>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive-outline"
            disabled={deleting}
            onClick={onDelete}
            className="ml-2 max-md:ml-0"
          >
            <Trash2 aria-hidden />
            <Trans context="button">Delete…</Trans>
          </Button>
        </>
      ) : (
        <span className="min-w-0 truncate text-label text-dim">
          {inCollection ? (
            <Trans>
              Select rows to remove them from this collection, queue analysis, or delete them.
            </Trans>
          ) : (
            <Trans>
              Select rows to queue analysis over them, add them to a collection, or delete them.
            </Trans>
          )}
        </span>
      )}

      {/* The one thing on the row that may truncate: it repeats what the rows already show. */}
      {message ? (
        <span title={message} className="min-w-0 truncate font-mono text-label text-good">
          {message}
        </span>
      ) : null}

      {/* The spacer pushes the paging right on one line; on a wrapped one it would only
          strand it on a line of its own. */}
      <div className="flex-1 max-md:hidden" />

      {/*
        One line at a fixed height on a desktop, because the table under "Fit" measures its
        room against it and a footer that wrapped when rows were selected would page the
        selection away. So where the games area is narrow — a laptop with the rail open, or
        German labels — the words that the controls already imply leave instead: the range
        text first. The phone wraps (`max-md:`) and keeps it.
      */}
      <PickerSelect
        label={t`Rows`}
        title={t`Rows per page`}
        value={String(pageSize)}
        options={PAGE_SIZE_OPTIONS.map((option) => ({
          value: String(option),
          label: option === 'fit' ? t`Fit (${fitRows})` : String(option),
        }))}
        onChange={(value) => onPageSizeChange(value === 'fit' ? 'fit' : Number(value))}
        className="flex-none"
      />

      <Pager
        label={t`Pages`}
        page={page}
        pages={pageCount}
        onPrev={() => onPageChange(page - 1)}
        onNext={() => onPageChange(page + 1)}
        className="flex-none"
      />

      <span className="flex-none font-mono text-label tabular text-dim md:@max-[64rem]:hidden">
        <Trans>
          {firstRow}–{lastRow} of {games}
        </Trans>
      </span>
    </div>
  )
}

/**
 * "Add to ⌄" and the checklist it opens. The checklist does the writing and keeps its own
 * ticks honest (`CollectionChecklist`); this is only the button and the panel around it,
 * which closes on Escape, on a click outside and when "+ New collection…" hands over to the
 * dialog.
 *
 * The trigger is drawn as an `ActionMenu`'s (a face ending in ⌄, sunk to `raised` while
 * open, never blue), but the panel is a checklist rather than a list of commands: a tick
 * says where the games stand as well as changing it, which a menu item cannot.
 */
function AddTo({ games, onNew }: { games: readonly ChecklistGame[]; onNew?: () => void }) {
  const { t } = useLingui()
  const [open, setOpen] = useState(false)
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (host.current && !host.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={host} className="relative flex-none">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="aria-expanded:bg-raised aria-expanded:shadow-none aria-expanded:hover:bg-raised"
      >
        <Trans>Add to</Trans>
        <ChevronDown aria-hidden className="-mr-0.5 size-3 text-dim" />
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-label={t`Add to a collection`}
          className="bb-pop-in absolute bottom-[calc(100%+0.375rem)] left-0 z-30 rounded-lg border border-edge bg-elevated p-1 shadow-[0_1.125rem_2.5rem_-1.125rem_var(--bb-shadow)]"
        >
          <CollectionChecklist
            games={games}
            onNew={
              onNew
                ? () => {
                    setOpen(false)
                    onNew()
                  }
                : undefined
            }
          />
        </div>
      ) : null}
    </div>
  )
}

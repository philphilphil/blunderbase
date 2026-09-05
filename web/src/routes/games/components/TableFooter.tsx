/**
 * Design 2b's 46px footer, which now carries the paging as well as the selection.
 *
 * Both halves are here for the same reason: this strip is pinned, and everything it holds
 * is one click away wherever the reader has got to. That is what the table gained by
 * trading infinite scroll for pages — under a list that grew as you scrolled, the controls
 * at the end of it were somewhere you had to travel to.
 *
 * The design's "Add to study" and "Export PGN" still have no route behind them. What is
 * here is what is real: queue a quick or a deep pass over the selection, and delete it.
 *
 * The four actions are real buttons rather than the bare words they were: they sit in a
 * strip beside two counts and a pager, and a word with nothing around it reads as a label
 * of the row it is in. `size="sm"` is 28px inside the 46px line, which leaves the strip its
 * breathing room, and the delete is outlined in the blunder colour rather than filled with
 * it — a filled red button on a strip that appears every time a row is ticked is a warning
 * about the page, not about the action. The filled one is in the confirmation.
 *
 * Below `md` the 46px line becomes as many lines as it needs. Nothing here shortens on a
 * phone: "Queue deep analysis" is what the button does, and a second line costs less than
 * guessing which word the owner would still recognise it by.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type * as React from 'react'

import { Button } from '@/components/ui/button'

import { formatCount } from '../format'
import { pageRange, PAGE_SIZE_OPTIONS, type PageSizeChoice } from '../paging'

export interface TableFooterProps {
  selectedCount: number
  /** Rows on this page. */
  loadedCount: number
  total: number
  queueing: boolean
  deleting: boolean
  onQueue: (tier: 'quick' | 'deep') => void
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
    <div className="flex h-[2.875rem] flex-none items-center gap-3 border-t border-hairline bg-panel px-5 max-md:h-auto max-md:flex-wrap max-md:gap-x-3 max-md:gap-y-1.5 max-md:px-3 max-md:py-2.5">
      {selectedCount > 0 ? (
        <>
          <span className="font-mono text-[0.71875rem] tabular text-accent-teal">
            <Trans>{selected} selected</Trans>
          </span>
          <span className="h-4 w-px bg-line" />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={queueing}
            onClick={() => onQueue('quick')}
          >
            <Trans>Queue quick analysis</Trans>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={queueing}
            onClick={() => onQueue('deep')}
          >
            <Trans>Queue deep analysis</Trans>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={deleting}
            onClick={onDelete}
            className="border-blunder/35 text-blunder hover:border-blunder hover:text-blunder"
          >
            <Trans context="button">Delete</Trans>
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClearSelection}>
            <Trans>Clear selection</Trans>
          </Button>
        </>
      ) : (
        <span className="text-[0.71875rem] text-dim-2">
          <Trans>Select rows to queue analysis over them, or to delete them.</Trans>
        </span>
      )}

      {message ? <span className="font-mono text-[0.6875rem] text-good">{message}</span> : null}

      {/* The spacer pushes the paging right on one line; on a wrapped one it would only
          strand it on a line of its own. */}
      <div className="flex-1 max-md:hidden" />

      <label className="flex items-center gap-1.5 text-[0.6875rem] text-dim-2">
        <Trans>Rows</Trans>
        <select
          aria-label={t`Rows per page`}
          value={String(pageSize)}
          onChange={(event) => {
            const value = event.target.value
            onPageSizeChange(value === 'fit' ? 'fit' : Number(value))
          }}
          className="rounded-md border border-edge-input bg-elevated px-1.5 py-0.5 font-mono text-[0.6875rem] text-soft focus-visible:border-edge-hover focus-visible:outline-none"
        >
          {PAGE_SIZE_OPTIONS.map((option) => (
            <option key={String(option)} value={String(option)}>
              {option === 'fit' ? t`Fit (${fitRows})` : option}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-1">
        <PageStep
          label={t`Previous page`}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="size-3.5" aria-hidden />
        </PageStep>
        <span className="font-mono text-[0.6875rem] tabular text-soft" aria-live="polite">
          {formatCount(page)} / {formatCount(pageCount)}
        </span>
        <PageStep
          label={t`Next page`}
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="size-3.5" aria-hidden />
        </PageStep>
      </div>

      <span className="font-mono text-[0.6875rem] tabular text-dim-2">
        <Trans>
          {firstRow}–{lastRow} of {games}
        </Trans>
      </span>
    </div>
  )
}

/**
 * One step of the pager: a square of the same 28px the actions are, disabled at either end
 * of the library rather than hidden, so the pager does not change width at the ends.
 */
function PageStep({
  label,
  children,
  ...props
}: React.ComponentProps<'button'> & { label: string }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-label={label}
      className="size-7 p-0"
      {...props}
    >
      {children}
    </Button>
  )
}

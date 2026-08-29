/**
 * Design 2b's 46px footer: what is selected, what can be done with it, and where the
 * scroll has got to.
 *
 * The design's "Add to study", "Export PGN" and "Delete" have no route behind them
 * (`backend/api/routes/*.py` exposes no export and no delete), so the two actions here are
 * the two that are real: enqueue a quick or a deep pass over the selection.
 *
 * Below `md` the 46px line becomes as many lines as it needs. Nothing here shortens on a
 * phone: "Queue deep analysis" is what the button does, and a second line costs less than
 * guessing which word the owner would still recognise it by.
 */
import type * as React from 'react'

import { cn } from '@/lib/utils'

import { formatCount } from '../format'

export interface SelectionFooterProps {
  selectedCount: number
  loadedCount: number
  total: number
  sortedClientSide: boolean
  queueing: boolean
  onQueue: (tier: 'quick' | 'deep') => void
  onClearSelection: () => void
  /** Set after a queue call so the footer can say what happened. */
  message: string | null
}

export function SelectionFooter({
  selectedCount,
  loadedCount,
  total,
  sortedClientSide,
  queueing,
  onQueue,
  onClearSelection,
  message,
}: SelectionFooterProps) {
  return (
    <div className="flex h-[2.875rem] flex-none items-center gap-3 border-t border-hairline bg-panel px-5 max-md:h-auto max-md:flex-wrap max-md:gap-x-3 max-md:gap-y-1.5 max-md:px-3 max-md:py-2.5">
      {selectedCount > 0 ? (
        <>
          <span className="font-mono text-[0.71875rem] tabular text-accent-teal">
            {formatCount(selectedCount)} selected
          </span>
          <span className="h-4 w-px bg-line" />
          <FooterAction disabled={queueing} onClick={() => onQueue('quick')}>
            Queue quick analysis
          </FooterAction>
          <FooterAction disabled={queueing} onClick={() => onQueue('deep')}>
            Queue deep analysis
          </FooterAction>
          <FooterAction onClick={onClearSelection}>Clear selection</FooterAction>
        </>
      ) : (
        <span className="text-[0.71875rem] text-dim-2">
          Select rows to queue analysis over them.
        </span>
      )}

      {message ? (
        <span className="font-mono text-[0.6875rem] text-good">{message}</span>
      ) : null}

      {/* The spacer pushes the counts right on one line; on a wrapped one it would only
          strand them on a line of their own. */}
      <div className="flex-1 max-md:hidden" />

      {sortedClientSide ? (
        <span className="text-[0.6875rem] text-dim-2">
          sorted over the {formatCount(loadedCount)} loaded rows
        </span>
      ) : null}

      <span className="font-mono text-[0.6875rem] tabular text-dim-2">
        showing {formatCount(Math.min(loadedCount, total))} of {formatCount(total)}
      </span>
    </div>
  )
}

function FooterAction({
  className,
  ...props
}: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'text-[0.71875rem] text-soft transition-colors hover:text-ink disabled:text-dim-2',
        // A bare word is a fine mouse target and a poor thumb one; the phone gets a box.
        'max-md:rounded-md max-md:border max-md:border-edge max-md:px-2 max-md:py-1',
        className,
      )}
      {...props}
    />
  )
}

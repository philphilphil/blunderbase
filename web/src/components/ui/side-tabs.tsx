/**
 * Tabs down the side of a dialog: a short list of pages on the left, one page shown on the
 * right. The board settings dialog is the first user — six stacked sections had grown past
 * the height of a laptop screen, and a list of three pages never scrolls.
 *
 * The pane tab (`routes/game/components/PaneTabList`) turned on its side, so the two read
 * as one kind of control: the chosen tab is a folder tab — the page's own surface pushed
 * into the list, across the rule between them, with a 2px accent edge (`shadow-side-tab-on`)
 * — never a face, a box or the blue fill. An idle tab is `soft` text that lifts on hover.
 *
 * The structure is `PaneTabList`'s too: sibling `role=tab` buttons directly in the
 * `tablist`, one tab stop, and the arrows, Home and End moving and choosing at once. Up and
 * Down are the list's own arrows; Left and Right work as well, because below `sm` the list
 * lies across the top of the dialog and the arrows the eye expects turn with it.
 */
import type { KeyboardEvent, ReactNode } from 'react'

import { cn } from '@/lib/utils'

const KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']

export function SideTabList({
  label,
  className,
  children,
}: {
  /** The list's accessible name ("Board settings"). */
  label: string
  className?: string
  children: ReactNode
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!KEYS.includes(event.key)) return
    const tabs = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(':scope > [role="tab"]'),
    ].filter((tab) => !tab.disabled)
    if (tabs.length === 0) return
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement)
    let next: number
    if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (at + 1) % tabs.length
    else next = (at - 1 + tabs.length) % tabs.length
    event.preventDefault()
    tabs[next]!.focus()
    tabs[next]!.click()
  }
  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
      className={cn(
        'flex flex-none border-line bg-panel select-none',
        'flex-row overflow-x-auto border-b sm:flex-col sm:overflow-visible sm:border-r sm:border-b-0 sm:py-2',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function SideTab({
  selected,
  onSelect,
  controls,
  id,
  children,
}: {
  selected: boolean
  onSelect: () => void
  /** The id of the page this tab shows (`aria-controls`). */
  controls?: string
  id?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={selected}
      aria-controls={controls}
      tabIndex={selected ? 0 : -1}
      onClick={() => {
        if (!selected) onSelect()
      }}
      className={cn(
        // `border-y` on every tab (transparent while idle), so a label never moves a pixel
        // when it is chosen; `-mr-px` lets the chosen one cover the list's rule.
        'relative flex h-8 flex-none items-center whitespace-nowrap border-y border-transparent px-4 text-left text-data text-soft transition-colors hover:bg-raised hover:text-ink focus-visible:outline-offset-[-0.125rem] sm:-mr-px',
        // Across the top (below `sm`) the accent edge is the pane tab's, on top; down the
        // side it is on the left, against the list's own edge.
        selected &&
          'border-y-line bg-surface font-medium text-ink shadow-tab-on hover:bg-surface max-sm:border-y-transparent sm:shadow-side-tab-on',
      )}
    >
      {children}
    </button>
  )
}

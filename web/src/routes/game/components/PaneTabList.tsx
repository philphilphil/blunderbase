/**
 * The structure of a pane's tabs, so every strip is a real tablist: Moves / Flagged,
 * Notes / Book, Evaluation / Move time, Run / Live, the phone's game tabs.
 *
 * The strips had been built three ways (a tablist, a group of `aria-pressed` buttons, and
 * pills wrapped in spans), so a screen reader heard three kinds of thing and the arrow keys
 * worked in one. Here the tabs are sibling `role=tab` buttons directly in the `tablist`
 * (nothing else sits in the group: facts and tools follow it in the strip), with one tab
 * stop and the arrows, Home and End moving and choosing at once (automatic activation:
 * showing a pane's other half is cheap and cannot lose anything). The look is `TAB` /
 * `TAB_ON` from paneTabs.ts: a folder tab, never a face, a box or the blue fill.
 *
 * Named `PaneTabList.tsx`, not `PaneTabs.tsx`: on a case-insensitive disk (macOS, Windows)
 * an import of `./PaneTabs` resolves to `paneTabs.ts` first.
 */
import type { ComponentProps, KeyboardEvent, ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { PANE_COUNT, TAB, TAB_ON } from './paneTabs'

export function PaneTabList({
  label,
  className,
  children,
}: {
  /** The strip's accessible name ("Moves and flagged moments"). */
  label: string
  className?: string
  children: ReactNode
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const tabs = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(':scope > [role="tab"]'),
    ].filter((tab) => !tab.disabled)
    if (tabs.length === 0) return
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement)
    let next: number
    if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else if (event.key === 'ArrowRight') next = (at + 1) % tabs.length
    else next = (at - 1 + tabs.length) % tabs.length
    event.preventDefault()
    tabs[next]!.focus()
    tabs[next]!.click()
  }
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('flex h-full items-stretch', className)}
    >
      {children}
    </div>
  )
}

export function PaneTab({
  selected,
  onSelect,
  count,
  disabled,
  controls,
  id,
  title,
  className,
  children,
  ...rest
}: Pick<ComponentProps<'button'>, 'aria-label' | 'onMouseEnter' | 'onFocus'> & {
  /** A test hook (`data-testid`), passed through to the button. */
  'data-testid'?: string
  selected: boolean
  onSelect: () => void
  /** A count beside the name ("Flagged 10"), in `PANE_COUNT`. */
  count?: ReactNode
  disabled?: boolean
  /** The id of the panel this tab shows (`aria-controls`). */
  controls?: string
  id?: string
  title?: string
  className?: string
  children: ReactNode
}) {
  return (
    <button
      {...rest}
      type="button"
      role="tab"
      id={id}
      aria-selected={selected}
      aria-controls={controls}
      tabIndex={selected ? 0 : -1}
      title={title}
      disabled={disabled}
      onClick={() => {
        if (!selected) onSelect()
      }}
      className={cn(TAB, selected && TAB_ON, className)}
    >
      {children}
      {count === undefined || count === null ? null : (
        <span className={PANE_COUNT}>{count}</span>
      )}
    </button>
  )
}

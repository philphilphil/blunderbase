import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * "Do one of these": the move transport ⏮ ◀ ▶ ⏭, the flag navigation, the explorer's ◀ ▶.
 * Attached faces (docs/design/README.md, "Controls"): one outline with the face's shade and
 * no fill of its own, and each cell carrying the face, so a disabled cell (at the start of
 * a game) can drop it and read as not pressable while its neighbours stay raised.
 *
 * Never a sunken track: that is `Segmented`'s silhouette, and "do one of these four things"
 * must not look like "pick one of these values". Two or more independent page actions are
 * separate buttons, not a group.
 */
export function ButtonGroup({
  label,
  size = 'sm',
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'role'> & {
  /** The group's accessible name ("Move navigation"). */
  label: string
  /** `sm` (h-7) in control rows, `xs` (h-6) in pane strips. */
  size?: 'sm' | 'xs'
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex flex-none items-stretch overflow-hidden rounded-md border border-control-edge shadow-face',
        size === 'xs' ? 'h-6' : 'h-7',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

/**
 * One cell of a `ButtonGroup`. Icon cells are the usual case, so a name is required twice
 * over: `aria-label` for a screen reader and `title` for the pointer, both saying what the
 * cell does (and its key, where it has one). The focus ring is drawn inside the cell,
 * because the group clips its corners.
 */
export function ButtonGroupItem({
  className,
  ...props
}: React.ComponentProps<'button'> & { 'aria-label': string; title: string }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-full min-w-8 items-center justify-center bg-control px-2 text-body transition-colors not-first:border-l not-first:border-control-edge focus-visible:outline-offset-[-0.125rem] enabled:hover:bg-control-hover enabled:hover:text-ink enabled:active:bg-raised-2 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-faint-2 disabled:[&_svg]:opacity-70 [&_svg]:pointer-events-none [&_svg:not([class*=size-])]:size-4',
        className,
      )}
      {...props}
    />
  )
}

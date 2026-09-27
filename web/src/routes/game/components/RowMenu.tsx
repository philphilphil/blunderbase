/**
 * The ⋯ at the end of the board's control row: what this game rarely needs, one click away.
 *
 * The row under the board had grown to a dozen controls of the same weight, and the ones a
 * reader presses once a session — the way back to the explorer they came from, the tree
 * behind a correspondence game — were taking the same width as Analyse… and Note. They are
 * in here instead. Nothing that is pressed every game is: a menu is the wrong shape for a
 * control the hand goes to without looking, and the whole point of the row is that the hand
 * can.
 *
 * The button draws nothing at all when there is nothing rare to hold, which is the ordinary
 * library game — so the row does not grow a permanent ⋯ to hold an empty list.
 *
 * The ⋯ is the row's tool button as an `icon-sm` square, the row's `h-7` (below `md` the
 * phone's taller `max-md:py-1.5`, like the rest of the row). While the menu is
 * open it is lit the way a pressed toggle is (`aria-expanded` standing in for
 * `aria-pressed`), so "open" and "on" look the same everywhere.
 */
import { useLingui } from '@lingui/react/macro'
import { MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface RowMenuItem {
  id: string
  label: ReactNode
  onSelect: () => void
  /** Drawn at the end of the row, the way the shortcut sheet prints one. */
  shortcut?: string
}

export function RowMenu({ items, className }: { items: RowMenuItem[]; className?: string }) {
  const { t } = useLingui()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement | null>(null)

  // Escape closes it, and so does a press anywhere else: a menu that stayed open behind the
  // board would swallow the next click on a move.
  useEffect(() => {
    if (!open) return
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      }
    }
    const away = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', key)
    document.addEventListener('mousedown', away)
    return () => {
      document.removeEventListener('keydown', key)
      document.removeEventListener('mousedown', away)
    }
  }, [open])

  if (items.length === 0) return null

  return (
    <div ref={wrap} className={cn('relative flex-none', className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t`More for this game`}
        title={t`More for this game`}
        onClick={() => setOpen((was) => !was)}
        className={cn(
          buttonVariants({ variant: 'secondary', size: 'icon-sm' }),
          'flex-none max-md:h-auto max-md:py-1.5 aria-expanded:border-accent-teal/45 aria-expanded:bg-selected aria-expanded:text-ink aria-expanded:[&_svg]:text-accent-teal',
        )}
      >
        <MoreHorizontal aria-hidden />
      </button>
      {open ? (
        // Above the button rather than below it: this row is the last thing in the board
        // column, and a menu opening downwards would hang off the bottom of the window.
        <div
          role="menu"
          className="bb-card absolute bottom-[calc(100%+0.25rem)] left-0 z-40 flex min-w-[12rem] flex-col rounded-md py-1 shadow-[0_0.5rem_1.5rem_var(--bb-shadow)]"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className="flex items-center gap-3 px-3 py-1.5 text-left text-data text-body hover:bg-raised hover:text-ink"
            >
              <span className="flex-1 whitespace-nowrap">{item.label}</span>
              {item.shortcut ? (
                <span className="flex-none font-mono text-meta text-dim-2">
                  {item.shortcut}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

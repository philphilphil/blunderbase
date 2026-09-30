import { ChevronDown, MoreHorizontal, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { Button } from './button'

export interface ActionMenuItem {
  label: ReactNode
  onSelect: () => void
  icon?: LucideIcon
  /** Drawn at the end of the row: a shortcut, or a count. */
  hint?: string
  disabled?: boolean
}

/**
 * A list of commands behind one button: the game's `⋯`, "Add to ⌄", Notes' "Export ⌄"
 * (docs/design/README.md, "Controls").
 *
 * The trigger is the tool button's face. Labelled, it ends in `ChevronDown` (⌄ = a menu of
 * actions), never the picker's `ChevronsUpDown` (⇅ = a value from a list), so the two kinds
 * of dropdown say which they are before they are opened. Icon-only, it is the `⋯` square
 * (`MoreHorizontal`), which takes the strong edge like every icon face. Open, it sinks to
 * `raised` and drops its shade, the way a pressed face does; it does not turn blue, since
 * blue means on or narrowed and an open menu is neither.
 *
 * The behaviour is the one the board row's `RowMenu` and the account menu already had:
 * Escape and a press anywhere else close it (a menu left open behind the board would eat
 * the next click on a move), and the arrow keys walk the items, as a `role=menu` promises.
 */
export function ActionMenu({
  label,
  items,
  icon: TriggerIcon,
  iconOnly = false,
  side = 'bottom',
  align = 'start',
  size = 'sm',
  disabled,
  title,
  className,
}: {
  /** The trigger's words, or its accessible name when `iconOnly`. */
  label: string
  items: readonly ActionMenuItem[]
  /** Drawn before a labelled trigger's words, as on every labelled command ("Export ⌄"). */
  icon?: LucideIcon
  iconOnly?: boolean
  /** `top` where the trigger is the last thing in its column (the board row). */
  side?: 'bottom' | 'top'
  align?: 'start' | 'end'
  size?: 'sm' | 'xs'
  disabled?: boolean
  title?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const menuId = useId()

  const enabledIndexes = items.flatMap((item, index) => (item.disabled ? [] : [index]))

  useEffect(() => {
    if (!open) return
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        trigger.current?.focus()
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

  // Opening puts the focus on the first item that can be chosen, so the arrows start there.
  const firstEnabled = enabledIndexes[0]
  useEffect(() => {
    if (open && firstEnabled !== undefined) itemRefs.current[firstEnabled]?.focus()
  }, [open, firstEnabled])

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (enabledIndexes.length === 0) return
    const focused = itemRefs.current.findIndex((node) => node === document.activeElement)
    const at = enabledIndexes.indexOf(focused)
    let next: number
    switch (event.key) {
      case 'ArrowDown':
        next = enabledIndexes[(at + 1) % enabledIndexes.length]!
        break
      case 'ArrowUp':
        next = enabledIndexes[(at - 1 + enabledIndexes.length) % enabledIndexes.length]!
        break
      case 'Home':
        next = enabledIndexes[0]!
        break
      case 'End':
        next = enabledIndexes[enabledIndexes.length - 1]!
        break
      case 'Tab':
        setOpen(false)
        return
      default:
        return
    }
    event.preventDefault()
    itemRefs.current[next]?.focus()
  }

  return (
    <div ref={wrap} className={cn('relative inline-flex flex-none', className)}>
      <Button
        ref={trigger}
        variant="secondary"
        size={iconOnly ? (size === 'xs' ? 'icon-xs' : 'icon-sm') : size}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={iconOnly ? label : undefined}
        title={title ?? (iconOnly ? label : undefined)}
        disabled={disabled}
        onClick={() => setOpen((was) => !was)}
        className="aria-expanded:bg-raised aria-expanded:shadow-none aria-expanded:hover:bg-raised"
      >
        {iconOnly ? (
          <MoreHorizontal aria-hidden />
        ) : (
          <>
            {TriggerIcon ? <TriggerIcon aria-hidden className="size-3" /> : null}
            {label}
            <ChevronDown aria-hidden className="-mr-0.5 size-3 text-dim" />
          </>
        )}
      </Button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={cn(
            // `w-max`: the panel hangs off a trigger narrower than itself, and shrink-to-fit
            // would otherwise stop at the min width and let a long row run past the border.
            'bb-pop-in absolute z-40 flex w-max min-w-[12rem] flex-col gap-0.5 rounded-md border border-line bg-panel p-1 shadow-[0_0.75rem_2rem_var(--bb-shadow)]',
            side === 'top' ? 'bottom-[calc(100%+0.25rem)]' : 'top-[calc(100%+0.25rem)]',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, index) => {
            const Icon = item.icon
            return (
              <button
                // Items are commands in a fixed order; the index is their identity.
                key={index}
                ref={(node) => {
                  itemRefs.current[index] = node
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  trigger.current?.focus()
                  item.onSelect()
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-label text-soft transition-colors focus-visible:outline-offset-[-0.125rem] enabled:hover:bg-raised enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {Icon ? <Icon aria-hidden className="size-3.5 flex-none" /> : null}
                <span className="flex-1 whitespace-nowrap">{item.label}</span>
                {item.hint ? (
                  // Mono for a shortcut ("⌘E"), sans for words ("comments and variations").
                  <span
                    className={cn(
                      'flex-none text-meta text-dim',
                      !/\s/.test(item.hint) && 'font-mono',
                    )}
                  >
                    {item.hint}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

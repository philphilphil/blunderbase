/**
 * `?`: what the keyboard does, on the screen you are on.
 *
 * A shortcut nobody can find is a feature only the person who wrote it has. The app has
 * had board keys since the game view existed and there was no way to learn them short of
 * reading the source, so this is the affordance — one key, one button in the titlebar, and
 * a list that cannot go stale because it is printed from the same table the handlers
 * dispatch from (`lib/ui/shortcuts.ts`).
 *
 * The list is filtered by route rather than printed whole. A reader pressing `?` is asking
 * "what can I press *here*", and answering with three screens' worth of keys makes them do
 * the filtering themselves; the groups that apply everywhere stay, because those are true
 * here too.
 */
import { Keyboard } from 'lucide-react'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'

import { HELP_KEY, isTyping, shortcutsFor, type ShortcutGroup } from '@/lib/ui/shortcuts'
import { cn } from '@/lib/utils'

/** A key as it is printed: the app's one spelling of a keycap. */
function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="flex-none rounded border border-edge bg-elevated px-1.5 py-0.5 font-mono text-[0.625rem] whitespace-nowrap text-soft">
      {children}
    </kbd>
  )
}

/**
 * One heading and its keys, as a block that a column may not break in half.
 *
 * `break-inside-avoid` is what makes the multi-column body below readable: a group split
 * across a column boundary reads as two half-lists under one heading.
 */
function Group({ group }: { group: ShortcutGroup }) {
  return (
    <section className="mb-4 break-inside-avoid">
      <h3 className="border-b border-hairline px-1.5 pb-1 text-[0.625rem] tracking-[0.12em] text-faint uppercase">
        {group.name}
      </h3>
      <div className="pt-1">
        {group.shortcuts.map((shortcut) => (
          <div
            key={shortcut.label}
            className="flex items-baseline gap-3 rounded-md px-1.5 py-[0.1875rem] text-[0.71875rem] leading-snug text-soft"
          >
            <span className="min-w-0 flex-1">{shortcut.label}</span>
            <span className="flex flex-none items-center gap-1">
              {shortcut.keys.map((key) => (
                <Key key={key}>{key}</Key>
              ))}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function Dialog({ onClose }: { onClose: () => void }) {
  const { pathname } = useLocation()
  const groups = useMemo(() => shortcutsFor(pathname), [pathname])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-void/75 p-6 max-md:p-3"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {/*
        A sheet rather than the palette's little box.
        
        The game screen alone has two dozen keys under three headings, and one narrow column
        of them was a list to be scrolled and searched — which is the opposite of what a
        reader pressing `?` wants, since the answer they are after is one line and they do
        not know which. Wide and columnar, the whole of a screen's keyboard is on show at
        once and the eye picks the heading first.

        Sized against the window rather than in `rem`: this is as much of the screen as it
        needs and no more, so a short list still draws a short sheet (`max-h`, and the body
        is what scrolls if a small window cannot take it all).
      */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="bb-card flex max-h-full w-full max-w-[52rem] flex-col overflow-hidden shadow-[0_1rem_3rem_var(--bb-shadow)]"
      >
        <div className="flex flex-none items-center gap-2.5 border-b border-hairline px-4 py-2.5">
          <Keyboard className="size-3.5 flex-none text-faint" aria-hidden />
          <span className="min-w-0 flex-1 text-[0.8125rem] font-semibold text-ink">
            Keyboard shortcuts
          </span>
          <span className="flex-none text-[0.625rem] text-faint max-md:hidden">
            what this screen answers to
          </span>
          <Key>esc</Key>
        </div>

        {/*
          CSS columns, not a grid: the groups are different lengths and a grid would leave a
          ragged gap under the short ones, while columns pour them in and balance the height
          themselves. `break-inside-avoid` on each group is what keeps one from being cut in
          half at a column boundary.
        */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-1 columns-1 gap-x-8 md:columns-2 lg:columns-3">
          {groups.map((group) => (
            <Group key={group.name} group={group} />
          ))}
        </div>
      </div>
    </div>
  )
}

const ShortcutsContext = createContext<{ open: () => void }>({ open: () => {} })

/** The titlebar's `?` button, and anything else that grows a reason to raise the list. */
export function useShortcutsOverlay() {
  return useContext(ShortcutsContext)
}

/**
 * Mounted once, around the shell, for the same reason the palette is: the key works on
 * every route and the dialog has to outlive the page under it.
 */
export function ShortcutsOverlayProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const value = useMemo(() => ({ open: () => setOpen(true) }), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== HELP_KEY || event.metaKey || event.ctrlKey || event.altKey) return
      // A field takes the question mark; it is a character before it is a shortcut.
      if (isTyping(event.target)) return
      event.preventDefault()
      setOpen((was) => !was)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <ShortcutsContext.Provider value={value}>
      {children}
      {open ? <Dialog onClose={() => setOpen(false)} /> : null}
    </ShortcutsContext.Provider>
  )
}

/** The titlebar chip. Named beside the palette's, and the same size and weight. */
export function ShortcutsButton({ className }: { className?: string }) {
  const shortcuts = useShortcutsOverlay()
  return (
    <button
      type="button"
      onClick={shortcuts.open}
      aria-label="Keyboard shortcuts"
      title="Keyboard shortcuts (?)"
      className={cn(
        'flex flex-none items-center rounded-md border border-edge bg-elevated px-2.5 py-[0.3125rem] font-mono text-[0.6875rem] text-dim transition-colors hover:border-edge-hover hover:text-ink',
        className,
      )}
    >
      ?
    </button>
  )
}

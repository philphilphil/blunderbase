/**
 * The frame every engine dialog wears, and the labelled field inside it.
 *
 * The correspondence dialogs — new game, import PGN, the opponent's move, search with…,
 * expand… — and the game's Analyse… all stand on it, and they must not each invent their
 * own overlay: a reader who has learned that Escape closes one, that the backdrop closes
 * it, and that the title is what the screen reader announces has learned it for all of
 * them. It lives outside either screen because both use it.
 *
 * `role="dialog"` is load-bearing beyond accessibility: the game board's keys stand down
 * while one is open (`useBoardKeys`), so a key pressed on a chip here never moves the board.
 */
import { useEffect, type ReactNode } from 'react'

import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export function Frame({
  title,
  description,
  labelledBy,
  onClose,
  children,
  className,
}: {
  title: ReactNode
  description: ReactNode
  labelledBy: string
  onClose: () => void
  children: ReactNode
  className?: string
}) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])

  return (
    <div
      className="bb-fade-in fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-void/75 px-6 pt-[8vh] pb-8 max-md:px-4 max-md:pt-6"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(
          'bb-card bb-rise-in flex w-full max-w-[34rem] flex-col gap-4 px-5 py-5 shadow-[0_1rem_3rem_var(--bb-shadow)]',
          className,
        )}
      >
        <div className="flex flex-col gap-1.5">
          <h2 id={labelledBy} className="text-[0.875rem] font-semibold text-ink">
            {title}
          </h2>
          <p className="text-[0.75rem] leading-[1.65] text-dim">{description}</p>
        </div>
        {children}
      </div>
    </div>
  )
}

/** The label is tied to its box by id, so the form reads as a form to anything but a mouse. */
export function Field({
  id,
  label,
  children,
  className,
}: {
  id: string
  label: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}

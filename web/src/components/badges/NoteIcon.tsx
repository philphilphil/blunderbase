import { cn } from '@/lib/utils'

/**
 * "Something is written about this position" — a page with two lines on it, drawn by hand.
 *
 * It replaces the plain dot the move list used to draw, which said only *that* a mark
 * existed. At this size a shape still reads as a note where a dot reads as any of the other
 * dots the app draws (side to move, source, engine status), and the move list is dense
 * enough that telling them apart matters.
 *
 * Not a lucide icon: those are drawn on a 24px grid at stroke-width 2, and at ~9px the
 * strokes merge into a smudge. This one is drawn on a 12px grid at 1.3, which is what keeps
 * the two interior lines apart. It is `currentColor` throughout, so the caller decides the
 * colour — the move list uses the same accent the Notes tab does.
 */
export function NoteIcon({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('size-[0.5625rem] flex-none', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <path d="M2.6 1.6h4.6L9.4 3.8v6.6H2.6z" />
      <path d="M4.3 5.6h3.4M4.3 7.6h2.2" />
    </svg>
  )
}

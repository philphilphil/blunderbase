/**
 * One labelled control in the explorer's filter form: a sentence-case label at a fixed
 * width, so controls stacked under each other start at the same x, and the control beside
 * it. A segment or a row of chips cannot carry its own name the way a picker's
 * "Speed: All" does, and a row of unnamed words ("my games / masters / lichess") had to be
 * read before it could be understood (the clarity pass).
 *
 * The label is drawn for the eye only: the control beside it carries the same name as its
 * accessible one (the segment's `label`, the chip group's `aria-label`), so a screen reader
 * hears it once, on the control.
 *
 * The label is as tall as a `sm` control (h-7) and sits at the top, so it lines up with a
 * segment and with the first line of chips that wrap onto a second.
 */
import type { ReactNode } from 'react'

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span aria-hidden className="flex h-7 w-[4.25rem] flex-none items-center text-label text-dim">
        {label}
      </span>
      {children}
    </div>
  )
}

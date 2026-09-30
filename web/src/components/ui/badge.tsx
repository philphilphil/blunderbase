import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * A readout: a fact (MPV 2, played, Done, a source name, a run, a count), never a control.
 *
 * No border anywhere and no face (the clarity pass, docs/design/README.md "Controls"):
 * readouts had worn the same 1px border as the buttons beside them, so "Idle 0/0" and "MPV"
 * looked pressable. A readout is flat text or a borderless tint at most `h-4` tall; the
 * tinted variants keep their data colour. `outline` and `dashed` are the flat text form
 * now (their borders were the whole of what they were), kept as names so callers compile.
 * Not focusable, and no hover.
 */
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-1.5 [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-chip-neutral text-dim',
        outline: 'bg-transparent px-0 text-dim',
        dashed: 'bg-transparent px-0 text-dim',
        accent: 'bg-accent-teal/10 text-accent-teal',
        // The colour a run somebody asked for wears (`RUN_STYLES.requested`), borrowed for
        // anything else that is "the owner's own choice" rather than a default.
        deep: 'bg-deep/10 text-deep',
        danger: 'bg-blunder/10 text-blunder',
        warn: 'bg-mistake/10 text-mistake',
        good: 'bg-good/10 text-good',
      },
      size: {
        // The size is in the variant, not the base, so the line height pinned here survives
        // tailwind-merge (a font size after a `leading-*` drops it).
        default: 'text-meta leading-4',
        md: 'py-0.5 text-label',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

function Badge({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant, size, className }))}
      {...props}
    />
  )
}

/**
 * A readout with no tint at all, for the facts that sit in a toolbar or a strip beside
 * controls ("MPV 2", "40 plies", "Idle 0/0"): a figure in mono `meta`, words in sans
 * `label`, both `dim`. Its flatness is the point: nothing about it says "press".
 */
function Readout({
  num = false,
  className,
  ...props
}: React.ComponentProps<'span'> & {
  /** A figure (mono, `meta`) rather than words (sans, `label`). */
  num?: boolean
}) {
  return (
    <span
      data-slot="readout"
      className={cn(
        'whitespace-nowrap text-dim',
        num ? 'font-mono text-meta tabular' : 'text-label',
        className,
      )}
      {...props}
    />
  )
}

export { Badge, badgeVariants, Readout }

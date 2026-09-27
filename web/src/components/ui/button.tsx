import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Every button in the app, as one control standard (docs/design/README.md, "Controls").
 *
 * One tool button (`secondary`): the bordered control a toolbar, a control row or a table
 * footer is made of. It used to be hand-copied as a class string into eight places, each
 * of which had drifted by a padding or a shade, so the screens disagreed about what a
 * button looks like. The filled accent (`default`) is the primary action and there is at
 * most one per region; `outline` and `ghost` are the quieter neighbours.
 *
 * One selected state: a toggle says it is on with `aria-pressed`, and the button lights
 * the way a selected row or segment does — `--bb-selected` behind `ink`, the accent on the
 * border where there is one and on the icon. So "on" is the same blue fill everywhere
 * rather than each toggle inventing a tint. The filled `default` never takes it: it is
 * already the loudest thing in its region and has no quieter "off" to be pressed from.
 *
 * The base carries no font size and no gap on purpose. Each size sets its own, because a
 * bare `buttonVariants(...)` string on a Link or a raw button never passes through
 * tailwind-merge, and two font sizes in one class list are decided by stylesheet order
 * rather than by the size that was asked for.
 *
 * Nor does it suppress the outline: keyboard focus is the global `:focus-visible` ring in
 * index.css, the same one every hand-built control shows, so a control does not lose its
 * focus ring by being moved onto this standard.
 */
const PRESSED = 'aria-pressed:bg-selected aria-pressed:text-ink aria-pressed:[&_svg]:text-accent-teal'

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-accent-teal font-semibold text-accent-ink hover:bg-accent-hover',
        outline: `border border-edge-input text-body hover:border-edge-hover hover:text-ink aria-pressed:border-accent-teal/45 ${PRESSED}`,
        // The tool button.
        secondary: `border border-edge bg-elevated text-body hover:bg-raised hover:text-ink aria-pressed:border-accent-teal/45 ${PRESSED}`,
        ghost: `text-soft hover:bg-raised hover:text-ink ${PRESSED}`,
        destructive: 'bg-blunder text-blunder-ink hover:bg-blunder/85',
        link: 'text-accent-teal hover:text-accent-link',
      },
      size: {
        // Pane-title-strip controls: fits the 35-design-pixel strip with room to spare.
        xs: "h-6 gap-1 px-2 text-label [&_svg:not([class*='size-'])]:size-3",
        // The standard toolbar / control-row / footer button. h-7 is exactly what the game
        // screen's height budget reserves for its transport row.
        sm: "h-7 gap-1.5 px-2.5 text-data [&_svg:not([class*='size-'])]:size-3.5",
        default: "h-8 gap-1.5 px-3 text-data [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-2 px-4 text-lead [&_svg:not([class*='size-'])]:size-3.5",
        icon: "size-8 [&_svg:not([class*='size-'])]:size-4",
        'icon-sm': "size-7 [&_svg:not([class*='size-'])]:size-4",
        'icon-xs': "size-6 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

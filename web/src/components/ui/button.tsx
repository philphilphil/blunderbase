import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * The two buttons the app uses side by side ("Import PGN" / "Sync Lichess"):
 * a 1px outlined ghost on `--bb-edge-input` and a filled accent on `--bb-accent`
 * with `--bb-accent-ink` on it.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium outline-none transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: 'bg-accent-teal font-semibold text-accent-ink hover:bg-accent-hover',
        outline: 'border border-input text-soft hover:border-edge-hover hover:text-ink',
        secondary: 'bg-elevated border border-edge text-ink hover:bg-raised',
        ghost: 'text-soft hover:bg-raised hover:text-ink',
        destructive: 'bg-blunder text-blunder-ink hover:bg-blunder/85',
        link: 'text-accent-teal hover:text-accent-link',
      },
      size: {
        default: 'h-8 px-3 py-2',
        sm: 'h-7 rounded-md px-2.5 text-[0.6875rem]',
        lg: 'h-9 rounded-md px-4 text-[0.8125rem]',
        icon: 'size-8 rounded-md',
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

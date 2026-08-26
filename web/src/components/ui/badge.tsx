import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border px-1.5 py-px text-[0.625rem] leading-4 [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-edge bg-elevated text-soft',
        outline: 'border-edge-strong bg-transparent text-soft',
        dashed: 'border-dashed border-edge-strong bg-transparent text-dim-2',
        accent: 'border-accent-teal/30 bg-accent-teal/10 text-accent-teal',
        deep: 'border-deep/28 bg-deep/10 text-deep',
        danger: 'border-blunder/30 bg-blunder/10 text-blunder',
        warn: 'border-mistake/30 bg-mistake/10 text-mistake',
        good: 'border-good/30 bg-good/10 text-good',
      },
      size: {
        default: '',
        md: 'px-2 py-0.5 text-[0.71875rem]',
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

export { Badge, badgeVariants }

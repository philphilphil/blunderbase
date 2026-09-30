import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Every button in the app, as one control standard (docs/design/README.md, "Controls").
 *
 * A raised face means "press me", and only a pressable thing has one (the clarity pass).
 * The tool button (`secondary`) is that face: `--bb-control` on a `control-edge` border with
 * a 1px shade along its bottom (`shadow-face`), because the old `elevated` fill sat 1.05:1
 * off the panel and the border alone could not tell a button from a readout or a field. A
 * field is the inverse (sunk, `Input`), a chip is a border with no face, data has neither.
 * The filled accent (`default`) is the primary action, one per region and last in its
 * group; `ghost` is for icon actions in rows and strips, where a face would be noise;
 * `destructive-outline` is the red command in a toolbar and the filled `destructive` only
 * a confirm dialog's button. `outline` is retired: it is `secondary`'s exact string for one
 * release so a missed call site still draws a face, then it goes.
 *
 * Each state has its own channel (spec §4): hover lifts the face (`control-hover`), mouse
 * down sinks it (`raised-2`, the shade dropped), on is `aria-pressed` in the blue selected
 * fill with the accent on the border and the icon (the shade dropped: pushed in), focus is
 * the global solid ring. The filled `default` never takes `aria-pressed`: it has no quieter
 * "off" to be pressed from. Hover skips a pressed button (`not-aria-pressed`), so on stays
 * on under the pointer instead of lifting back into a face.
 *
 * One DISABLED look for every faced variant: the silhouette without the face (transparent,
 * `edge` border, `faint-2` text, icon at 70 %), so a disabled primary never reads as a faded
 * selection and a disabled secondary never as an enabled one. It keeps pointer events, so
 * the `title` saying why can be read and the cursor says not-allowed; hover and active are
 * therefore `not-disabled:`. That, and not `enabled:`, because Links take these classes too
 * (`buttonVariants` on a router `Link`, `asChild`), and `:enabled` never matches an `<a>`.
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
const DISABLED =
  'disabled:cursor-not-allowed disabled:border-edge disabled:bg-transparent disabled:text-faint-2 disabled:shadow-none disabled:[&_svg]:opacity-70'

/** The tool button: a raised face, lit blue while `aria-pressed`. */
const FACE = `border border-control-edge bg-control text-body shadow-face hover:not-disabled:not-aria-pressed:bg-control-hover hover:not-disabled:text-ink active:not-disabled:bg-raised-2 active:not-disabled:shadow-none aria-pressed:border-accent-teal/45 aria-pressed:bg-selected aria-pressed:text-ink aria-pressed:shadow-none aria-pressed:[&_svg]:text-accent-teal ${DISABLED}`

const variants = cva(
  'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors [&_svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: `border border-transparent bg-accent-teal font-semibold text-accent-ink hover:not-disabled:bg-accent-hover active:not-disabled:brightness-95 ${DISABLED}`,
        secondary: FACE,
        // Retired: the same face as `secondary`, kept one release so a missed call site is
        // not left unstyled. New code never asks for it (lib/ui/grammar.test.ts).
        outline: FACE,
        ghost:
          'text-soft hover:not-disabled:not-aria-pressed:bg-raised hover:not-disabled:text-ink active:not-disabled:bg-raised-2 aria-pressed:bg-selected aria-pressed:text-ink aria-pressed:[&_svg]:text-accent-teal disabled:cursor-not-allowed disabled:opacity-50',
        'destructive-outline': `border border-blunder/40 bg-control text-blunder shadow-face hover:not-disabled:bg-[color-mix(in_srgb,var(--bb-blunder)_10%,var(--bb-control))] active:not-disabled:bg-[color-mix(in_srgb,var(--bb-blunder)_15%,var(--bb-control))] active:not-disabled:shadow-none ${DISABLED}`,
        // Only the confirm button inside a confirmation dialog.
        destructive: `border border-transparent bg-blunder text-blunder-ink hover:not-disabled:bg-blunder/85 ${DISABLED}`,
        // Prose only; a link that goes somewhere is a `TextLink`.
        link: 'text-accent-teal underline-offset-2 hover:not-disabled:text-accent-link hover:not-disabled:underline disabled:cursor-not-allowed disabled:opacity-50',
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
    // An icon-only face has no label to say what it is, so its edge is the whole signal and
    // takes the stronger edge (3.14:1, WCAG 1.4.11).
    compoundVariants: [
      {
        variant: ['secondary', 'outline'],
        size: ['icon', 'icon-sm', 'icon-xs'],
        className: 'border-control-edge-strong',
      },
    ],
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

/**
 * The class list for a button-shaped element, merged: the icon sizes' strong edge has to
 * replace the face's edge rather than sit beside it, and a bare string on a Link would
 * otherwise leave the two to stylesheet order.
 */
function buttonVariants(props?: Parameters<typeof variants>[0]): string {
  return cn(variants(props))
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof variants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="button"
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  )
}

export { Button, buttonVariants }

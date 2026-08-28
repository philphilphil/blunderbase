import type { Color } from '@/lib/api/types'
import { cn } from '@/lib/utils'

const LABEL: Record<Color, string> = { white: 'White', black: 'Black' }

/**
 * The disc that says which side of a game is meant: light for white, dark for black, and a
 * dashed outline for a game no account has claimed a side of.
 *
 * It draws itself out of `--bb-side-*` rather than out of the surface and text tokens the
 * rest of the chrome uses, because those two families trade places between the themes and
 * the sides of a chessboard do not: a black disc that turns pale in the light theme reads
 * as the wrong game, which is exactly what it did before these tokens existed.
 */
export function SideDot({
  side,
  size = 'md',
  className,
}: {
  side: Color | null | undefined
  size?: 'sm' | 'md'
  className?: string
}) {
  const label = side ? LABEL[side] : 'Side unknown'
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-side={side ?? 'unknown'}
      className={cn(
        'inline-block flex-none rounded-full border',
        size === 'sm' ? 'size-[0.4375rem]' : 'size-[0.6875rem]',
        side === 'white'
          ? 'border-side-white-edge bg-side-white'
          : side === 'black'
            ? 'border-side-black-edge bg-side-black'
            : 'border-dashed border-faint bg-transparent',
        className,
      )}
    />
  )
}

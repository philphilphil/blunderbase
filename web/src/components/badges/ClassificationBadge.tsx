import { GLYPHS, glyphFor, type Glyph } from '@/lib/chess/classification'
import type { Classification } from '@/lib/api/types'
import { cn } from '@/lib/utils'

export type GlyphSize = 'sm' | 'md'

const SIZES: Record<GlyphSize, string> = {
  // The size the game cards use in the dashboard strip.
  sm: 'min-w-4 h-[0.9375rem] text-[0.59375rem] rounded-[0.1875rem]',
  // The size on the states sheet and in the move list.
  md: 'min-w-[1.125rem] h-4 text-[0.625rem] rounded-[0.1875rem]',
}

/**
 * The glyph badge from design 1c: `??` on a filled red for a blunder, everything else a
 * tinted chip. An ordinary ("good") move has no glyph at all, so this renders nothing.
 */
export function ClassificationBadge({
  classification,
  glyph,
  count,
  size = 'md',
  withLabel = false,
  className,
}: {
  classification?: Classification | null
  /** Use a glyph the engine has no rule for — `interesting`, `brilliant`. */
  glyph?: Glyph
  /** How many moves of this class the row has: `??1`, `?!5` — design 2b's Flags cell. */
  count?: number
  size?: GlyphSize
  withLabel?: boolean
  className?: string
}) {
  const kind = glyph ?? glyphFor(classification)
  if (!kind) return null
  const style = GLYPHS[kind]
  const label =
    count === undefined
      ? style.label
      : `${count} ${count === 1 ? style.label : style.label === 'inaccuracy' ? 'inaccuracies' : `${style.label}s`}`

  const badge = (
    <span
      className={cn(
        'inline-flex items-center justify-center px-1 font-mono font-bold',
        SIZES[size],
        style.badgeClass,
        !withLabel && className,
      )}
      title={label}
      aria-label={label}
      data-classification={kind}
    >
      {style.glyph}
      {count === undefined ? null : count}
    </span>
  )

  if (!withLabel) return badge
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-mono text-[0.78125rem]',
        style.textClass,
        className,
      )}
    >
      {badge}
      {style.label}
    </span>
  )
}

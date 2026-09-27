import { GLYPHS, glyphCountLabel, glyphFor, type Glyph } from '@/lib/chess/classification'
import type { Classification } from '@/lib/api/types'
import { cn } from '@/lib/utils'

export type GlyphSize = 'sm' | 'md'

/**
 * Content-width, not a fixed box. A one-character `?` in an 18px badge is mostly air while
 * `??` fills it, so the two read as different weights of the same thing when they are the
 * same size. Padding sizes both instead: `?` comes out narrow, `??` wide, and the shared
 * height and radius are what keep them one family. Height and radius therefore stay fixed —
 * only the width is allowed to follow the glyph. Both sizes set the glyph at `text-meta`,
 * the type scale's floor; `sm` is the shorter box, not a smaller letter.
 */
const SIZES: Record<GlyphSize, string> = {
  // The size the game cards use in the dashboard strip.
  sm: 'px-[0.1875rem] h-[0.9375rem] text-meta rounded-sm',
  // The size on the states sheet and in the move list.
  md: 'px-[0.1875rem] h-4 text-meta rounded-sm',
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
  const label = count === undefined ? style.label : glyphCountLabel(kind, count)

  const badge = (
    <span
      className={cn(
        'inline-flex items-center justify-center font-mono font-bold',
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
        'inline-flex items-center gap-1.5 font-mono text-data',
        style.textClass,
        className,
      )}
    >
      {badge}
      {style.label}
    </span>
  )
}

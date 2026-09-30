import { cn } from '@/lib/utils'

export type PickerSize = 'sm' | 'strip'

/** The silhouette without the face: the one disabled look every button shares (button.tsx). */
const DISABLED_LOOK =
  'cursor-not-allowed border-edge bg-transparent text-faint-2 shadow-none [&_svg]:opacity-70'

/**
 * The outline's classes for a picker in a given state, shared by `PickerButton` (a real
 * button) and `PickerSelect` (a look laid over a native select), so the two cannot drift.
 * Hover is written without `enabled:` because `PickerSelect`'s look is a `span`; a disabled
 * picker gets no hover classes at all instead.
 *
 * A plain module of its own, not beside the components: a `.tsx` that exports a helper
 * next to components loses React Fast Refresh for the whole file.
 */
export function pickerLook({
  size = 'sm',
  set = false,
  disabled = false,
}: {
  size?: PickerSize
  set?: boolean
  disabled?: boolean
}): string {
  const base = cn(
    'inline-flex items-stretch rounded-md border font-sans text-label whitespace-nowrap transition-colors',
    size === 'strip' ? 'h-6' : 'h-7',
  )
  if (disabled) return cn(base, DISABLED_LOOK)
  if (set) return cn(base, 'border-accent-teal/45 bg-selected text-ink shadow-none')
  if (size === 'strip') {
    // Quiet in a pane strip: no face at rest, the face on hover, focus and while open.
    return cn(
      base,
      'border-transparent bg-transparent text-body shadow-none',
      'hover:border-control-edge hover:bg-control-hover hover:text-ink hover:shadow-face',
      'focus-visible:border-control-edge focus-visible:bg-control-hover focus-visible:shadow-face',
      'has-focus-visible:border-control-edge has-focus-visible:bg-control-hover has-focus-visible:shadow-face',
      'aria-expanded:border-control-edge aria-expanded:bg-control-hover aria-expanded:shadow-face',
    )
  }
  return cn(
    base,
    'border-control-edge bg-control text-body shadow-face',
    'hover:not-aria-expanded:bg-control-hover hover:text-ink',
    'aria-expanded:bg-raised aria-expanded:shadow-none',
  )
}

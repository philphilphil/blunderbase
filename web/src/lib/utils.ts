import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * The type scale's six names (`index.css`'s `@theme` block). tailwind-merge knows the
 * stock sizes (`text-data` …) but reads any other `text-*` as a colour, so without this
 * `cn('text-dim', 'text-meta')` would drop one of the two as a conflict — silently, and in
 * whichever order the call site happened to write them.
 */
const TEXT_SIZES = ['meta', 'label', 'data', 'lead', 'heading', 'value'] as const

const twMerge = extendTailwindMerge({
  extend: { theme: { text: [...TEXT_SIZES] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * The two engine verbs of the game view, drawn as one family.
 *
 * Both are the same four corner brackets — the position is in the engine's frame — and
 * differ only in what sits inside: a solid block for **Analyse…**, a snapshot taken once
 * and kept, and a line for the live search, a look that goes on and keeps nothing. Side by
 * side in the engine pane's title strip they have to read as related and as different in
 * kind at once; a separate icon for each read as two ways of doing one thing.
 *
 * Drawn on lucide's grid and stroke (24 units, 2px, round joins) so they sit among its
 * icons, and on its own `scan` / `scan-line` shapes, which is what keeps them legible at the
 * 12px the strip draws them at. Colour is `currentColor` only.
 */
import type { SVGProps } from 'react'

import { cn } from '@/lib/utils'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>

function Frame({ className, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn('size-3.5 flex-none', className)}
      {...props}
    >
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      {children}
    </svg>
  )
}

/** Analyse…: the position framed and a solid result inside — bounded, and kept. */
export function AnalyseIcon(props: IconProps) {
  return (
    <Frame {...props}>
      <rect x="8.5" y="8.5" width="7" height="7" rx="1.5" fill="currentColor" stroke="none" />
    </Frame>
  )
}

/**
 * The live search: the same frame with a scan line through it, which sweeps while the
 * search runs (`on`) and rests across the middle while it does not.
 */
export function LiveAnalysisIcon({ on = false, ...props }: IconProps & { on?: boolean }) {
  return (
    <Frame {...props}>
      <path d="M7 12h10" className={on ? 'bb-scan-line' : undefined} />
    </Frame>
  )
}

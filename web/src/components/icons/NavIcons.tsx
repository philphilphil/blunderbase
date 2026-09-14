/**
 * The rail's destinations, drawn for Blunderbase rather than borrowed.
 *
 * One hand across the set, the one the engine pane's scan pair was drawn in
 * (`components/analysis/ScanIcons.tsx`): lucide's grid and stroke — 24 units, 2px, round
 * caps and joins — so they still sit among the lucide icons everywhere else, and one solid
 * accent per glyph. The accent is what makes them a family rather than ten stock pictures:
 * the first tile of the dashboard, the tallest column of the stats, the root the explorer
 * grows from, the seal on a correspondence envelope. Analysis is the scan frame itself
 * around a pair of squares, which is what ties the rail entry to the button that queues a
 * run on the game view.
 *
 * Judged at the rail's real size, 14px (`size-3.5`): no solid under two units, nothing a
 * pixel apart. Chess pieces were tried and did not survive that size. Colour is
 * `currentColor` only, so the rail's active and hover tokens tint them as they did lucide's.
 *
 * Only the rail's own destinations are here; generic controls (chevrons, the fold toggle,
 * trash, download) stay lucide, where a hand-drawn version would be the same drawing.
 */
import type { ReactNode, SVGProps } from 'react'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>

function Glyph({ children, ...props }: IconProps & { children: ReactNode }) {
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
      {...props}
    >
      {children}
    </svg>
  )
}

/** Four tiles, the first one filled: the screen that sums up the rest. */
export function DashboardIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" stroke="none" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Glyph>
  )
}

/** A table: the games are rows. */
export function GamesIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M3 15h18" />
    </Glyph>
  )
}

/** A position branching into two continuations, growing rightwards from a filled root. */
export function ExplorerIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="9" width="6" height="6" rx="1.5" fill="currentColor" stroke="none" />
      <path d="M9 12h3" />
      <path d="M12 12V8a2 2 0 0 1 2-2h1" />
      <path d="M12 12v4a2 2 0 0 0 2 2h1" />
      <rect x="15" y="3" width="6" height="6" rx="1.5" />
      <rect x="15" y="15" width="6" height="6" rx="1.5" />
    </Glyph>
  )
}

/** Three columns, the tallest filled. */
export function StatsIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M5 20v-4" />
      <path d="M12 20v-8" />
      <rect x="17" y="3" width="4" height="18" rx="1.5" fill="currentColor" stroke="none" />
    </Glyph>
  )
}

/** A sheet with a folded corner and two lines written on it. */
export function NotesIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9z" />
      <path d="M15 3v5a1 1 0 0 0 1 1h5" />
      <path d="M7 12h4" />
      <path d="M7 16h8" />
    </Glyph>
  )
}

/**
 * On air: a filled point between two arcs. The live *board*, a game followed as it is
 * played — deliberately nothing like the scan line of the live engine, which is another
 * thing entirely.
 */
export function LiveIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M6.3 6.3a8 8 0 0 0 0 11.4" />
      <path d="M17.7 6.3a8 8 0 0 1 0 11.4" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    </Glyph>
  )
}

/** An envelope with its seal: a move sent by post. */
export function CorrespondenceIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 8l10 6 10-6" />
      <circle cx="12" cy="14" r="2.5" fill="currentColor" stroke="none" />
    </Glyph>
  )
}

/** An archive box with a filled handle: where games come in and are kept. */
export function LibraryIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="2" y="3" width="20" height="5" rx="1.5" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <rect x="9.5" y="11.5" width="5" height="3" rx="1.5" fill="currentColor" stroke="none" />
    </Glyph>
  )
}

/** The scan frame of Analyse, around two squares of a board. */
export function AnalysisIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <rect x="7" y="7" width="4.5" height="4.5" rx="1" fill="currentColor" stroke="none" />
      <rect x="12.5" y="12.5" width="4.5" height="4.5" rx="1" fill="currentColor" stroke="none" />
    </Glyph>
  )
}

/** A chip with a filled core: the engines and the machines they run on. */
export function ComputeIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="currentColor" stroke="none" />
      <path d="M9 2v3" />
      <path d="M15 2v3" />
      <path d="M9 19v3" />
      <path d="M15 19v3" />
      <path d="M2 9h3" />
      <path d="M2 15h3" />
      <path d="M19 9h3" />
      <path d="M19 15h3" />
    </Glyph>
  )
}

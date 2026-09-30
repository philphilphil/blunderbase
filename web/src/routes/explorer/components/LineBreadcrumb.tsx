/**
 * The move path: `Line  start › 1.c4 › e5 › 2.Nc3`, the explorer's and the repertoire's way
 * back up the line. Every step walks the tree back to that point.
 *
 * A trail of steps, not a row of tinted chips (the clarity pass): each step is a ghost `xs`
 * button in mono, because it is a move and it is pressable, with a `›` in `faint` between
 * them. The step you stand on is marked the way the bar marks the page you are on — `ink`
 * and medium weight, plus `aria-current` — rather than by an accent box, since accent is
 * for links and a blue box read as a selected filter. "Line" names the row, so "start"
 * reads as a place in the line rather than a command to begin something.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { useNotation } from '@/lib/chess/notationPrefs'
import { cn } from '@/lib/utils'

import { plyLabel, type LineStep } from '../line'

export function LineBreadcrumb({
  steps,
  onTruncate,
}: {
  steps: readonly LineStep[]
  /** `ply` moves are kept — 0 goes back to the initial position. */
  onTruncate: (ply: number) => void
}) {
  const notate = useNotation()
  const { t } = useLingui()
  return (
    <div role="group" aria-label={t`Move path`} className="flex flex-wrap items-center gap-0.5">
      <span aria-hidden className="mr-1 text-label text-dim">
        <Trans comment="Label before the move path, e.g. “Line  start › 1.e4 › e5”.">Line</Trans>
      </span>
      <Step current={steps.length === 0} onClick={() => onTruncate(0)}>
        <Trans comment="Breadcrumb crumb for the position the line is replayed from.">
          start
        </Trans>
      </Step>
      {steps.map((step, index) => {
        // White's move carries its number; Black's follows it without repeating it.
        const san = notate(step.san)
        const label = step.ply % 2 === 0 ? `${plyLabel(step.ply)}${san}` : san
        return (
          <span key={`${step.ply}-${step.uci}`} className="flex items-center gap-0.5">
            <span aria-hidden className="px-0.5 text-label text-faint">
              ›
            </span>
            <Step current={index === steps.length - 1} onClick={() => onTruncate(step.ply + 1)}>
              {label}
            </Step>
          </span>
        )
      })}
    </div>
  )
}

function Step({
  current,
  onClick,
  children,
}: {
  current: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={onClick}
      aria-current={current ? 'step' : undefined}
      className={cn(
        'px-1.5 font-mono',
        current ? 'font-medium text-ink' : 'font-normal text-soft',
      )}
    >
      {children}
    </Button>
  )
}

/**
 * "Stop it at": a row of kinds and one number — what ends an engine's look.
 *
 * One component because two dialogs ask the same question with different kinds: a
 * correspondence search stops at minutes, depth, nodes or nothing at all, and the game's
 * Analyse… stops *each move* at seconds, depth or nodes. The kinds, their labels and what
 * switching kind resets the value to are the caller's; the shape — pressed chips, then a
 * box that disappears for a kind with no number — is the same everywhere, so a reader who
 * learned it in one dialog knows it in the other.
 *
 * Kept controlled: which kind resets to which value is a promise the dialog makes in its
 * own doc comment, and a field that remembered its own defaults would split that promise.
 */
import { useLingui } from '@lingui/react/macro'
import type { ReactNode } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export interface LimitKindOption<K extends string> {
  kind: K
  label: ReactNode
  /** A kind with no number — "Nothing" — hides the box. */
  unbounded?: boolean
  /** The box's `step`; seconds may be fractional where depth and nodes may not. */
  step?: number | 'any'
}

export function LimitField<K extends string>({
  label,
  groupLabel,
  kinds,
  kind,
  value,
  onKindChange,
  onValueChange,
  hint,
  className,
}: {
  label: ReactNode
  /** The group's accessible name, a plain string because `aria-label` cannot take a node. */
  groupLabel: string
  kinds: readonly LimitKindOption<K>[]
  kind: K
  value: string
  onKindChange: (kind: K) => void
  onValueChange: (value: string) => void
  hint?: ReactNode
  className?: string
}) {
  const { t } = useLingui()
  const current = kinds.find((option) => option.kind === kind)
  return (
    <div className={cn('flex min-w-0 flex-1 flex-col gap-1.5', className)}>
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={groupLabel} className="flex gap-1">
          {kinds.map((option) => (
            <button
              key={option.kind}
              type="button"
              aria-pressed={kind === option.kind}
              onClick={() => onKindChange(option.kind)}
              className={cn(
                'rounded-md border px-2 py-1 text-[0.6875rem] transition-colors',
                kind === option.kind
                  ? 'border-accent-teal/40 bg-selected text-ink'
                  : 'border-edge text-dim hover:border-edge-hover hover:text-ink',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        {current?.unbounded ? null : (
          <Input
            aria-label={t`Limit`}
            type="number"
            min={current?.step === 'any' ? 0 : 1}
            step={current?.step}
            inputMode={current?.step === 'any' ? 'decimal' : 'numeric'}
            className="w-32"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
          />
        )}
      </div>
      {hint ? <p className="text-[0.625rem] leading-[1.5] text-dim-2">{hint}</p> : null}
    </div>
  )
}

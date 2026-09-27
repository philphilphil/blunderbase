import type { MessageDescriptor } from '@lingui/core'
import { useLingui } from '@lingui/react/macro'
import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface ViewOption<V extends string> {
  id: V
  label: MessageDescriptor
  icon: LucideIcon
  /** What the view is for, on hover. */
  hint: MessageDescriptor
}

/**
 * The switch between ways of drawing one list — the notes' stream / sheet / list, the
 * collections' grid / table — as one segmented control rather than separate buttons, so
 * every screen that has one has the same one.
 *
 * Radios in `aria` terms, because that is what they are: mutually exclusive ways of showing
 * one list, one of which is always on. Labels are hidden below `sm` — the icons carry it on
 * a phone, where the row is already tight.
 */
export function ViewToggle<V extends string>({
  views,
  value,
  onChange,
  label,
}: {
  views: readonly ViewOption<V>[]
  value: V
  onChange: (view: V) => void
  /** The group's accessible name — "How to show the notes". */
  label: string
}) {
  const { i18n } = useLingui()
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex items-center rounded-md border border-edge bg-elevated p-px"
    >
      {views.map((option) => {
        const on = value === option.id
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={on}
            title={i18n._(option.hint)}
            onClick={() => onChange(option.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-[0.3125rem] px-2 py-[0.1875rem] text-label transition-colors',
              on ? 'bg-raised-2 text-ink' : 'text-dim hover:text-soft',
            )}
          >
            <option.icon className="size-3.5" aria-hidden />
            <span className="max-sm:sr-only">{i18n._(option.label)}</span>
          </button>
        )
      })}
    </div>
  )
}

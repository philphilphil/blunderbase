import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * One switch in the strip above the sources table — what the next sync is told.
 *
 * The box and the label are one hit target rather than a checkbox with a label beside it:
 * nothing here is nested, and the whole control toggles.
 */
export function SyncCheckbox({
  label,
  title,
  checked,
  onChange,
  disabled,
}: {
  label: string
  /** The tooltip, where what the switch does is worth a sentence the strip has no room for. */
  title?: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group flex items-center gap-2 rounded-md text-left outline-none disabled:opacity-50"
    >
      <span
        aria-hidden
        className={cn(
          'flex size-3.5 flex-none items-center justify-center rounded-sm border transition-colors',
          checked
            ? 'border-accent-teal/40 bg-accent-teal/15 text-accent-teal'
            : 'border-edge text-transparent group-hover:border-edge-hover',
        )}
      >
        <Check className="size-2.5" strokeWidth={3} />
      </span>
      <span className={cn('text-[0.6875rem]', checked ? 'text-soft' : 'text-dim')}>{label}</span>
    </button>
  )
}

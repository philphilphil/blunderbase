import { cn } from '@/lib/utils'

/** The small pill-with-dot switch shared across the Engines page. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex h-[1.125rem] w-8 flex-none items-center rounded-full border p-px transition-colors disabled:opacity-50',
        checked ? 'border-accent-teal/40 bg-accent-teal/25' : 'border-edge bg-elevated',
      )}
    >
      <span
        className={cn(
          'size-3.5 rounded-full transition-transform',
          checked ? 'translate-x-3.5 bg-accent-teal' : 'translate-x-0 bg-faint',
        )}
      />
    </button>
  )
}

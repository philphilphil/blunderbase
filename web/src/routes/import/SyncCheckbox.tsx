import { Checkbox } from '@/components/ui/checkbox'

/**
 * One option on the Import page: what the next sync is told ("From the beginning", "Skip
 * evaluation") or whether a box takes part in Sync all ("Include in sync").
 *
 * The app's one `Checkbox`, at the `label` size these option rows are set in: a checkbox
 * because each is an option ticked for what comes next, not a mode that holds from now on
 * (that is "Sync automatically", a `Switch`). The box and the label are one hit target, and
 * the label names it.
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
    <Checkbox
      checked={checked}
      onCheckedChange={(next) => onChange(next)}
      label={label}
      title={title}
      disabled={disabled}
      className="text-label"
    />
  )
}

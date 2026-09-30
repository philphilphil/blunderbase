import type { MessageDescriptor } from '@lingui/core'
import { useLingui } from '@lingui/react/macro'
import type { LucideIcon } from 'lucide-react'

import { Segmented } from './segmented'

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
 *
 * It is a `Segmented` (one component for every one-of-N choice, docs/design/README.md,
 * "Controls"): the chosen view is the raised thumb in the sunken track, the others stay at
 * `soft`, the floor for a control's idle text. This wrapper only keeps the view tables'
 * shape (a message for the label and one for the hover hint) that Notes and Collections share.
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
    <Segmented
      label={label}
      value={value}
      onChange={onChange}
      labelClassName="max-sm:sr-only"
      options={views.map((view) => ({
        value: view.id,
        label: i18n._(view.label),
        title: i18n._(view.hint),
        icon: view.icon,
      }))}
    />
  )
}

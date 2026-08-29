/**
 * The two pieces every settings form here is made of: a number box that says what is in
 * force when it is empty, and the Revert/Save pair under a form.
 *
 * Shared because the settings are split across three screens now (Engine passes, Maia, the
 * fallback rating on Import) and a box that spells its default differently on one of them
 * would read as a different kind of setting. Empty is never zero: it is the deployment
 * saying nobody has set this, which is why the caption under the box is part of the field
 * rather than something each page writes for itself.
 */
import { Loader2, RotateCcw, Save } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AppSettings } from '@/lib/api/types'

export interface SettingSpec<K extends keyof AppSettings = keyof AppSettings> {
  key: K
  label: string
  /** The box's range and step. `min`/`max` bound the spinner; the backend owns the rule. */
  min: number
  max?: number
  step: number
  /** What is in force when the box is empty, spelled the way the row wants it read. */
  unset: string
}

export function SettingField({
  field,
  value,
  onChange,
}: {
  field: SettingSpec
  value: string
  onChange: (value: string) => void
}) {
  const id = field.key.replace(/_/g, '-')
  return (
    <div className="flex w-36 flex-none flex-col gap-1.5">
      <Label htmlFor={id}>{field.label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={field.min}
        max={field.max}
        step={field.step}
        value={value}
        placeholder="not set"
        autoComplete="off"
        className="w-full font-mono tabular"
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="font-mono text-[0.625rem] text-dim-2 tabular">{field.unset}</span>
    </div>
  )
}

/** Revert only while there is something to revert, so a settled form is one button wide. */
export function SaveRow({
  dirty,
  pending,
  onRevert,
}: {
  dirty: boolean
  pending: boolean
  onRevert: () => void
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      {dirty ? (
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onRevert}>
          <RotateCcw aria-hidden /> Revert
        </Button>
      ) : null}
      <Button type="submit" size="sm" disabled={!dirty || pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
        Save
      </Button>
    </div>
  )
}

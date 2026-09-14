/**
 * How many lines an engine keeps, 1 to 5.
 *
 * Empty is a choice, not a missing value: the placeholder shows the deployment's own
 * number and an empty box sends nothing, so the server's setting decides. That is why the
 * box never pre-fills with the default — a filled box would pin today's setting onto the
 * request and quietly ignore it the day the owner changes it.
 */
import { Trans } from '@lingui/react/macro'

import { Input } from '@/components/ui/input'

import { Field } from './DialogFrame'

export function LinesField({
  id,
  value,
  placeholder,
  onChange,
  className = 'w-28',
}: {
  id: string
  value: string
  /** The deployment's line count, which an empty box stands for. */
  placeholder: number
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <Field id={id} label={<Trans>Lines</Trans>} className={className}>
      <Input
        id={id}
        type="number"
        min={1}
        max={5}
        inputMode="numeric"
        placeholder={String(placeholder)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

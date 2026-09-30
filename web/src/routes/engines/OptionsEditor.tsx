import { Trans, useLingui } from '@lingui/react/macro'
import { RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input, SearchInput } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { cn } from '@/lib/utils'

import { isEditable, type DeclaredOption, type OptionDraft } from './options'

/** The value column narrows below `md` so the option's own name keeps room to be read. */
const VALUE_WIDTH = 'w-44 max-md:w-28'

/** The same sunk field as the inputs beside it, at their height. */
const SELECT_CLASS = `h-8 ${VALUE_WIDTH}`

function range(option: DeclaredOption): string | null {
  if (option.type !== 'spin') return null
  if (option.min === null && option.max === null) return null
  return `${option.min ?? '−∞'}–${option.max ?? '∞'}`
}

function Field({
  option,
  value,
  onChange,
  invalid,
}: {
  option: DeclaredOption
  value: string
  onChange: (next: string) => void
  invalid: boolean
}) {
  const { t } = useLingui()
  if (!isEditable(option)) {
    return (
      <span className={cn(VALUE_WIDTH, 'text-right font-mono text-label text-faint')}>
        {option.managed ? t`set per analysis` : t`action`}
      </span>
    )
  }

  if (option.type === 'check') {
    const fallback = option.default || 'false'
    return (
      <NativeSelect
        aria-label={option.name}
        aria-invalid={invalid}
        className={SELECT_CLASS}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{t`default (${fallback})`}</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </NativeSelect>
    )
  }

  if (option.type === 'combo' && option.choices.length > 0) {
    const fallback = option.default || '—'
    return (
      <NativeSelect
        aria-label={option.name}
        aria-invalid={invalid}
        className={SELECT_CLASS}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{t`default (${fallback})`}</option>
        {option.choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </NativeSelect>
    )
  }

  return (
    <Input
      aria-label={option.name}
      aria-invalid={invalid}
      className={cn(VALUE_WIDTH, 'font-mono')}
      inputMode={option.type === 'spin' ? 'numeric' : undefined}
      placeholder={option.default || t`default`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

/**
 * Every option the binary declares, with the ones this engine has stored filled in.
 *
 * An empty field means "whatever the engine defaults to" — the editor never writes a
 * default back, so an engine upgrade that changes one is followed rather than pinned.
 *
 * Every value is a sunk field (an input, or the native select for a check or a combo),
 * the list is narrowed by a search field and an "Only set" checkbox (a filter you tick, not
 * a lit chip), and each row's reset is a ghost icon, the grammar's action inside a row.
 */
export function OptionsEditor({
  declared,
  draft,
  errors,
  onChange,
}: {
  declared: DeclaredOption[]
  draft: OptionDraft
  errors: Record<string, string>
  onChange: (draft: OptionDraft) => void
}) {
  const { t } = useLingui()
  const [filter, setFilter] = useState('')
  const [onlySet, setOnlySet] = useState(false)

  const set = useMemo(
    () => Object.entries(draft.values).filter(([, value]) => value.trim() !== '').length,
    [draft.values],
  )

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return declared.filter((option) => {
      if (needle && !option.name.toLowerCase().includes(needle)) return false
      if (onlySet && (draft.values[option.name] ?? '').trim() === '') return false
      return true
    })
  }, [declared, filter, onlySet, draft.values])

  function update(name: string, next: string) {
    const values = { ...draft.values }
    if (next === '') delete values[name]
    else values[name] = next
    onChange({ values })
  }

  // An option that is stored but no longer declared has to be visible, or it can never be
  // cleared — the probe drives the list and it would simply not be in it.
  const orphans = Object.keys(draft.values).filter(
    (name) => !declared.some((option) => option.name === name),
  )
  const total = declared.length

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 max-md:flex-wrap">
        <SearchInput
          value={filter}
          aria-label={t`Filter options`}
          placeholder={t`Filter options…`}
          inputSize="sm"
          wrapperClassName="w-48 max-md:w-36"
          onChange={(event) => setFilter(event.target.value)}
        />
        <Checkbox
          checked={onlySet}
          onCheckedChange={setOnlySet}
          label={t`Only set`}
          className="text-label"
        />
        <div className="flex-1" />
        <span className="font-mono text-label text-dim tabular">
          <Trans>
            {set} of {total} set
          </Trans>
        </span>
      </div>

      {declared.length === 0 ? (
        <p className="rounded-md border border-dashed border-edge-strong px-3 py-4 text-center text-data text-dim">
          <Trans>This binary declared no options.</Trans>
        </p>
      ) : null}

      <ul className="flex flex-col">
        {orphans.map((name) => (
          <li
            key={name}
            className="flex items-center gap-3 border-b border-hairline py-2 last:border-b-0"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-mono text-data text-blunder">{name}</span>
              <span className="text-label text-blunder">
                {errors[name] ?? t`this engine does not declare that option`}
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t`Remove ${name}`}
              title={t`Remove ${name}`}
              onClick={() => update(name, '')}
            >
              <RotateCcw className="size-3.5" aria-hidden />
            </Button>
          </li>
        ))}

        {rows.map((option) => {
          const value = draft.values[option.name] ?? ''
          const problem = errors[option.name]
          const optionName = option.name
          const optionDefault = option.default
          return (
            <li
              key={option.name}
              className="flex items-center gap-3 border-b border-hairline py-2 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={cn(
                    'truncate font-mono text-data',
                    isEditable(option) ? 'text-body' : 'text-dim',
                  )}
                >
                  {option.name}
                </span>
                <span className="flex items-center gap-2 text-label text-faint">
                  <span className="uppercase">{option.type}</span>
                  {range(option) ? <span className="font-mono tabular">{range(option)}</span> : null}
                  {optionDefault ? (
                    <span className="truncate font-mono">{t`default ${optionDefault}`}</span>
                  ) : null}
                </span>
              </div>
              {problem ? (
                <span className="max-w-[22ch] text-right text-label text-blunder">{problem}</span>
              ) : null}
              <Field
                option={option}
                value={value}
                invalid={problem !== undefined}
                onChange={(next) => update(option.name, next)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t`Reset ${optionName}`}
                title={value === '' ? t`Already the engine's default` : t`Reset ${optionName}`}
                disabled={value === ''}
                onClick={() => update(option.name, '')}
              >
                <RotateCcw className="size-3.5" aria-hidden />
              </Button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

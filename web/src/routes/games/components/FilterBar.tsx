/**
 * Design 2b's filter bar: the free-text box and one chip per filter group. Every chip writes
 * straight into the page's `LibraryFilters`, which the page mirrors into the URL.
 */
import type { I18n, MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { useEffect, useRef, useState } from 'react'

import { Input } from '@/components/ui/input'
import type { Color, Whose } from '@/lib/api/types'
import { cn } from '@/lib/utils'

import {
  clearGroup,
  FILTER_GROUPS,
  FILTER_OPTIONS,
  filterCount,
  GROUP_LABELS,
  groupSummary,
  prune,
  SPEED_WORDS,
  type FilterGroup,
  type LibraryFilters,
} from '../filters'
import { OUTCOME_LABELS, SOURCE_LABELS } from '../format'
import { MAX_LABEL_LENGTH, saveFilter, suggestLabel } from '../savedFilters'
import { FilterPopover, OptionRow, PopoverLabel, TriState } from './FilterPopover'

export interface FilterBarProps {
  filters: LibraryFilters
  onChange: (next: LibraryFilters) => void
}

/**
 * Presets for the date popover, in days back from today. The labels are as short as the
 * four buttons they sit on, so each carries a comment saying what the letter stands for.
 */
const DATE_PRESETS: { label: MessageDescriptor; days: number }[] = [
  { label: msg({ message: '7d', comment: 'Date preset button: the last 7 days' }), days: 7 },
  { label: msg({ message: '30d', comment: 'Date preset button: the last 30 days' }), days: 30 },
  { label: msg({ message: '90d', comment: 'Date preset button: the last 90 days' }), days: 90 },
  { label: msg({ message: '12m', comment: 'Date preset button: the last 12 months' }), days: 365 },
]

/** The two sides, title-cased the way the popover sets its options. */
const COLOR_LABELS: Record<Color, MessageDescriptor> = { white: msg`White`, black: msg`Black` }

function isoDay(offsetDays: number): string {
  const date = new Date()
  date.setDate(date.getDate() - offsetDays)
  return date.toISOString().slice(0, 10)
}

export function FilterBar({ filters, onChange }: FilterBarProps) {
  const { i18n } = useLingui()
  const patch = (next: Partial<LibraryFilters>) => onChange(prune({ ...filters, ...next }))

  return (
    // `max-md:relative` is what a `FilterPopover` anchors its panel to on a phone; see the
    // comment there. The chips already wrap, which is all a narrow bar needs of them.
    <div className="flex flex-wrap items-center gap-[0.4375rem] max-md:relative">
      {/* In front of the chips rather than among them, because it is not a filter that
          narrows one cut of the library: it decides which library — the owner's own games
          (the default, and the only ones any statistic counts), the games added from the
          reference books, or both together. The same segmented control the explorer uses
          for its source, since it answers the same kind of question. */}
      <WhoseToggle
        value={filters.whose ?? 'mine'}
        onChange={(whose) => patch({ whose: whose === 'mine' ? undefined : whose })}
      />

      {FILTER_GROUPS.map((group) => (
        <FilterPopover
          key={group}
          label={i18n._(GROUP_LABELS[group])}
          value={groupSummary(group, filters)}
          onClear={() => onChange(clearGroup(filters, group))}
          width={group === 'date' ? '15.625rem' : '14.5rem'}
        >
          {() => <GroupPanel group={group} filters={filters} patch={patch} />}
        </FilterPopover>
      ))}

      <SaveFilter filters={filters} />
    </div>
  )
}

const WHOSE_OPTIONS: { label: MessageDescriptor; value: Whose; title: MessageDescriptor }[] = [
  {
    label: msg`Mine`,
    value: 'mine',
    title: msg`Your own games — the ones every statistic counts`,
  },
  { label: msg`Others`, value: 'others', title: msg`Games added from the reference books` },
  { label: msg`All`, value: 'all', title: msg`Both together` },
]

function WhoseToggle({ value, onChange }: { value: Whose; onChange: (whose: Whose) => void }) {
  const { t, i18n } = useLingui()
  return (
    <div
      role="group"
      aria-label={t`Whose games`}
      className="flex overflow-hidden rounded-md border border-edge bg-elevated font-mono text-[0.71875rem]"
    >
      {WHOSE_OPTIONS.map((option, index) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          title={i18n._(option.title)}
          onClick={() => onChange(option.value)}
          className={cn(
            'px-2.5 py-1 transition-colors',
            index > 0 && 'border-l border-edge',
            value === option.value ? 'bg-selected text-ink' : 'text-dim hover:text-ink',
          )}
        >
          {i18n._(option.label)}
        </button>
      ))}
    </div>
  )
}

/**
 * Design 2b's `Save filter`, sitting where the mock puts it: after the chips, before the
 * spacer. It names the current cut and adds it to the sidebar's "Saved filters" rail
 * (`../savedFilters`). Nothing to save is not an error — with no filter set there is no
 * cut, so the link says so rather than pretending.
 */
function SaveFilter({ filters }: { filters: LibraryFilters }) {
  const { t } = useLingui()
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const host = useRef<HTMLDivElement>(null)
  const active = filterCount(filters) > 0

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (host.current && !host.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function commit() {
    if (saveFilter(label, filters)) setOpen(false)
  }

  return (
    <div ref={host} className="relative max-md:static">
      <button
        type="button"
        disabled={!active}
        aria-expanded={open}
        title={
          active
            ? t`Keep this cut of the library in the sidebar`
            : t`Set a filter first — there is nothing to save yet`
        }
        onClick={() => {
          setLabel(suggestLabel(filters))
          setOpen((current) => !current)
        }}
        className="px-1 text-[0.71875rem] text-accent-teal transition-colors hover:text-accent-link disabled:cursor-not-allowed disabled:text-faint"
      >
        <Trans>Save filter</Trans>
      </button>
      {open ? (
        // Anchored to the bar rather than to the chip below `md`, like every other panel
        // on this bar — this one sits at its right-hand end, where a 250px panel has the
        // least room of all.
        <div className="absolute top-[calc(100%+0.375rem)] left-0 z-30 flex flex-col gap-2.5 rounded-lg border border-edge bg-elevated p-2.5 shadow-[0_1.125rem_2.5rem_-1.125rem_var(--bb-shadow)] md:w-[15.625rem] max-md:right-0">
          <PopoverLabel>
            <Trans>Save this cut as</Trans>
          </PopoverLabel>
          <Input
            autoFocus
            aria-label={t`Filter name`}
            value={label}
            maxLength={MAX_LABEL_LENGTH}
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit()
            }}
            className="h-7 text-[0.71875rem]"
          />
          <button
            type="button"
            disabled={label.trim() === ''}
            onClick={commit}
            className="rounded-md bg-accent-teal px-2.5 py-1.5 text-[0.71875rem] font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            <Trans context="button">Save</Trans>
          </button>
        </div>
      ) : null}
    </div>
  )
}

function GroupPanel({
  group,
  filters,
  patch,
}: {
  group: FilterGroup
  filters: LibraryFilters
  patch: (next: Partial<LibraryFilters>) => void
}) {
  const { t, i18n } = useLingui()
  switch (group) {
    case 'date':
      return (
        <>
          <PopoverLabel>
            <Trans>Played between</Trans>
          </PopoverLabel>
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              aria-label={t`Played from`}
              value={filters.since ?? ''}
              onChange={(event) => patch({ since: event.target.value || undefined })}
              className="h-7 text-[0.71875rem]"
            />
            <span className="text-faint">→</span>
            <Input
              type="date"
              aria-label={t`Played until`}
              value={filters.until ?? ''}
              onChange={(event) => patch({ until: event.target.value || undefined })}
              className="h-7 text-[0.71875rem]"
            />
          </div>
          <div className="flex gap-1">
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.days}
                type="button"
                onClick={() => patch({ since: isoDay(preset.days), until: undefined })}
                className="flex-1 rounded-sm border border-edge bg-raised px-2 py-1 text-[0.71875rem] text-soft hover:border-edge-hover hover:text-ink"
              >
                {i18n._(preset.label)}
              </button>
            ))}
          </div>
        </>
      )

    case 'source':
      return (
        <>
          <PopoverLabel>
            <Trans>Imported from</Trans>
          </PopoverLabel>
          <OptionRow
            options={FILTER_OPTIONS.sources}
            value={filters.source}
            onChange={(source) => patch({ source })}
            labels={SOURCE_LABELS}
          />
        </>
      )

    case 'color':
      return (
        <>
          <PopoverLabel>
            <Trans>You played</Trans>
          </PopoverLabel>
          <OptionRow
            options={FILTER_OPTIONS.colors}
            value={filters.color}
            onChange={(color) => patch({ color })}
            labels={resolve(i18n, COLOR_LABELS)}
          />
        </>
      )

    case 'result':
      return (
        <>
          <PopoverLabel>
            <Trans>Your result</Trans>
          </PopoverLabel>
          <OptionRow
            options={FILTER_OPTIONS.outcomes}
            value={filters.outcome}
            onChange={(outcome) => patch({ outcome })}
            labels={resolve(i18n, OUTCOME_LABELS)}
          />
          <PopoverLabel>
            <Trans>PGN result</Trans>
          </PopoverLabel>
          <OptionRow
            options={FILTER_OPTIONS.results}
            value={filters.result}
            onChange={(result) => patch({ result })}
            labels={{ '1-0': '1–0', '0-1': '0–1', '1/2-1/2': '½–½' }}
          />
        </>
      )

    case 'opening':
      return (
        <>
          <PopoverLabel>
            <Trans>ECO code or prefix</Trans>
          </PopoverLabel>
          <Input
            aria-label={t`ECO code`}
            placeholder={t`B22, or just C6`}
            value={filters.eco ?? ''}
            onChange={(event) => patch({ eco: event.target.value.toUpperCase() || undefined })}
            className="h-7 font-mono text-[0.71875rem]"
          />
          <span className="text-[0.6875rem] leading-snug text-dim">
            <Trans>
              A prefix matches the whole family — <span className="font-mono">C6</span> is every
              Caro-Kann from C60 to C69.
            </Trans>
          </span>
        </>
      )

    case 'time':
      return (
        <>
          <PopoverLabel>
            <Trans>Speed</Trans>
          </PopoverLabel>
          <OptionRow
            options={FILTER_OPTIONS.speeds}
            value={filters.speed}
            onChange={(speed) => patch({ speed })}
            labels={resolve(i18n, SPEED_WORDS)}
          />
          <PopoverLabel>
            <Trans>Exact clock</Trans>
          </PopoverLabel>
          <Input
            aria-label={t`Time control`}
            placeholder="600+0"
            value={filters.time_control ?? ''}
            onChange={(event) => patch({ time_control: event.target.value || undefined })}
            className="h-7 font-mono text-[0.71875rem]"
          />
        </>
      )

    case 'opponent':
      return (
        <>
          <PopoverLabel>
            <Trans>Opponent</Trans>
          </PopoverLabel>
          <DebouncedInput
            aria-label={t`Opponent`}
            placeholder={t`Part of a name`}
            value={filters.opponent ?? ''}
            onCommit={(value) => patch({ opponent: value || undefined })}
          />
        </>
      )

    case 'analysis':
      return (
        <>
          <PopoverLabel>
            <Trans>Contains a blunder</Trans>
          </PopoverLabel>
          <TriState
            value={filters.has_blunders}
            onChange={(has_blunders) => patch({ has_blunders })}
          />
          <PopoverLabel>
            <Trans>Any analysis done</Trans>
          </PopoverLabel>
          <TriState
            value={filters.analyzed}
            onChange={(analyzed) => patch({ analyzed })}
            yes={t`Analysed`}
            no={t`Unanalysed`}
          />
          <PopoverLabel>
            <Trans>Deep pass done</Trans>
          </PopoverLabel>
          <TriState
            value={filters.deep_analyzed}
            onChange={(deep_analyzed) => patch({ deep_analyzed })}
          />
        </>
      )
  }
}

/**
 * An option table as `OptionRow` takes it. The tables are messages so a language switch
 * reaches them; the row wants the words, so they are resolved on the way in.
 */
function resolve<T extends string>(
  i18n: I18n,
  labels: Record<T, MessageDescriptor>,
): Record<T, string> {
  const out = {} as Record<T, string>
  for (const key of Object.keys(labels) as T[]) out[key] = i18n._(labels[key])
  return out
}

/**
 * A text input that only commits after the typing stops, so every keystroke is not a
 * request. Used for the two free-text filters.
 */
export function DebouncedInput({
  value,
  onCommit,
  delay = 300,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'> & {
  value: string
  onCommit: (value: string) => void
  delay?: number
}) {
  const [draft, setDraft] = useState(value)

  // A filter cleared from outside (the × on the chip, "clear all") has to reach the box.
  useEffect(() => setDraft(value), [value])

  useEffect(() => {
    if (draft === value) return
    const timer = setTimeout(() => onCommit(draft.trim()), delay)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, delay])

  return (
    <Input
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      className={cn('h-7 text-[0.71875rem]', props.className)}
    />
  )
}

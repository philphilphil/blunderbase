/**
 * Design 2b's filter bar: the free-text box and one chip per filter group. Every chip writes
 * straight into the page's `LibraryFilters`, which the page mirrors into the URL.
 */
import { useEffect, useRef, useState } from 'react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import {
  clearGroup,
  FILTER_GROUPS,
  FILTER_OPTIONS,
  filterCount,
  GROUP_LABELS,
  groupSummary,
  prune,
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

/** Presets for the date popover, in days back from today. */
const DATE_PRESETS: { label: string; days: number }[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '12m', days: 365 },
]

function isoDay(offsetDays: number): string {
  const date = new Date()
  date.setDate(date.getDate() - offsetDays)
  return date.toISOString().slice(0, 10)
}

export function FilterBar({ filters, onChange }: FilterBarProps) {
  const patch = (next: Partial<LibraryFilters>) => onChange(prune({ ...filters, ...next }))

  return (
    // `max-md:relative` is what a `FilterPopover` anchors its panel to on a phone; see the
    // comment there. The chips already wrap, which is all a narrow bar needs of them.
    <div className="flex flex-wrap items-center gap-[0.4375rem] max-md:relative">
      {FILTER_GROUPS.map((group) => (
        <FilterPopover
          key={group}
          label={GROUP_LABELS[group]}
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

/**
 * Design 2b's `Save filter`, sitting where the mock puts it: after the chips, before the
 * spacer. It names the current cut and adds it to the sidebar's "Saved filters" rail
 * (`../savedFilters`). Nothing to save is not an error — with no filter set there is no
 * cut, so the link says so rather than pretending.
 */
function SaveFilter({ filters }: { filters: LibraryFilters }) {
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
            ? 'Keep this cut of the library in the sidebar'
            : 'Set a filter first — there is nothing to save yet'
        }
        onClick={() => {
          setLabel(suggestLabel(filters))
          setOpen((current) => !current)
        }}
        className="px-1 text-[0.71875rem] text-accent-teal transition-colors hover:text-accent-link disabled:cursor-not-allowed disabled:text-faint"
      >
        Save filter
      </button>
      {open ? (
        // Anchored to the bar rather than to the chip below `md`, like every other panel
        // on this bar — this one sits at its right-hand end, where a 250px panel has the
        // least room of all.
        <div className="absolute top-[calc(100%+0.375rem)] left-0 z-30 flex flex-col gap-2.5 rounded-lg border border-edge bg-elevated p-2.5 shadow-[0_1.125rem_2.5rem_-1.125rem_var(--bb-shadow)] md:w-[15.625rem] max-md:right-0">
          <PopoverLabel>Save this cut as</PopoverLabel>
          <Input
            autoFocus
            aria-label="Filter name"
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
            Save
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
  switch (group) {
    case 'date':
      return (
        <>
          <PopoverLabel>Played between</PopoverLabel>
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              aria-label="Played from"
              value={filters.since ?? ''}
              onChange={(event) => patch({ since: event.target.value || undefined })}
              className="h-7 text-[0.71875rem]"
            />
            <span className="text-faint">→</span>
            <Input
              type="date"
              aria-label="Played until"
              value={filters.until ?? ''}
              onChange={(event) => patch({ until: event.target.value || undefined })}
              className="h-7 text-[0.71875rem]"
            />
          </div>
          <div className="flex gap-1">
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => patch({ since: isoDay(preset.days), until: undefined })}
                className="flex-1 rounded-sm border border-edge bg-raised px-2 py-1 text-[0.71875rem] text-soft hover:border-edge-hover hover:text-ink"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </>
      )

    case 'source':
      return (
        <>
          <PopoverLabel>Imported from</PopoverLabel>
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
          <PopoverLabel>You played</PopoverLabel>
          <OptionRow
            options={FILTER_OPTIONS.colors}
            value={filters.color}
            onChange={(color) => patch({ color })}
            labels={{ white: 'White', black: 'Black' }}
          />
        </>
      )

    case 'result':
      return (
        <>
          <PopoverLabel>Your result</PopoverLabel>
          <OptionRow
            options={FILTER_OPTIONS.outcomes}
            value={filters.outcome}
            onChange={(outcome) => patch({ outcome })}
            labels={OUTCOME_LABELS}
          />
          <PopoverLabel>PGN result</PopoverLabel>
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
          <PopoverLabel>ECO code or prefix</PopoverLabel>
          <Input
            aria-label="ECO code"
            placeholder="B22, or just C6"
            value={filters.eco ?? ''}
            onChange={(event) => patch({ eco: event.target.value.toUpperCase() || undefined })}
            className="h-7 font-mono text-[0.71875rem]"
          />
          <span className="text-[0.6875rem] leading-snug text-dim">
            A prefix matches the whole family — <span className="font-mono">C6</span> is every
            Caro-Kann from C60 to C69.
          </span>
        </>
      )

    case 'time':
      return (
        <>
          <PopoverLabel>Speed</PopoverLabel>
          <OptionRow
            options={FILTER_OPTIONS.speeds}
            value={filters.speed}
            onChange={(speed) => patch({ speed })}
          />
          <PopoverLabel>Exact clock</PopoverLabel>
          <Input
            aria-label="Time control"
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
          <PopoverLabel>Opponent</PopoverLabel>
          <DebouncedInput
            aria-label="Opponent"
            placeholder="Part of a name"
            value={filters.opponent ?? ''}
            onCommit={(value) => patch({ opponent: value || undefined })}
          />
        </>
      )

    case 'analysis':
      return (
        <>
          <PopoverLabel>Contains a blunder</PopoverLabel>
          <TriState
            value={filters.has_blunders}
            onChange={(has_blunders) => patch({ has_blunders })}
          />
          <PopoverLabel>Deep pass done</PopoverLabel>
          <TriState
            value={filters.deep_analyzed}
            onChange={(deep_analyzed) => patch({ deep_analyzed })}
          />
        </>
      )
  }
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

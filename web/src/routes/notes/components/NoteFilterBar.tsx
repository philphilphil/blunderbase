/**
 * The chips over the notes list, in the library's own idiom — the same popover, the same
 * chip states (`routes/games/components/FilterPopover`), so the two screens filter the
 * same way rather than each inventing a control.
 *
 * The free-text box sits outside the chips because it is what the screen is usually used
 * with: a note is prose, and prose is searched, not faceted.
 */
import { Input } from '@/components/ui/input'
import { useNoteTags } from '@/lib/api/queries'
import { NOTE_SCOPES } from '@/lib/api/types'
import { DebouncedInput } from '@/routes/games/components/FilterBar'
import {
  FilterPopover,
  OptionRow,
  PopoverLabel,
} from '@/routes/games/components/FilterPopover'

import {
  clearGroup,
  filterCount,
  GROUP_LABELS,
  groupSummary,
  NOTE_FILTER_GROUPS,
  prune,
  SCOPE_LABELS,
  toggleTag,
  type NoteFilterGroup,
  type NoteFilters,
} from '../filters'

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

export interface NoteFilterBarProps {
  filters: NoteFilters
  onChange: (next: NoteFilters) => void
}

export function NoteFilterBar({ filters, onChange }: NoteFilterBarProps) {
  const active = filterCount(filters)
  const patch = (next: Partial<NoteFilters>) => onChange(prune({ ...filters, ...next }))

  return (
    <div className="flex flex-wrap items-center gap-[0.4375rem]">
      <DebouncedInput
        aria-label="Search the notes"
        placeholder="Search what you wrote…"
        value={filters.text ?? ''}
        onCommit={(value) => patch({ text: value || undefined })}
        className="h-7 w-[16rem] text-[0.71875rem]"
      />

      {NOTE_FILTER_GROUPS.map((group) => (
        <FilterPopover
          key={group}
          label={GROUP_LABELS[group]}
          value={groupSummary(group, filters)}
          onClear={() => onChange(clearGroup(filters, group))}
          width={group === 'date' ? '15.625rem' : '14.5rem'}
        >
          {() => <GroupPanel group={group} filters={filters} patch={patch} onChange={onChange} />}
        </FilterPopover>
      ))}

      {active > 0 ? (
        <button
          type="button"
          onClick={() => onChange({})}
          className="px-1 text-[0.71875rem] text-accent-teal transition-colors hover:text-accent-link"
        >
          Clear {active}
        </button>
      ) : null}
    </div>
  )
}

function GroupPanel({
  group,
  filters,
  patch,
  onChange,
}: {
  group: NoteFilterGroup
  filters: NoteFilters
  patch: (next: Partial<NoteFilters>) => void
  onChange: (next: NoteFilters) => void
}) {
  switch (group) {
    case 'tags':
      return <TagPanel filters={filters} onChange={onChange} />

    case 'scope':
      return (
        <>
          <PopoverLabel>The note is about</PopoverLabel>
          <OptionRow
            options={NOTE_SCOPES}
            value={filters.scope}
            onChange={(scope) => patch({ scope })}
            labels={SCOPE_LABELS}
          />
          <span className="text-[0.6875rem] leading-snug text-dim">
            A variation note is pinned to a line off a game; a loose note is pinned to
            nothing at all.
          </span>
        </>
      )

    case 'game':
      return (
        <>
          <PopoverLabel>Game id</PopoverLabel>
          <Input
            type="number"
            min={1}
            aria-label="Game id"
            placeholder="e.g. 412"
            value={filters.game_id ?? ''}
            onChange={(event) => {
              const parsed = Number(event.target.value)
              patch({ game_id: Number.isInteger(parsed) && parsed > 0 ? parsed : undefined })
            }}
            className="h-7 font-mono text-[0.71875rem]"
          />
          <span className="text-[0.6875rem] leading-snug text-dim">
            Usually arrived at by following a note into its game and back — the id is the
            one in the game's address.
          </span>
        </>
      )

    case 'date':
      return (
        <>
          <PopoverLabel>Written between</PopoverLabel>
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              aria-label="Written from"
              value={filters.since ?? ''}
              onChange={(event) => patch({ since: event.target.value || undefined })}
              className="h-7 text-[0.71875rem]"
            />
            <span className="text-faint">→</span>
            <Input
              type="date"
              aria-label="Written until"
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
  }
}

/** Every tag in use, with its count, as a checklist. */
function TagPanel({
  filters,
  onChange,
}: {
  filters: NoteFilters
  onChange: (next: NoteFilters) => void
}) {
  const tags = useNoteTags()
  const chosen = filters.tags ?? []
  const rows = tags.data ?? []

  return (
    <>
      <PopoverLabel>Carrying every tag</PopoverLabel>
      {rows.length === 0 ? (
        <span className="text-[0.6875rem] text-dim">
          {tags.isPending ? 'Reading the tags…' : 'Nothing is tagged yet.'}
        </span>
      ) : (
        <div className="flex max-h-[13rem] flex-col gap-0.5 overflow-y-auto">
          {rows.map((row) => {
            const on = chosen.includes(row.tag)
            return (
              <button
                key={row.tag}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(toggleTag(filters, row.tag))}
                className={`flex items-center gap-2 rounded-sm px-1.5 py-1 text-[0.71875rem] transition-colors ${
                  on ? 'bg-accent-teal/10 text-accent-teal' : 'text-soft hover:bg-raised hover:text-ink'
                }`}
              >
                <span className="flex-1 truncate text-left">{row.tag}</span>
                <span className="font-mono text-[0.625rem] tabular text-dim-2">{row.notes}</span>
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}

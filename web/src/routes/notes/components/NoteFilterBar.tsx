/**
 * The chips over the notes list, in the library's own idiom — the same popover, the same
 * chip states (`routes/games/components/FilterPopover`), so the two screens filter the
 * same way rather than each inventing a control.
 *
 * The free-text box sits outside the chips because it is what the screen is usually used
 * with: a note is prose, and prose is searched, not faceted.
 */
import type { I18n, MessageDescriptor } from '@lingui/core'
import { Trans, useLingui } from '@lingui/react/macro'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useNoteTags } from '@/lib/api/queries'
import { NOTE_SCOPES, NOTE_SOURCES } from '@/lib/api/types'
import { presetOf, presetStart } from '@/lib/days'
import { DATE_PANEL_WIDTH, DateRangePanel } from '@/routes/games/components/DateRangePanel'
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
  OUTCOME_LABELS,
  OUTCOMES,
  prune,
  SCOPE_LABELS,
  SOURCE_LABELS,
  toggleTag,
  type NoteFilterGroup,
  type NoteFilters,
} from '../filters'

export interface NoteFilterBarProps {
  filters: NoteFilters
  onChange: (next: NoteFilters) => void
  /** The page places the bar in a row beside the view selector; this is its share of it. */
  className?: string
}

export function NoteFilterBar({ filters, onChange, className }: NoteFilterBarProps) {
  const { t, i18n } = useLingui()
  const active = filterCount(filters)
  const patch = (next: Partial<NoteFilters>) => onChange(prune({ ...filters, ...next }))

  return (
    // `max-md:relative` anchors the chips' panels to the bar instead of to the chip they
    // hang off, which is the only way a 250px panel stays on a 375px screen; see
    // `FilterPopover`. The box takes the whole first line there — prose is what this
    // screen is searched by, so it is the last thing to give up width.
    <div className={cn('flex flex-wrap items-center gap-[0.4375rem] max-md:relative', className)}>
      <DebouncedInput
        aria-label={t`Search the notes`}
        placeholder={t`Search what you wrote…`}
        value={filters.text ?? ''}
        onCommit={(value) => patch({ text: value || undefined })}
        className="h-7 w-[16rem] text-data max-md:w-full"
      />

      {NOTE_FILTER_GROUPS.map((group) => (
        <FilterPopover
          key={group}
          label={i18n._(GROUP_LABELS[group])}
          value={groupSummary(group, filters)}
          onClear={() => onChange(clearGroup(filters, group))}
          width={group === 'date' ? DATE_PANEL_WIDTH : '14.5rem'}
        >
          {(close) => (
            <GroupPanel
              group={group}
              filters={filters}
              patch={patch}
              onChange={onChange}
              close={close}
            />
          )}
        </FilterPopover>
      ))}

      {active > 0 ? (
        <Button variant="link" size="xs" onClick={() => onChange({})} className="px-1">
          <Trans>Clear {active}</Trans>
        </Button>
      ) : null}
    </div>
  )
}

function GroupPanel({
  group,
  filters,
  patch,
  onChange,
  close,
}: {
  group: NoteFilterGroup
  filters: NoteFilters
  patch: (next: Partial<NoteFilters>) => void
  onChange: (next: NoteFilters) => void
  /** Closes the popover, for the panels whose gestures finish the choice (the date's). */
  close: () => void
}) {
  const { t, i18n } = useLingui()
  switch (group) {
    case 'tags':
      return <TagPanel filters={filters} onChange={onChange} />

    case 'scope':
      return (
        <>
          <PopoverLabel>
            <Trans>The note is about</Trans>
          </PopoverLabel>
          <OptionRow
            options={NOTE_SCOPES}
            value={filters.scope}
            onChange={(scope) => patch({ scope })}
            labels={resolve(i18n, SCOPE_LABELS)}
          />
          <span className="text-label leading-snug text-dim">
            <Trans>
              A variation note is pinned to a line off a game; a loose note is pinned to
              nothing at all.
            </Trans>
          </span>
        </>
      )

    case 'opponent':
      return (
        <>
          <PopoverLabel>
            <Trans>Written on a game against</Trans>
          </PopoverLabel>
          <DebouncedInput
            aria-label={t`Opponent`}
            placeholder={t`Part of a name`}
            value={filters.opponent ?? ''}
            onCommit={(value) => patch({ opponent: value || undefined })}
            className="h-7 text-data"
          />
          <span className="text-label leading-snug text-dim">
            <Trans>
              Only notes written on a game, and a model game matches either player.
            </Trans>
          </span>
        </>
      )

    case 'outcome':
      return (
        <>
          <PopoverLabel>
            <Trans>How the game went</Trans>
          </PopoverLabel>
          <OptionRow
            options={OUTCOMES}
            value={filters.outcome}
            onChange={(outcome) => patch({ outcome })}
            labels={resolve(i18n, OUTCOME_LABELS)}
          />
        </>
      )

    case 'source':
      return (
        <>
          <PopoverLabel>
            <Trans>Who wrote it</Trans>
          </PopoverLabel>
          <OptionRow
            options={NOTE_SOURCES}
            value={filters.source}
            onChange={(source) => patch({ source })}
            labels={resolve(i18n, SOURCE_LABELS)}
          />
          <span className="text-label leading-snug text-dim">
            <Trans>
              In the app by you, by your assistant over MCP, or grabbed off the live board.
            </Trans>
          </span>
        </>
      )

    case 'game':
      return (
        <>
          <PopoverLabel>
            <Trans>Game id</Trans>
          </PopoverLabel>
          <Input
            type="number"
            min={1}
            aria-label={t`Game id`}
            placeholder={t`e.g. 412`}
            value={filters.game_id ?? ''}
            onChange={(event) => {
              const parsed = Number(event.target.value)
              patch({ game_id: Number.isInteger(parsed) && parsed > 0 ? parsed : undefined })
            }}
            className="h-7 font-mono text-data"
          />
          <span className="text-label leading-snug text-dim">
            <Trans>
              Usually arrived at by following a note into its game and back — the id is the
              one in the game's address.
            </Trans>
          </span>
        </>
      )

    case 'date':
      return (
        <DateRangePanel
          heading={<Trans>Written between</Trans>}
          from={filters.since}
          to={filters.until}
          preset={presetOf(filters.since, filters.until)}
          onRange={(since, until) => patch({ since, until })}
          onPreset={(preset) => patch({ since: presetStart(preset), until: undefined })}
          onClear={() => patch({ since: undefined, until: undefined })}
          close={close}
          fromLabel={t`Written from`}
          toLabel={t`Written until`}
        />
      )
  }
}

/**
 * A table of descriptors as the strings `OptionRow` draws — the row takes labels, it does
 * not know about catalogs.
 */
function resolve<T extends string>(
  i18n: I18n,
  labels: Record<T, MessageDescriptor>,
): Record<T, string> {
  const out = {} as Record<T, string>
  for (const key of Object.keys(labels) as T[]) out[key] = i18n._(labels[key])
  return out
}

/** Every tag in use, with its count, as a checklist. */
function TagPanel({
  filters,
  onChange,
}: {
  filters: NoteFilters
  onChange: (next: NoteFilters) => void
}) {
  const { t } = useLingui()
  const tags = useNoteTags()
  const chosen = filters.tags ?? []
  const rows = tags.data ?? []

  return (
    <>
      <PopoverLabel>
        <Trans>Carrying every tag</Trans>
      </PopoverLabel>
      {rows.length === 0 ? (
        <span className="text-label text-dim">
          {tags.isPending ? t`Reading the tags…` : t`Nothing is tagged yet.`}
        </span>
      ) : (
        <div className="flex max-h-[13rem] flex-col gap-0.5 overflow-y-auto">
          {rows.map((row) => {
            const on = chosen.includes(row.tag)
            return (
              <Button
                key={row.tag}
                variant="ghost"
                size="sm"
                aria-pressed={on}
                onClick={() => onChange(toggleTag(filters, row.tag))}
                className="justify-start gap-2 px-1.5 font-normal"
              >
                <span className="flex-1 truncate text-left">{row.tag}</span>
                <span className="font-mono text-meta tabular text-dim-2">{row.notes}</span>
              </Button>
            )
          })}
        </div>
      )}
    </>
  )
}

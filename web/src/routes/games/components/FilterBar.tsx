/**
 * Design 2b's filter bar: the free-text box and one chip per filter group. Every chip writes
 * straight into the page's `LibraryFilters`, which the page mirrors into the URL.
 *
 * Collection is one more chip rather than a control of its own: a collection's page is the
 * library under `?collection=`, so picking one here and clicking it in the rail land on the
 * same page, and every other chip narrows inside it the way it narrows the whole library.
 */
import type { I18n, MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { CollectionSwatch } from '@/components/collections/CollectionChip'
import { Input } from '@/components/ui/input'
import { useCollections } from '@/lib/api/queries'
import type { Collection, Color, Whose } from '@/lib/api/types'
import { collectionPath, ruleFromFilters } from '@/lib/collections'
import { cn } from '@/lib/utils'
import { Segmented } from '@/routes/stats/kit/states'

import {
  clearGroup,
  effectiveWhose,
  FILTER_GROUPS,
  FILTER_OPTIONS,
  filterCount,
  GROUP_LABELS,
  groupSummary,
  prune,
  RATED_WORDS,
  SPEED_WORDS,
  type CollectionNames,
  type FilterGroup,
  type LibraryFilters,
} from '../filters'
import { formatCount, OUTCOME_LABELS, SOURCE_LABELS } from '../format'
import { MAX_LABEL_LENGTH, saveFilter, suggestLabel } from '../savedFilters'
import { useCollectionNames } from '../useCollectionNames'
import { CollectionDialog } from './CollectionDialog'
import { FilterPopover, OptionButton, OptionRow, PopoverLabel, TriState } from './FilterPopover'

export interface FilterBarProps {
  filters: LibraryFilters
  onChange: (next: LibraryFilters) => void
  /** The page's own end of the row — its search box — pushed to the right edge. */
  trailing?: ReactNode
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

export function FilterBar({ filters, onChange, trailing }: FilterBarProps) {
  const { i18n } = useLingui()
  const patch = (next: Partial<LibraryFilters>) => onChange(prune({ ...filters, ...next }))
  const collectionName = useCollectionNames()

  return (
    // `max-md:relative` is what a `FilterPopover` anchors its panel to on a phone; see the
    // comment there. The chips already wrap, which is all a narrow bar needs of them.
    <div className="flex flex-wrap items-center gap-[0.4375rem] max-md:relative">
      {/* In front of the chips rather than among them, because it is not a filter that
          narrows one cut of the library: it decides which library — the owner's own games
          (the default, and the only ones any statistic counts), the games added from the
          reference books, or both together. The same segmented control the explorer uses
          for its source, since it answers the same kind of question. On a collection's page
          it starts on All (`defaultWhose`); `prune` drops whichever value is the default. */}
      <WhoseToggle value={effectiveWhose(filters)} onChange={(whose) => patch({ whose })} />

      {FILTER_GROUPS.map((group) => (
        <FilterPopover
          key={group}
          label={i18n._(GROUP_LABELS[group])}
          value={groupSummary(group, filters, collectionName)}
          onClear={() => onChange(clearGroup(filters, group))}
          width={group === 'date' ? '15.625rem' : group === 'collection' ? '15rem' : '14.5rem'}
        >
          {(close) =>
            group === 'collection' ? (
              <CollectionPanel
                value={filters.collection}
                onChange={(collection) => {
                  patch({ collection })
                  close()
                }}
              />
            ) : (
              <GroupPanel group={group} filters={filters} patch={patch} />
            )
          }
        </FilterPopover>
      ))}

      <SaveFilter filters={filters} collectionName={collectionName} />
      <MakeCollection filters={filters} />

      {trailing ? (
        <div className="ml-auto flex items-center gap-[0.4375rem] max-md:w-full">{trailing}</div>
      ) : null}
    </div>
  )
}

/**
 * The Collection chip's panel: one row per collection with its colour and its size, and a
 * click picks it — one at a time, since a game in two collections is found under either,
 * and "in this one and that one" is a cut nobody has asked for. Picking closes the panel,
 * because the page it lands on is a different page (the collection's own header comes up).
 */
function CollectionPanel({
  value,
  onChange,
}: {
  value: number | undefined
  onChange: (next: number | undefined) => void
}) {
  const collections = useCollections()
  const rows: Collection[] = collections.data?.collections ?? []
  return (
    <>
      <PopoverLabel>
        <Trans>In the collection</Trans>
      </PopoverLabel>
      {collections.isPending ? (
        <span className="text-[0.71875rem] text-dim">
          <Trans>Loading collections…</Trans>
        </span>
      ) : collections.isError ? (
        <span className="text-[0.71875rem] text-blunder">
          <Trans>Could not load the collections.</Trans>
        </span>
      ) : rows.length === 0 ? (
        <span className="text-[0.6875rem] leading-snug text-dim">
          <Trans>
            No collections yet. Select games and use Add to… under the table, or press + beside
            Collections in the sidebar.
          </Trans>
        </span>
      ) : (
        <div className="-mx-1 flex max-h-[16rem] flex-col overflow-y-auto">
          {rows.map((collection) => {
            const selected = value === collection.id
            return (
              <button
                key={collection.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange(selected ? undefined : collection.id)}
                className={cn(
                  'flex items-center gap-2 rounded-sm px-1.5 py-1 text-left text-[0.71875rem] transition-colors',
                  selected ? 'bg-accent-teal/10 text-accent-teal' : 'text-soft hover:bg-raised hover:text-ink',
                )}
              >
                <CollectionSwatch color={collection.color} />
                <span className="min-w-0 truncate">{collection.name}</span>
                <span className="ml-auto pl-3 font-mono text-[0.65625rem] text-faint">
                  {formatCount(collection.game_count)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}

/**
 * Design 5's "Make a collection", beside Save filter: the same cut, kept as a set of games
 * on the server rather than a query in this browser. The dialog opens with the rule taken
 * from the filter that is open — only the keys that describe a game as it arrives, so a date
 * range or "has blunders" is left behind — and with "Also add the games you already have"
 * ticked, since someone who filtered the library down to the league wants the league's
 * games in it now, not only the next ones.
 *
 * Only there when the filter has something a rule can hold. With nothing rule-able set the
 * sidebar's + and a selection's Add to… are the doors, and a link that opened an empty form
 * here would read as "these games" when it meant none of them. Saving goes to the new
 * collection's page, which is where its games and its score line are.
 */
function MakeCollection({ filters }: { filters: LibraryFilters }) {
  const { t } = useLingui()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const rule = ruleFromFilters(filters)
  if (!rule && !open) return null
  return (
    <>
      <button
        type="button"
        title={t`Keep the games this filter finds as a collection, and add new ones as they arrive`}
        onClick={() => setOpen(true)}
        className="px-1 text-label text-accent-teal transition-colors hover:text-accent-link"
      >
        <Trans>Make a collection</Trans>
      </button>
      {open ? (
        <CollectionDialog
          initialRule={rule}
          addExistingByDefault
          onClose={() => setOpen(false)}
          onSaved={(collection) => {
            setOpen(false)
            navigate(collectionPath(collection.id))
          }}
        />
      ) : null}
    </>
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

/**
 * Mine / Others / All, as the app's one `Segmented` — the control the explorer's own
 * source switch and the stats windows are — so it has the same height as the chips beside
 * it, the same sans label and the same selected blue, rather than a mono copy of its own.
 */
function WhoseToggle({ value, onChange }: { value: Whose; onChange: (whose: Whose) => void }) {
  const { t, i18n } = useLingui()
  return (
    <Segmented
      label={t`Whose games`}
      value={value}
      onChange={onChange}
      options={WHOSE_OPTIONS.map((option) => ({
        value: option.value,
        label: i18n._(option.label),
        title: i18n._(option.title),
      }))}
    />
  )
}

/**
 * Design 2b's `Save filter`, sitting where the mock puts it: after the chips, before the
 * spacer. It names the current cut and adds it to the sidebar's "Saved filters" rail
 * (`../savedFilters`). Nothing to save is not an error — with no filter set there is no
 * cut, so the link says so rather than pretending.
 */
function SaveFilter({
  filters,
  collectionName,
}: {
  filters: LibraryFilters
  collectionName: CollectionNames
}) {
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
          setLabel(suggestLabel(filters, collectionName))
          setOpen((current) => !current)
        }}
        className="px-1 text-label text-accent-teal transition-colors hover:text-accent-link disabled:cursor-not-allowed disabled:text-dim-2"
      >
        <Trans>Save filter</Trans>
      </button>
      {open ? (
        // Anchored to the bar rather than to the chip below `md`, like every other panel
        // on this bar — this one sits at its right-hand end, where a 250px panel has the
        // least room of all.
        <div className="bb-pop-in absolute top-[calc(100%+0.375rem)] left-0 z-30 flex flex-col gap-2.5 rounded-md border border-edge bg-elevated p-2.5 shadow-[0_1.125rem_2.5rem_-1.125rem_var(--bb-shadow)] md:w-[15.625rem] max-md:right-0">
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
            className="h-7 text-data"
          />
          <Button type="button" size="sm" disabled={label.trim() === ''} onClick={commit}>
            <Trans context="button">Save</Trans>
          </Button>
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
              className="h-7 text-data"
            />
            <span className="text-faint">→</span>
            <Input
              type="date"
              aria-label={t`Played until`}
              value={filters.until ?? ''}
              onChange={(event) => patch({ until: event.target.value || undefined })}
              className="h-7 text-data"
            />
          </div>
          <div className="flex gap-1">
            {DATE_PRESETS.map((preset) => (
              <OptionButton
                key={preset.days}
                onClick={() => patch({ since: isoDay(preset.days), until: undefined })}
                className="flex-1"
              >
                {i18n._(preset.label)}
              </OptionButton>
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
            className="h-7 font-mono text-data"
          />
          <span className="text-label text-dim">
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
            className="h-7 font-mono text-data"
          />
          {/* With the clock because that is how a league names its games — "rated 45+45" —
              and a casual 45+45 with a friend is exactly what it wants kept out. */}
          <PopoverLabel>
            <Trans>Rated</Trans>
          </PopoverLabel>
          <TriState
            value={filters.rated}
            onChange={(rated) => patch({ rated })}
            either={t`Either`}
            yes={i18n._(RATED_WORDS.rated)}
            no={i18n._(RATED_WORDS.casual)}
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
        </>
      )

    case 'collection':
      // Drawn by `CollectionPanel`, which needs the collections list and closes on a pick.
      return null
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
      className={cn('h-7 text-data', props.className)}
    />
  )
}

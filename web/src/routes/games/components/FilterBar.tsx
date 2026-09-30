/**
 * Design 2b's filter bar: one picker per filter group, then the commands that act on the
 * cut and the free-text box. Every picker writes straight into the page's `LibraryFilters`,
 * which the page mirrors into the URL.
 *
 * The row reads left to right as the control grammar has it (docs/design/README.md,
 * "Controls"): Mine / Others / All is a `Segmented` (one value of three, all on screen),
 * closed by a hairline rule because it decides *which* library rather than narrowing one;
 * every filter is a `PickerButton` (a value from a list, ⇅); and the right-hand cluster
 * holds the commands (Clear, Make a collection…, Save filter…) beside the text field they
 * save along with the pickers, so Save filter never wraps alone to the far left of row two.
 *
 * Collection is one more picker rather than a control of its own: the library under
 * `?collection=` is the same list, narrowed, so picking one here and opening a card on the
 * Collections screen land on the same table, and every other picker narrows inside it the
 * way it narrows the whole library.
 */
import type { I18n, MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { Bookmark, FolderPlus } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { CollectionSwatch } from '@/components/collections/CollectionChip'
import { Input, SearchInput } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { useCollections } from '@/lib/api/queries'
import type { Collection, Color, Whose } from '@/lib/api/types'
import { collectionPath, ruleFromFilters } from '@/lib/collections'
import { presetOf, presetStart } from '@/lib/days'

import {
  clearGroup,
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
import { DATE_PANEL_WIDTH, DateRangePanel } from './DateRangePanel'
import { FilterPopover, OptionRow, PopoverLabel, TriState } from './FilterPopover'

export interface FilterBarProps {
  filters: LibraryFilters
  onChange: (next: LibraryFilters) => void
  /** The page's own end of the row — its search box — pushed to the right edge. */
  trailing?: ReactNode
  /** The page's Clear button, first in the right-hand cluster while anything is set. */
  clear?: ReactNode
}

/** The two sides, title-cased the way the popover sets its options. */
const COLOR_LABELS: Record<Color, MessageDescriptor> = { white: msg`White`, black: msg`Black` }

export function FilterBar({ filters, onChange, trailing, clear }: FilterBarProps) {
  const { i18n } = useLingui()
  const patch = (next: Partial<LibraryFilters>) => onChange(prune({ ...filters, ...next }))
  const collectionName = useCollectionNames()

  return (
    // `max-md:relative` is what a `FilterPopover` anchors its panel to on a phone; see the
    // comment there. The pickers already wrap, which is all a narrow bar needs of them.
    <div className="flex flex-wrap items-center gap-2 max-md:relative">
      {/* In front of the pickers rather than among them, because it is not a filter that
          narrows one cut of the library: it decides which library — the owner's own games
          (the default, and the only ones any statistic counts), the games added from the
          reference books, or both together. The rule after it says so: a page-level view
          switch, then the filters. */}
      <WhoseToggle
        value={filters.whose ?? 'mine'}
        onChange={(whose) => patch({ whose: whose === 'mine' ? undefined : whose })}
      />
      <span aria-hidden className="mx-0.5 h-4 w-px flex-none bg-hairline" />

      {FILTER_GROUPS.map((group) => (
        <FilterPopover
          key={group}
          label={i18n._(GROUP_LABELS[group])}
          value={groupSummary(group, filters, collectionName)}
          onClear={() => onChange(clearGroup(filters, group))}
          width={
            group === 'date' ? DATE_PANEL_WIDTH : group === 'collection' ? '15rem' : '14.5rem'
          }
        >
          {(close) =>
            group === 'collection' ? (
              <CollectionPanel
                value={filters.collection}
                onChange={(collection) => {
                  // The panel counts every game in a collection, reference games too, so a
                  // pick shows all of them, as a collection's own links do; a Whose the
                  // owner set by hand is kept.
                  patch(
                    collection === undefined
                      ? { collection }
                      : { collection, whose: filters.whose ?? 'all' },
                  )
                  close()
                }}
              />
            ) : (
              <GroupPanel group={group} filters={filters} patch={patch} close={close} />
            )
          }
        </FilterPopover>
      ))}

      <div className="ml-auto flex flex-wrap items-center justify-end gap-2 max-md:w-full max-md:justify-start">
        {clear}
        <MakeCollection filters={filters} />
        <SaveFilter filters={filters} collectionName={collectionName} />
        {trailing}
      </div>
    </div>
  )
}

/**
 * The Collection chip's panel: one row per collection with its colour and its size, and a
 * click picks it — one at a time, since a game in two collections is found under either,
 * and "in this one and that one" is a cut nobody has asked for. Picking closes the panel,
 * as a pick that changes the whole table should: there is nothing left to set in it.
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
        <span className="text-data text-dim">
          <Trans>Loading collections…</Trans>
        </span>
      ) : collections.isError ? (
        <span className="text-data text-blunder">
          <Trans>Could not load the collections.</Trans>
        </span>
      ) : rows.length === 0 ? (
        <span className="text-label text-dim">
          <Trans>
            No collections yet. Select games and use Add to under the table, or start one on
            the Collections page.
          </Trans>
        </span>
      ) : (
        <div className="-mx-1 flex max-h-[16rem] flex-col overflow-y-auto">
          {rows.map((collection) => {
            const selected = value === collection.id
            return (
              <Button
                key={collection.id}
                variant="ghost"
                size="sm"
                aria-pressed={selected}
                onClick={() => onChange(selected ? undefined : collection.id)}
                className="justify-start gap-2 px-1.5 font-normal"
              >
                <CollectionSwatch color={collection.color} />
                <span className="min-w-0 truncate">{collection.name}</span>
                <span className="ml-auto pl-3 font-mono text-meta text-dim-2">
                  {formatCount(collection.game_count)}
                </span>
              </Button>
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
 * Collections screen's "New collection" and a selection's Add to… are the doors, and a link
 * that opened an empty form here would read as "these games" when it meant none of them.
 * Saving sets the Collection picker to the new collection, every game in it: the list is
 * then what was just kept, which is the proof the owner wants of what the rule caught.
 *
 * A command that opens a dialog, so a tool button whose label ends in "…" (it had been
 * accent text, which the control grammar keeps for links).
 */
function MakeCollection({ filters }: { filters: LibraryFilters }) {
  const { t } = useLingui()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const rule = ruleFromFilters(filters)
  if (!rule && !open) return null
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        title={t`Keep the games this filter finds as a collection, and add new ones as they arrive`}
        onClick={() => setOpen(true)}
      >
        <FolderPlus aria-hidden />
        <Trans>Make a collection…</Trans>
      </Button>
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
 * source switch and the stats windows are — so it has the same height as the pickers beside
 * it and the same raised thumb for the chosen value, and never reads as a filter set (it
 * does not turn blue: choosing which library is not narrowing one).
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
 * "Save filter…": names the current cut and adds it to the rail's Filters fold under Games
 * (`../savedFilters`). It sits in the row's right-hand cluster beside the text field, since
 * that is saved with the pickers.
 *
 * A command that asks something first, so a tool button with a `Bookmark` and a trailing
 * "…" rather than the accent text it was (accent text is a link). Nothing to save is not an
 * error: with no filter set there is no cut, so the button takes the one disabled look (no
 * face) and its title says why, rather than pretending or vanishing.
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
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={!active}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={
          active
            ? t`Keep this cut of the library in the sidebar`
            : t`Set a filter first — there is nothing to save yet`
        }
        onClick={() => {
          setLabel(suggestLabel(filters, collectionName))
          setOpen((current) => !current)
        }}
        className="aria-expanded:bg-raised aria-expanded:shadow-none"
      >
        <Bookmark aria-hidden />
        <Trans>Save filter…</Trans>
      </Button>
      {open ? (
        // Anchored to the button's right edge, since it sits near the bar's right end; to
        // the bar below `md`, like every other panel on this bar.
        <div className="bb-pop-in absolute top-[calc(100%+0.375rem)] right-0 z-30 flex flex-col gap-2.5 rounded-md border border-edge bg-elevated p-2.5 shadow-[0_1.125rem_2.5rem_-1.125rem_var(--bb-shadow)] md:w-[15.625rem] max-md:left-0">
          <PopoverLabel>
            <Trans>Save this cut as</Trans>
          </PopoverLabel>
          <Input
            autoFocus
            inputSize="sm"
            aria-label={t`Filter name`}
            value={label}
            maxLength={MAX_LABEL_LENGTH}
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit()
            }}
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
  close,
}: {
  group: FilterGroup
  filters: LibraryFilters
  patch: (next: Partial<LibraryFilters>) => void
  /** Closes the popover, for the panels whose gestures finish the choice (the date's). */
  close: () => void
}) {
  const { t, i18n } = useLingui()
  switch (group) {
    case 'date':
      return (
        <DateRangePanel
          heading={<Trans>Played between</Trans>}
          from={filters.since}
          to={filters.until}
          preset={presetOf(filters.since, filters.until)}
          onRange={(since, until) => patch({ since, until })}
          onPreset={(preset) => patch({ since: presetStart(preset), until: undefined })}
          onClear={() => patch({ since: undefined, until: undefined })}
          close={close}
          fromLabel={t`Played from`}
          toLabel={t`Played until`}
        />
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
            inputSize="sm"
            className="font-mono"
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
            inputSize="sm"
            className="font-mono"
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
 * request. Used for the free-text filters of Games and Notes, and the opponent fields in
 * their pickers.
 *
 * Drawn as a `SearchInput` (a sunk field with a leading magnifier), because every one of
 * them searches; the caller's placeholder scopes it ("Filter games: …", "Filter notes…") so
 * a page's box never reads as the rail's "Search everything". `className` goes on the input
 * and `wrapperClassName` sizes the whole field.
 */
export function DebouncedInput({
  value,
  onCommit,
  delay = 300,
  ...props
}: Omit<React.ComponentProps<typeof SearchInput>, 'value' | 'onChange'> & {
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
    <SearchInput
      inputSize="sm"
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
    />
  )
}

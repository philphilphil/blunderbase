/**
 * Make a collection, or change one: its name, its colour, a line about it, whether the rail
 * shows it, and the rule that fills it as games arrive.
 *
 * One dialog for every door — "Make a collection" beside Save filter (a rule taken from
 * the filter that was open), "+ New collection from these N…" in the Add to… checklist
 * (games put in by hand), and "New collection" and each card's Edit on the Collections
 * screen — so what a collection *is* is explained in one place.
 *
 * The rule is the library's own filter vocabulary, as native fields rather than the
 * filter bar's popovers: it is a form someone fills in once, not a cut they flick
 * between. What it does is said right under it, because it is the part people get wrong —
 * a rule only looks at games as they arrive, so the games already in the library are a
 * separate question, answered by the "Also add the N games you already have" box with the
 * count in front of it. And taking a game out by hand sticks, since nothing re-runs the
 * rule behind the owner's back.
 *
 * Delete lives here rather than on the card because it is rare and final, and it asks
 * first, saying the part that reassures: the games stay.
 *
 * Every control is the app's own (docs/design/README.md, "Controls"): the colour is a
 * `Segmented` of swatches (one of eight, all on screen), the rule is a `Switch` (a setting
 * that persists), its fields are sunk FIELDs (`Input`, `NativeSelect`, `Textarea`), the
 * speeds are chips that turn blue only once they narrow, the "Also add" box and "Show in
 * the rail" are the `Checkbox` (a choice saved with the form, not a live switch). The footer reads Delete… (red-outlined, apart on the left), then Cancel as the
 * tool button and the one filled primary, last.
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { Loader2, RotateCw, Trash2, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'

import { RuleChips } from '@/components/collections/RuleChips'
import { Field, Frame } from '@/components/engine-dialog/DialogFrame'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FilterChip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api/client'
import {
  useApplyCollectionRule,
  useCreateCollection,
  useDeleteCollection,
  useGames,
  useUpdateCollection,
} from '@/lib/api/queries'
import type {
  Collection,
  CollectionColor,
  CollectionRule,
  Color,
  Source,
  Speed,
} from '@/lib/api/types'
import {
  COLLECTION_COLOR_CLASSES,
  COLLECTION_COLOR_NAMES,
  COLLECTION_COLORS,
  isRuleEmpty,
  ruleFilters,
  ruleFromFilters,
} from '@/lib/collections'
import { cn } from '@/lib/utils'

import { FILTER_OPTIONS, SPEED_WORDS } from '../filters'
import { SOURCE_LABELS } from '../format'

/** The backend's `collections.name` column is 40 characters wide. */
export const COLLECTION_NAME_MAX = 40
/**
 * The rule's text fields, as wide as `CollectionRule` in `backend/api/schemas.py` lets
 * them be: past that, Save would be refused with a message that names no field.
 */
const RULE_CLOCK_MAX = 32
const RULE_ECO_MAX = 8
const RULE_OPPONENT_MAX = 128

/** A rule's selects: a dialog's fields are `default` height (h-8), as its inputs are. */
const SELECT_CLASS = 'h-8 w-full'

export interface CollectionDialogProps {
  /** The collection to edit. Left out, the dialog makes a new one. */
  collection?: Collection
  /** A new collection's starting rule — the filter "Make a collection" was pressed on. */
  initialRule?: CollectionRule | null
  /** Games to put in by hand as it is made — "New collection from these N". */
  gameIds?: readonly number[]
  /** Open with "Also add the N games you already have that match" ticked. */
  addExistingByDefault?: boolean
  onClose: () => void
  /** The collection as the server answered, after a create or a save. */
  onSaved?: (collection: Collection) => void
  /** After a delete, with the id that went. */
  onDeleted?: (id: number) => void
}

/** The rule's fields as the form holds them: strings, since that is what inputs speak. */
interface RuleDraft {
  source: Source | ''
  speed: Speed[]
  time_control: string
  rated: '' | 'true' | 'false'
  color: Color | ''
  eco: string
  opponent: string
  /** Not offered as a field (the library has no variant filter), but kept if a rule has one. */
  variant: string
}

function draftOf(rule: CollectionRule | null | undefined): RuleDraft {
  return {
    source: rule?.source ?? '',
    speed: rule?.speed ? [...rule.speed] : [],
    time_control: rule?.time_control ?? '',
    rated: typeof rule?.rated === 'boolean' ? (String(rule.rated) as 'true' | 'false') : '',
    color: rule?.color ?? '',
    eco: rule?.eco ?? '',
    opponent: rule?.opponent ?? '',
    variant: rule?.variant ?? '',
  }
}

function ruleOf(draft: RuleDraft): CollectionRule | null {
  return ruleFromFilters({
    source: draft.source || undefined,
    speed: draft.speed,
    time_control: draft.time_control,
    rated: draft.rated === '' ? undefined : draft.rated === 'true',
    color: draft.color || undefined,
    eco: draft.eco,
    opponent: draft.opponent,
    variant: draft.variant,
  })
}

/** The value, once it has held still for a moment — typing a name is not seven counts. */
function useSettled<T>(value: T, delay = 300): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return settled
}

export function CollectionDialog({
  collection,
  initialRule,
  gameIds,
  addExistingByDefault = false,
  onClose,
  onSaved,
  onDeleted,
}: CollectionDialogProps) {
  const { t, i18n } = useLingui()
  const titleId = useId()
  const nameId = useId()
  const descriptionId = useId()
  const editing = collection !== undefined
  const startRule = editing ? collection.rule : initialRule

  const [name, setName] = useState(collection?.name ?? '')
  const [color, setColor] = useState<CollectionColor>(collection?.color ?? 'accent')
  const [description, setDescription] = useState(collection?.description ?? '')
  const [pinned, setPinned] = useState(collection?.pinned ?? false)
  const [ruleOn, setRuleOn] = useState(!isRuleEmpty(startRule))
  const [draft, setDraft] = useState<RuleDraft>(() => draftOf(startRule))
  const [addExisting, setAddExisting] = useState(addExistingByDefault)
  const [nameError, setNameError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const create = useCreateCollection()
  const update = useUpdateCollection()
  const applyRule = useApplyCollectionRule()
  const remove = useDeleteCollection()
  const pending = create.isPending || update.isPending || applyRule.isPending
  const handIn = gameIds?.length ?? 0

  const rule = useMemo(() => (ruleOn ? ruleOf(draft) : null), [ruleOn, draft])
  const settledRule = useSettled(rule)
  const counting = settledRule !== null
  // The count is the library's own list at one row, so it is the same number the Games
  // screen would show for this filter — not a second definition of "matches".
  const matching = useGames(
    { ...(settledRule ? ruleFilters(settledRule) : {}), limit: 1 },
    { enabled: counting },
  )
  // Editing, the box can only add what is not in the collection yet, so it counts that:
  // the matches minus the matches already in it (which is also what a game taken out by
  // hand and brought back by the box is counted as). Two counts of the one list rather
  // than a "not in this collection" filter the library has no other use for.
  const matchingInside = useGames(
    {
      ...(settledRule ? ruleFilters(settledRule) : {}),
      ...(editing ? { collection: collection.id } : {}),
      limit: 1,
    },
    { enabled: counting && editing },
  )
  const settledNow = counting && JSON.stringify(settledRule) === JSON.stringify(rule)
  const total = settledNow ? matching.data?.total : undefined
  const inside = editing ? (settledNow ? matchingInside.data?.total : undefined) : 0
  const matchCount =
    total === undefined || inside === undefined ? undefined : Math.max(0, total - inside)
  // A count that failed says so, with a way to ask again, rather than counting for ever.
  // The box and Save do not depend on it: the server adds what matches either way.
  const countFailed =
    settledNow && matchCount === undefined && (matching.isError || (editing && matchingInside.isError))
  // The rule as the form started, spelled the way `rule` is, so a save that did not touch
  // it can leave it out: a rename must not re-send a rule the owner never looked at, which
  // would undo a change made meanwhile in another tab and restamp when the rule was set.
  const startRuleKey = useMemo(
    () => JSON.stringify(isRuleEmpty(startRule) ? null : ruleOf(draftOf(startRule))),
    [startRule],
  )

  function patchDraft(next: Partial<RuleDraft>) {
    setDraft((current) => ({ ...current, ...next }))
  }

  function toggleSpeed(speed: Speed) {
    setDraft((current) => ({
      ...current,
      speed: current.speed.includes(speed)
        ? current.speed.filter((each) => each !== speed)
        : FILTER_OPTIONS.speeds.filter((each) => each === speed || current.speed.includes(each)),
    }))
  }

  function failed(cause: unknown) {
    if (cause instanceof ApiError && cause.error === 'name_taken') {
      setNameError(t`There is already a collection with that name.`)
      return
    }
    setError(cause instanceof Error ? cause.message : t`Could not save the collection.`)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError(t`Give it a name.`)
      return
    }
    setNameError(null)
    setError(null)
    // Whatever the count says, or whether it has arrived: a save pressed while the dialog
    // is still counting must not quietly drop a ticked box (and "Make a collection" opens
    // with it ticked before any count is on screen). The server adds what matches, which
    // may be nothing.
    const withExisting = rule !== null && addExisting
    try {
      let saved: Collection
      if (editing) {
        saved = await update.mutateAsync({
          id: collection.id,
          body: {
            name: trimmed,
            color,
            description: description.trim() || null,
            pinned,
            ...(JSON.stringify(rule) === startRuleKey ? {} : { rule }),
          },
        })
        if (withExisting) saved = (await applyRule.mutateAsync(collection.id)).collection
      } else {
        saved = await create.mutateAsync({
          name: trimmed,
          color,
          description: description.trim() || null,
          pinned,
          rule,
          apply_to_existing: withExisting,
          ...(handIn ? { game_ids: [...(gameIds ?? [])] } : {}),
        })
      }
      onSaved?.(saved)
      onClose()
    } catch (cause) {
      failed(cause)
    }
  }

  async function confirmDelete() {
    if (!editing) return
    setError(null)
    try {
      await remove.mutateAsync(collection.id)
      onDeleted?.(collection.id)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t`Could not delete the collection.`)
    }
  }

  const collectionName = collection?.name ?? ''
  const title = editing ? t`Edit ${collectionName}` : t`New collection`
  const subtitle = editing ? (
    <Trans>A collection is a set of games. Changing its rule moves none of them.</Trans>
  ) : handIn ? (
    <Plural value={handIn} one="With the game you picked." other="With the # games you picked." />
  ) : initialRule && !isRuleEmpty(initialRule) ? (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Trans>From the filter you had open:</Trans>
      <RuleChips rule={initialRule} />
    </span>
  ) : (
    <Trans>A named set of games. They still count everywhere; the collection is a way to find them.</Trans>
  )

  return (
    <Frame
      title={title}
      description={subtitle}
      labelledBy={titleId}
      onClose={onClose}
      className="max-w-[28rem]"
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field id={nameId} label={<Trans>Name</Trans>}>
          <Input
            id={nameId}
            autoFocus
            value={name}
            maxLength={COLLECTION_NAME_MAX}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${nameId}-error` : undefined}
            onChange={(event) => {
              setName(event.target.value)
              setNameError(null)
            }}
            placeholder={t`45-45 League`}
          />
          {nameError ? (
            <span id={`${nameId}-error`} className="text-label text-blunder">
              {nameError}
            </span>
          ) : null}
        </Field>

        <div className="flex flex-col gap-1.5">
          <span id={`${titleId}-colour`} className="text-label font-medium text-soft">
            <Trans>Colour</Trans>
          </span>
          {/* One colour of eight, all on screen: the app's one-of-N control, the swatch as
              each option's face and its name for a screen reader and on hover. The chosen
              one sits on the raised thumb; the arrow keys move the choice along the row. */}
          <Segmented
            label={t`Colour`}
            value={color}
            onChange={setColor}
            className="self-start"
            options={COLLECTION_COLORS.map((key) => ({
              value: key,
              title: i18n._(COLLECTION_COLOR_NAMES[key]),
              label: (
                <>
                  <span
                    aria-hidden
                    className={cn(
                      'inline-block size-3.5 rounded-sm align-middle',
                      COLLECTION_COLOR_CLASSES[key].fill,
                    )}
                  />
                  <span className="sr-only">{i18n._(COLLECTION_COLOR_NAMES[key])}</span>
                </>
              ),
            }))}
          />
        </div>

        <Field id={descriptionId} label={<Trans>Description (optional)</Trans>}>
          <Textarea
            id={descriptionId}
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t`What these games have in common`}
            className="resize-y"
          />
        </Field>

        <Checkbox
          checked={pinned}
          onCheckedChange={(next) => setPinned(next)}
          className="self-start text-data text-soft"
          label={<Trans>Show in the rail, under Collections</Trans>}
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-label font-medium text-soft">
            <Trans>Rule</Trans>
          </span>
          <div className="flex flex-col gap-3 rounded-md border border-edge bg-raised/40 px-3 py-2.5">
            <Switch
              checked={ruleOn}
              onCheckedChange={setRuleOn}
              label={t`Add new games that match`}
              className="self-start text-data"
            />

            {ruleOn ? (
              <RuleFields draft={draft} onPatch={patchDraft} onToggleSpeed={toggleSpeed} />
            ) : null}

            {ruleOn ? (
              rule === null ? (
                <span className="text-label text-dim">
                  <Trans>Pick at least one thing a game must match, or switch the rule off.</Trans>
                </span>
              ) : countFailed ? (
                <span className="flex items-center gap-2 text-label text-dim">
                  <Trans>Could not count the games you already have.</Trans>
                  <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    onClick={() => {
                      void matching.refetch()
                      if (editing) void matchingInside.refetch()
                    }}
                  >
                    <RotateCw aria-hidden />
                    <Trans>Try again</Trans>
                  </Button>
                </span>
              ) : matchCount === undefined ? (
                <span className="flex items-center gap-1.5 text-label text-dim">
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                  <Trans>Counting the games you already have…</Trans>
                </span>
              ) : matchCount === 0 ? (
                <span className="text-label text-dim">
                  {editing && (total ?? 0) > 0 ? (
                    <Trans>Every game you already have that matches is in it.</Trans>
                  ) : (
                    <Trans>None of the games you already have match.</Trans>
                  )}
                </span>
              ) : (
                <Checkbox
                  checked={addExisting}
                  onCheckedChange={(next) => setAddExisting(next)}
                  className="self-start text-label text-soft"
                  label={
                    editing ? (
                      <Plural
                        value={matchCount}
                        one="Also add the # game that matches and is not in it yet"
                        other="Also add the # games that match and are not in it yet"
                      />
                    ) : (
                      <Plural
                        value={matchCount}
                        one="Also add the # game you already have that matches"
                        other="Also add the # games you already have that match"
                      />
                    )
                  }
                />
              )
            ) : null}
          </div>
          <span className="text-label leading-snug text-dim">
            <Trans>
              A rule only looks at games as they arrive (sync, the live stream, PGN). Taking a
              game out by hand sticks.
            </Trans>
          </span>
        </div>

        {error ? (
          <p role="alert" className="bb-error text-data">
            {error}
          </p>
        ) : null}

        {confirmingDelete && editing ? (
          <div className="flex flex-col gap-2.5 rounded-md border border-blunder/28 bg-blunder/5 px-3 py-2.5">
            <p className="flex items-start gap-2 text-data leading-[1.6] text-ink">
              <TriangleAlert className="mt-0.5 size-3.5 flex-none text-blunder" aria-hidden />
              <Trans>
                Delete {collectionName}? Its games stay in your library, in every other
                collection and in Stats.
              </Trans>
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmingDelete(false)}>
                <Trans>Keep it</Trans>
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={remove.isPending}
                onClick={() => void confirmDelete()}
              >
                {remove.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Trash2 aria-hidden />
                )}
                <Trans>Delete collection</Trans>
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          {editing && !confirmingDelete ? (
            <Button
              type="button"
              variant="destructive-outline"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 aria-hidden />
              <Trans>Delete…</Trans>
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button type="button" variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button type="submit" disabled={pending || !name.trim()}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {editing ? <Trans>Save</Trans> : <Trans>Create collection</Trans>}
          </Button>
        </div>
      </form>
    </Frame>
  )
}

/**
 * The rule's fields. Speeds are chips because a rule can name several (blitz *and* rapid);
 * everything else is one value or none, which a native select says best: in a form a select
 * is one more field to fill in, so it is the sunk `NativeSelect`, not a toolbar picker.
 */
function RuleFields({
  draft,
  onPatch,
  onToggleSpeed,
}: {
  draft: RuleDraft
  onPatch: (next: Partial<RuleDraft>) => void
  onToggleSpeed: (speed: Speed) => void
}) {
  const { t, i18n } = useLingui()
  const ids = useId()
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 max-sm:grid-cols-1">
      <Field id={`${ids}-source`} label={<Trans>Source</Trans>}>
        <NativeSelect
          id={`${ids}-source`}
          value={draft.source}
          onChange={(event) => onPatch({ source: event.target.value as Source | '' })}
          className={SELECT_CLASS}
        >
          <option value="">{t`Any source`}</option>
          {FILTER_OPTIONS.sources.map((source) => (
            <option key={source} value={source}>
              {SOURCE_LABELS[source]}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field id={`${ids}-clock`} label={<Trans>Time control</Trans>}>
        <Input
          id={`${ids}-clock`}
          value={draft.time_control}
          maxLength={RULE_CLOCK_MAX}
          onChange={(event) => onPatch({ time_control: event.target.value })}
          placeholder="2700+45"
          title={t`Seconds, then the increment: 2700+45 is 45 minutes plus 45 seconds a move`}
          className="font-mono"
        />
      </Field>

      <div role="group" aria-labelledby={`${ids}-speed`} className="col-span-full flex flex-col gap-1.5">
        <span id={`${ids}-speed`} className="text-label font-medium text-soft">
          {/* Its own context: beside the exact clock, German needs a second word for speed. */}
          <Trans context="collection rule field">Speed</Trans>
        </span>
        <div className="flex flex-wrap gap-1">
          {FILTER_OPTIONS.speeds.map((speed) => (
            <FilterChip
              key={speed}
              label={i18n._(SPEED_WORDS[speed])}
              on={draft.speed.includes(speed)}
              // Blue only while the ticked speeds narrow the rule; all of them narrow nothing.
              narrowed={draft.speed.length < FILTER_OPTIONS.speeds.length}
              onClick={() => onToggleSpeed(speed)}
            />
          ))}
        </div>
      </div>

      <Field id={`${ids}-rated`} label={<Trans>Rated</Trans>}>
        <NativeSelect
          id={`${ids}-rated`}
          value={draft.rated}
          onChange={(event) => onPatch({ rated: event.target.value as RuleDraft['rated'] })}
          className={SELECT_CLASS}
        >
          <option value="">{t`Either`}</option>
          <option value="true">{t`Rated`}</option>
          <option value="false">{t`Casual`}</option>
        </NativeSelect>
      </Field>

      <Field id={`${ids}-color`} label={<Trans>Colour</Trans>}>
        <NativeSelect
          id={`${ids}-color`}
          value={draft.color}
          onChange={(event) => onPatch({ color: event.target.value as Color | '' })}
          className={SELECT_CLASS}
        >
          <option value="">{t`Either`}</option>
          <option value="white">{t`White`}</option>
          <option value="black">{t`Black`}</option>
        </NativeSelect>
      </Field>

      <Field id={`${ids}-opponent`} label={<Trans>Opponent</Trans>}>
        <Input
          id={`${ids}-opponent`}
          value={draft.opponent}
          maxLength={RULE_OPPONENT_MAX}
          onChange={(event) => onPatch({ opponent: event.target.value })}
          placeholder={t`Part of a name`}
        />
      </Field>

      <Field id={`${ids}-eco`} label={<Trans>Opening (ECO)</Trans>}>
        <Input
          id={`${ids}-eco`}
          value={draft.eco}
          maxLength={RULE_ECO_MAX}
          onChange={(event) => onPatch({ eco: event.target.value.toUpperCase() })}
          placeholder={t`B22, or just C6`}
          className="font-mono"
        />
      </Field>
    </div>
  )
}

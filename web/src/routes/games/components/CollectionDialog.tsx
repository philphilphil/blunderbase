/**
 * Make a collection, or change one: its name, its colour, a line about it, and the rule
 * that fills it as games arrive.
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
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { Loader2, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'

import { RuleChips } from '@/components/collections/RuleChips'
import { Field, Frame } from '@/components/engine-dialog/DialogFrame'
import { Button } from '@/components/ui/button'
import { FilterChip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
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

const FIELD_CLASS =
  'h-8 w-full rounded-md border border-input bg-elevated px-2 text-xs text-ink outline-none transition-colors focus-visible:border-accent-teal/50'

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
            rule,
          },
        })
        if (withExisting) saved = (await applyRule.mutateAsync(collection.id)).collection
      } else {
        saved = await create.mutateAsync({
          name: trimmed,
          color,
          description: description.trim() || null,
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
            <span id={`${nameId}-error`} className="text-[0.6875rem] text-blunder">
              {nameError}
            </span>
          ) : null}
        </Field>

        <div className="flex flex-col gap-1.5">
          <span id={`${titleId}-colour`} className="text-[0.6875rem] font-medium text-soft">
            <Trans>Colour</Trans>
          </span>
          <div role="radiogroup" aria-labelledby={`${titleId}-colour`} className="flex gap-2">
            {COLLECTION_COLORS.map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={color === key}
                aria-label={i18n._(COLLECTION_COLOR_NAMES[key])}
                title={i18n._(COLLECTION_COLOR_NAMES[key])}
                onClick={() => setColor(key)}
                className={cn(
                  'size-[1.125rem] rounded-[0.25rem] outline-none transition-shadow',
                  COLLECTION_COLOR_CLASSES[key].fill,
                  color === key
                    ? 'shadow-[0_0_0_0.09375rem_var(--bb-surface),0_0_0_0.1875rem_var(--bb-text)]'
                    : 'hover:shadow-[0_0_0_0.09375rem_var(--bb-surface),0_0_0_0.1875rem_var(--bb-edge-strong)] focus-visible:shadow-[0_0_0_0.09375rem_var(--bb-surface),0_0_0_0.1875rem_var(--bb-accent)]',
                )}
              />
            ))}
          </div>
        </div>

        <Field id={descriptionId} label={<Trans>Description (optional)</Trans>}>
          <textarea
            id={descriptionId}
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t`What these games have in common`}
            className="w-full resize-y rounded-md border border-input bg-elevated px-2.5 py-1.5 text-xs text-ink outline-none transition-colors placeholder:text-faint focus-visible:border-accent-teal/50"
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <span className="text-[0.6875rem] font-medium text-soft">
            <Trans>Rule</Trans>
          </span>
          <div className="flex flex-col gap-3 rounded-md border border-edge bg-raised/40 px-3 py-2.5">
            <label className="flex cursor-pointer items-center gap-2 text-[0.75rem] text-ink">
              <button
                type="button"
                role="switch"
                aria-checked={ruleOn}
                onClick={() => setRuleOn((current) => !current)}
                className={cn(
                  'relative h-[0.9375rem] w-[1.625rem] flex-none rounded-full transition-colors',
                  ruleOn ? 'bg-accent-teal' : 'bg-edge',
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 size-[0.6875rem] rounded-full bg-surface transition-[left]',
                    ruleOn ? 'left-[0.8125rem]' : 'left-0.5',
                  )}
                />
              </button>
              <Trans>Add new games that match</Trans>
            </label>

            {ruleOn ? (
              <RuleFields draft={draft} onPatch={patchDraft} onToggleSpeed={toggleSpeed} />
            ) : null}

            {ruleOn ? (
              rule === null ? (
                <span className="text-[0.6875rem] text-dim">
                  <Trans>Pick at least one thing a game must match, or switch the rule off.</Trans>
                </span>
              ) : matchCount === undefined ? (
                <span className="flex items-center gap-1.5 text-[0.6875rem] text-dim">
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                  <Trans>Counting the games you already have…</Trans>
                </span>
              ) : matchCount === 0 ? (
                <span className="text-[0.6875rem] text-dim">
                  {editing && (total ?? 0) > 0 ? (
                    <Trans>Every game you already have that matches is in it.</Trans>
                  ) : (
                    <Trans>None of the games you already have match.</Trans>
                  )}
                </span>
              ) : (
                <label className="flex cursor-pointer items-center gap-2 text-[0.6875rem] text-dim">
                  <input
                    type="checkbox"
                    checked={addExisting}
                    onChange={(event) => setAddExisting(event.target.checked)}
                    className="size-3.5 accent-[var(--bb-accent)]"
                  />
                  <span>
                    {editing ? (
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
                    )}
                  </span>
                </label>
              )
            ) : null}
          </div>
          <span className="text-[0.6875rem] leading-snug text-dim">
            <Trans>
              A rule only looks at games as they arrive (sync, the live stream, PGN). Taking a
              game out by hand sticks.
            </Trans>
          </span>
        </div>

        {error ? (
          <p className="rounded-md border border-blunder/28 bg-blunder/5 px-2.5 py-2 text-[0.75rem] text-blunder">
            {error}
          </p>
        ) : null}

        {confirmingDelete && editing ? (
          <div className="flex flex-col gap-2.5 rounded-md border border-blunder/28 bg-blunder/5 px-3 py-2.5">
            <p className="flex items-start gap-2 text-[0.75rem] leading-[1.6] text-ink">
              <TriangleAlert className="mt-0.5 size-3.5 flex-none text-blunder" aria-hidden />
              <Trans>
                Delete {collectionName}? Its games stay in your library, in every other
                collection and in Stats.
              </Trans>
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirmingDelete(false)}>
                <Trans>Keep it</Trans>
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={remove.isPending}
                onClick={() => void confirmDelete()}
              >
                {remove.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                <Trans>Delete collection</Trans>
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          {editing && !confirmingDelete ? (
            <Button
              type="button"
              variant="ghost"
              className="text-blunder hover:text-blunder"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trans>Delete…</Trans>
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button type="button" variant="outline" onClick={onClose}>
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
 * everything else is one value or none, which a native select says best.
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
        <select
          id={`${ids}-source`}
          value={draft.source}
          onChange={(event) => onPatch({ source: event.target.value as Source | '' })}
          className={FIELD_CLASS}
        >
          <option value="">{t`Any source`}</option>
          {FILTER_OPTIONS.sources.map((source) => (
            <option key={source} value={source}>
              {SOURCE_LABELS[source]}
            </option>
          ))}
        </select>
      </Field>

      <Field id={`${ids}-clock`} label={<Trans>Time control</Trans>}>
        <Input
          id={`${ids}-clock`}
          value={draft.time_control}
          onChange={(event) => onPatch({ time_control: event.target.value })}
          placeholder="2700+45"
          title={t`Seconds, then the increment: 2700+45 is 45 minutes plus 45 seconds a move`}
          className="font-mono"
        />
      </Field>

      <div role="group" aria-labelledby={`${ids}-speed`} className="col-span-full flex flex-col gap-1.5">
        <span id={`${ids}-speed`} className="text-[0.6875rem] font-medium text-soft">
          {/* Its own context: beside the exact clock, German needs a second word for speed. */}
          <Trans context="collection rule field">Speed</Trans>
        </span>
        <div className="flex flex-wrap gap-1">
          {FILTER_OPTIONS.speeds.map((speed) => (
            <FilterChip
              key={speed}
              label={i18n._(SPEED_WORDS[speed])}
              on={draft.speed.includes(speed)}
              onClick={() => onToggleSpeed(speed)}
            />
          ))}
        </div>
      </div>

      <Field id={`${ids}-rated`} label={<Trans>Rated</Trans>}>
        <select
          id={`${ids}-rated`}
          value={draft.rated}
          onChange={(event) => onPatch({ rated: event.target.value as RuleDraft['rated'] })}
          className={FIELD_CLASS}
        >
          <option value="">{t`Either`}</option>
          <option value="true">{t`Rated`}</option>
          <option value="false">{t`Casual`}</option>
        </select>
      </Field>

      <Field id={`${ids}-color`} label={<Trans>Colour</Trans>}>
        <select
          id={`${ids}-color`}
          value={draft.color}
          onChange={(event) => onPatch({ color: event.target.value as Color | '' })}
          className={FIELD_CLASS}
        >
          <option value="">{t`Either`}</option>
          <option value="white">{t`White`}</option>
          <option value="black">{t`Black`}</option>
        </select>
      </Field>

      <Field id={`${ids}-opponent`} label={<Trans>Opponent</Trans>}>
        <Input
          id={`${ids}-opponent`}
          value={draft.opponent}
          onChange={(event) => onPatch({ opponent: event.target.value })}
          placeholder={t`Part of a name`}
        />
      </Field>

      <Field id={`${ids}-eco`} label={<Trans>Opening (ECO)</Trans>}>
        <Input
          id={`${ids}-eco`}
          value={draft.eco}
          onChange={(event) => onPatch({ eco: event.target.value.toUpperCase() })}
          placeholder={t`B22, or just C6`}
          className="font-mono"
        />
      </Field>
    </div>
  )
}

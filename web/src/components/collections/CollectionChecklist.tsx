/**
 * The body of "Add to…" — the games footer's popover and the game page's ⋯ → Collections…
 * — as one component, so the two cannot drift.
 *
 * A checklist rather than a list to pick one from, because membership is not exclusive: a
 * lost league round is in "45-45 League" and in "Tough losses". Each row's box says where
 * the games in hand stand — ticked when all of them are in, half-ticked when only some
 * are, empty when none — and a click settles it for all of them: a ticked row takes them
 * out, anything else puts them all in. The half state is the one a native checkbox cannot
 * draw, which is why each row is the app's `Checkbox` (mixed = the minus), the same box the
 * games table ticks rows with, with the whole row as its hit area. While a row's write is
 * out it says so with a spinner at its end rather than greying every row.
 *
 * What the rows show comes from the games' own `collections` ids, which only change when
 * the games query comes back after a write. So the answer of a click is held locally until
 * the ids the caller passes in move, and the box does not flicker back to its old state in
 * between.
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { Loader2, Plus } from 'lucide-react'
import { useState } from 'react'

import { Checkbox } from '@/components/ui/checkbox'
import { useAddToCollection, useCollections, useRemoveFromCollection } from '@/lib/api/queries'
import type { Collection } from '@/lib/api/types'
import { membershipOf, type MembershipState } from '@/lib/collections'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

import { CollectionSwatch } from './CollectionChip'

export interface ChecklistGame {
  id: number
  /** The game's collection ids, as `GameSummary.collections` carries them. */
  collections?: readonly number[] | null
}

export function CollectionChecklist({
  games,
  onNew,
  newLabel,
  className,
}: {
  /** The games in hand — the selected rows, or the one game on its page. */
  games: readonly ChecklistGame[]
  /** "+ New collection…": the caller opens `CollectionDialog` with these games. */
  onNew?: () => void
  /** Overrides the new row's wording; the default counts the games in hand. */
  newLabel?: string
  className?: string
}) {
  const { t } = useLingui()
  const collections = useCollections()
  const add = useAddToCollection()
  const remove = useRemoveFromCollection()
  const [settled, setSettled] = useState<Map<number, MembershipState>>(() => new Map())
  const [busy, setBusy] = useState<number | null>(null)

  // Drop what a click settled once the games' own ids agree with it — they are the truth,
  // and the local answer only covers the gap until they arrive. Only the rows they confirm:
  // a second tick made while the first one's refetch was out lands after it, and the ids
  // that refetch brings back do not know about it yet, so clearing every row then would
  // flip the second box back until its own refetch came in.
  const signature = games
    .map((game) => `${game.id}:${[...(game.collections ?? [])].sort((a, b) => a - b).join(',')}`)
    .join('|')
  const [seen, setSeen] = useState(signature)
  if (seen !== signature) {
    setSeen(signature)
    setSettled(
      (current) =>
        new Map([...current].filter(([id, state]) => membershipOf(games, id).state !== state)),
    )
  }

  const ids = games.map((game) => game.id)
  const count = games.length

  async function toggle(collection: Collection, state: MembershipState) {
    if (busy !== null || count === 0) return
    setBusy(collection.id)
    const leaving = state === 'all'
    try {
      if (leaving) {
        await remove.mutateAsync({ collectionId: collection.id, gameIds: ids })
      } else {
        await add.mutateAsync({ collectionId: collection.id, gameIds: ids })
      }
      setSettled((current) => new Map(current).set(collection.id, leaving ? 'none' : 'all'))
    } catch {
      // A toast rather than a line in the list: the popover is a menu, and it has nowhere to
      // keep a red sentence without pushing the rows the owner is aiming at.
      const name = collection.name
      toast.error(
        leaving ? t`Could not take the games out of ${name}.` : t`Could not add the games to ${name}.`,
      )
    } finally {
      setBusy(null)
    }
  }

  const rows = collections.data?.collections ?? []
  const states = rows.map((collection) => {
    const measured = membershipOf(games, collection.id)
    const state = settled.get(collection.id) ?? measured.state
    return { collection, state, inCount: state === measured.state ? measured.count : null }
  })
  const anyPartial = states.some((row) => row.state === 'some')

  return (
    <div className={cn('flex min-w-[13.75rem] flex-col text-data text-soft', className)}>
      <span className="px-[0.4375rem] pt-[0.3125rem] pb-1 text-meta tracking-[0.06em] text-dim-2 uppercase">
        <Plural value={count} one="This game is in" other="# games in" />
      </span>

      {collections.isPending ? (
        <span className="flex items-center gap-2 px-[0.4375rem] py-[0.3125rem] text-dim">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          <Trans>Loading collections…</Trans>
        </span>
      ) : collections.isError ? (
        <span className="px-[0.4375rem] py-[0.3125rem] text-blunder">
          <Trans>Could not load the collections.</Trans>
        </span>
      ) : rows.length === 0 ? (
        <span className="px-[0.4375rem] py-[0.3125rem] text-dim">
          <Trans>No collections yet.</Trans>
        </span>
      ) : (
        <ul role="list" className="flex flex-col">
          {states.map(({ collection, state, inCount }) => (
            <li key={collection.id}>
              <Checkbox
                checked={state === 'all' ? true : state === 'some' ? 'mixed' : false}
                disabled={count === 0}
                aria-disabled={busy !== null || undefined}
                aria-busy={busy === collection.id || undefined}
                onCheckedChange={() => void toggle(collection, state)}
                className={cn(
                  'w-full rounded-sm px-[0.4375rem] py-[0.3125rem] whitespace-nowrap text-soft transition-colors hover:bg-raised hover:text-ink focus-visible:outline-offset-[-0.125rem]',
                  busy !== null && 'cursor-wait',
                  '[&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1 [&>span:last-child]:items-center [&>span:last-child]:gap-2',
                )}
                label={
                  <>
                    <CollectionSwatch color={collection.color} />
                    <span className="min-w-0 truncate">{collection.name}</span>
                    <span className="ml-auto flex items-center pl-3.5 text-meta tabular text-dim-2">
                      {busy === collection.id ? (
                        <Loader2 className="size-3 animate-spin text-dim" aria-hidden />
                      ) : state === 'some' && inCount !== null ? (
                        <Trans>
                          {inCount} of {count}
                        </Trans>
                      ) : null}
                    </span>
                  </>
                }
              />
            </li>
          ))}
        </ul>
      )}

      {onNew ? (
        <>
          <div className="mx-0.5 my-1 h-px bg-hairline" />
          <button
            type="button"
            onClick={onNew}
            className="flex items-center gap-2 rounded-sm px-[0.4375rem] py-[0.3125rem] text-left whitespace-nowrap text-dim transition-colors hover:bg-raised hover:text-ink focus-visible:outline-offset-[-0.125rem]"
          >
            <Plus className="size-3" aria-hidden />
            {newLabel ?? (
              <Plural
                value={count}
                one="New collection from this game…"
                other="New collection from these # games…"
              />
            )}
          </button>
        </>
      ) : null}

      <p className="px-[0.4375rem] pt-[0.1875rem] pb-1 text-label leading-snug whitespace-normal text-dim">
        {anyPartial ? (
          <Plural
            value={count}
            one="A game can be in several."
            other="A game can be in several. Click a half-ticked one to put all # in."
          />
        ) : (
          <Trans>A game can be in several.</Trans>
        )}
      </p>
    </div>
  )
}

/**
 * A collection as the design draws it: a tinted chip in the collection's own colour, and
 * the solid square that stands for it where there is no room for a chip.
 *
 * Tinted rather than filled because a row can carry two or three of these next to the
 * blunder flags, and solid colour blocks there would shout over the flags the row is
 * actually about. The dot repeats the colour at full strength so two chips in similar
 * tints still read apart. A chip that goes somewhere is a router link whose click and keys
 * stop where they are: in the games table it sits inside a row that opens the game on click
 * and on Enter, and the row's Enter would otherwise cancel the link's (as `SourceBadge`).
 */
import { useLingui } from '@lingui/react/macro'
import { Link } from 'react-router-dom'

import { useCollections } from '@/lib/api/queries'
import type { Collection, CollectionColor } from '@/lib/api/types'
import { collectionColorClasses, collectionPath } from '@/lib/collections'
import { cn } from '@/lib/utils'

type ChipCollection = Pick<Collection, 'name' | 'color'> & { color: CollectionColor | string }

export function CollectionChip({
  collection,
  to,
  size = 'sm',
  className,
  title,
}: {
  collection: ChipCollection
  /** Where the chip leads — usually `collectionPath(id)`. Left out, it is a plain label. */
  to?: string
  /** `sm` for a table row, `md` for a header. */
  size?: 'sm' | 'md'
  className?: string
  title?: string
}) {
  const { t } = useLingui()
  const classes = cn(
    'inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm border whitespace-nowrap',
    size === 'sm' ? 'px-1.5 text-[0.65625rem] leading-[1.0625rem]' : 'px-2 py-px text-[0.71875rem]',
    collectionColorClasses(collection.color).chip,
    to && 'hover:brightness-125',
    className,
  )
  const body = (
    <>
      <span aria-hidden className="size-[0.3125rem] flex-none rounded-full bg-current" />
      <span className="truncate">{collection.name}</span>
    </>
  )
  if (to) {
    return (
      <Link
        to={to}
        title={title ?? t`Open the collection ${collection.name}`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        className={classes}
      >
        {body}
      </Link>
    )
  }
  return (
    <span title={title ?? collection.name} className={classes}>
      {body}
    </span>
  )
}

/**
 * A game's collections as a row of chips, from the ids its summary carries.
 *
 * Names and colours come from the one `useCollections` list rather than riding on every
 * game row: a rename then shows on every row at once, and a row costs six bytes a
 * membership. An id the list does not know yet (it is loading, or the collection was just
 * deleted) draws nothing rather than a blank chip. The row clips rather than wraps — a
 * table row has one line — and the chips keep the order of the list, which is by name.
 */
export function CollectionChips({
  ids,
  size = 'sm',
  link = true,
  className,
}: {
  ids: readonly number[] | null | undefined
  size?: 'sm' | 'md'
  /** Each chip leads to the library filtered to its collection (`collectionPath`). */
  link?: boolean
  className?: string
}) {
  const { data } = useCollections()
  if (!ids?.length || !data) return null
  const wanted = new Set(ids)
  const shown = data.collections.filter((collection) => wanted.has(collection.id))
  if (!shown.length) return null
  return (
    <span className={cn('flex min-w-0 items-center gap-1 overflow-hidden', className)}>
      {shown.map((collection) => (
        <CollectionChip
          key={collection.id}
          collection={collection}
          size={size}
          to={link ? collectionPath(collection.id) : undefined}
          className="flex-none"
        />
      ))}
    </span>
  )
}

/**
 * The collection's colour as a small solid square — a card on the Collections screen, a
 * checklist row, the filter chip, a command palette entry.
 */
export function CollectionSwatch({
  color,
  className,
}: {
  color: CollectionColor | string
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2 flex-none rounded-[0.125rem]',
        collectionColorClasses(color).fill,
        className,
      )}
    />
  )
}

/**
 * ⋯ → Collections… on the game screen: which collections this game is in, as the same
 * checklist the library's "Add to…" opens, and the way to start a new one from it.
 *
 * A small dialog rather than a popover hung off the ⋯, because the ⋯ is a menu that closes
 * on the click that chose the entry — and a checklist is something you tick two or three
 * rows of before you are done. The dialog stays until it is dismissed, and the board's keys
 * stand down while it is up (`Frame`'s `role="dialog"`), so a tick never moves the game.
 *
 * "New collection…" swaps this for `CollectionDialog` with the one game in hand, rather
 * than stacking the two: the checklist would be stale behind it anyway, and the new
 * collection shows up ticked in the header's chips the moment it is made.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { useId, useState } from 'react'

import { CollectionChecklist } from '@/components/collections/CollectionChecklist'
import { Frame } from '@/components/engine-dialog/DialogFrame'
import { Button } from '@/components/ui/button'
import { CollectionDialog } from '@/routes/games/components/CollectionDialog'

export function GameCollectionsDialog({
  gameId,
  collections,
  onClose,
}: {
  gameId: number
  /** The game's collection ids, as its summary carries them. */
  collections: readonly number[] | null | undefined
  onClose: () => void
}) {
  const { t } = useLingui()
  const titleId = useId()
  const [creating, setCreating] = useState(false)

  if (creating) return <CollectionDialog gameIds={[gameId]} onClose={onClose} />

  return (
    <Frame
      title={<Trans>Collections</Trans>}
      description={
        <Trans>
          Tick a collection to put this game in it, untick it to take the game out. Taking it
          out by hand sticks.
        </Trans>
      }
      labelledBy={titleId}
      onClose={onClose}
      className="max-w-[22rem]"
    >
      <CollectionChecklist
        games={[{ id: gameId, collections }]}
        onNew={() => setCreating(true)}
        newLabel={t`New collection…`}
        className="-mx-1.5"
      />
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          <Trans>Done</Trans>
        </Button>
      </div>
    </Frame>
  )
}

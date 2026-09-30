/**
 * The ⋯ at the end of the board's control row: what this game rarely needs, one click away.
 *
 * The row under the board had grown to a dozen controls of the same weight, and the ones a
 * reader presses once a session — the way back to the explorer they came from, the tree
 * behind a correspondence game — were taking the same width as Analyse… and Note. They are
 * in here instead. Nothing that is pressed every game is: a menu is the wrong shape for a
 * control the hand goes to without looking, and the whole point of the row is that the hand
 * can.
 *
 * The button draws nothing at all when there is nothing rare to hold — a model game opened
 * from nowhere in particular — so the row does not grow a permanent ⋯ to hold an empty
 * list. Every library game has at least its collections in here.
 *
 * It is the app's one action menu (`ActionMenu`, icon-only): the tool button's face as an
 * `icon-sm` square, opening upwards because this row is the last thing in the board column
 * and a menu opening downwards would hang off the bottom of the window. Open, it sinks
 * (`raised`) rather than turning blue: blue means on or narrowed, and an open menu is
 * neither.
 */
import { useLingui } from '@lingui/react/macro'
import type { ReactNode } from 'react'

import { ActionMenu } from '@/components/ui/action-menu'

export interface RowMenuItem {
  id: string
  label: ReactNode
  onSelect: () => void
  /** Drawn at the end of the row, the way the shortcut sheet prints one. */
  shortcut?: string
}

export function RowMenu({ items, className }: { items: RowMenuItem[]; className?: string }) {
  const { t } = useLingui()
  if (items.length === 0) return null
  return (
    <ActionMenu
      label={t`More for this game`}
      iconOnly
      side="top"
      className={className}
      items={items.map((item) => ({
        label: item.label,
        onSelect: item.onSelect,
        hint: item.shortcut,
      }))}
    />
  )
}

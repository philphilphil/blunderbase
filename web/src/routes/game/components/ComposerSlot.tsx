import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The slot: the box's *resting* height plus its padding (`pt-1.5`, `pb-2` around
 * `COMPOSER_REST`'s 2rem). Its height never changes, which is what keeps the pane above it
 * still when the box opens.
 */
const SLOT = 'h-[2.875rem]'

/**
 * Where the composer is drawn: pinned to the floor of the pane at the slot's own inset, so
 * at rest it sits exactly in the slot, and free to grow upward from there.
 *
 * Positioned against the *pane* (`DOCK`), not the slot, so its ceiling can be said in the
 * pane's terms: its top never above a hair under the pane's 2.1875rem title strip — the
 * strip, the layer's own 0.5rem off the floor and 0.3125rem of air, 3rem in all. On a short
 * pane the open box is squeezed — its text box gives, `NoteComposer`'s row stays — rather
 * than covering the strip. `[&>*]:min-h-0` lets that ceiling squeeze whatever is passed in.
 */
const LAYER =
  'absolute inset-x-1.5 bottom-2 z-10 flex max-h-[calc(100%-3rem)] flex-col [&>*]:min-h-0'

/**
 * The note composer's place at the floor of a pane (`./composerDock` says how the pieces fit).
 *
 * No rule above it: at rest it is a sunk field, open it brings its own bordered surface, and
 * a rule a few pixels from either would read as a mistake.
 */
export function ComposerSlot({ composer }: { composer: ReactNode }) {
  return (
    <div data-testid="composer-slot" className={cn('flex-none', SLOT)}>
      <div data-testid="composer-layer" data-composer-layer="" className={LAYER}>
        {composer}
      </div>
    </div>
  )
}

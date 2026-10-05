/**
 * Where the note composer sits: a one-line slot at the floor of a pane, from which the box
 * grows *upward* over the pane when it opens, rather than holding room in the column (#45).
 *
 * On the desktop it is the foot of the move table, so the Book and Notes beside it have
 * their whole height; on the phone it is the foot of the Notes tab. Either way it is about
 * the position on the board, so it sits under what the board is stepping through, and the
 * tabs beside it changing never move the box somebody is typing in.
 *
 * Three pieces, because the pane it docks to owns its own layout:
 *
 *   - `DOCK` on the pane's outer box — `relative`, for the layer, and the `group/dock` the
 *     clearance reads;
 *   - `DOCK_CLEARANCE` on whatever scrolls in that pane, so nothing the open box covers is
 *     out of reach;
 *   - `<ComposerSlot>` (`./ComposerSlot`) last in the pane, which keeps the composer on the
 *     pane's floor.
 *
 * The slot used to be a fixed 9rem under the Book and Notes — the whole open box, reserved
 * at every ply whether or not anybody was writing, a third of what that track had for the
 * book on a laptop. Now only the one-line field holds room.
 */

/** The pane's outer box: positioned for the layer, and the group the clearance reads. */
export const DOCK = 'group/dock relative'

/**
 * Room at the end of the pane's scroll while the composer is open over it: the open box
 * (`COMPOSER_OPEN`'s 8.125rem) plus the layer's 0.5rem off the floor, less the 2.875rem slot
 * that is already outside the scrolling part — 5.75rem of the pane's foot under the overlay.
 *
 * Padding, and the scroll padding to match, rather than a smaller pane: both change only how
 * far the pane scrolls and where `scrollIntoView` counts as visible, never where anything on
 * screen sits, so opening the box still reflows nothing. It keys off the composer's own
 * `data-state` through `:has()` because the box decides for itself when it is open (focus,
 * an unsaved draft, a failed save) and the pane has no other way to know.
 */
export const DOCK_CLEARANCE =
  'group-has-[[data-composer-layer]>[data-state=open]]/dock:pb-[5.75rem] group-has-[[data-composer-layer]>[data-state=open]]/dock:scroll-pb-[5.75rem]'

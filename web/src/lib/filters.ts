/**
 * The set-membership half of a chip row (`@/components/ui/chip`), shared by the explorer's
 * reference filters and the Stats page's time controls.
 */

/**
 * A chip toggled on or off, kept in the canonical order.
 *
 * Turning the last one off is refused rather than allowed: an empty set names no games at
 * all, and a screen that answers "nothing here" because of a filter the owner emptied by
 * accident reads as a broken page rather than as a filter. The order argument is what keeps
 * the chips from reshuffling as they are pressed — a set has no order, but a row of them
 * does, and it is the one the row was drawn in.
 */
export function toggleFilter<T extends string | number>(
  chosen: readonly T[],
  value: T,
  order: readonly T[],
): T[] {
  const on = chosen.includes(value)
  if (on && chosen.length === 1) return [...chosen]
  const next = on ? chosen.filter((item) => item !== value) : [...chosen, value]
  return order.filter((item) => next.includes(item))
}

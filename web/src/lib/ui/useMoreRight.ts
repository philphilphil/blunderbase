import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The fade on a sideways-scrolling table's right edge, while there is more to that side.
 * Overlay scrollbars show nothing at rest, so without it a table cut at the pane's edge
 * reads as a table that ends there (the Games table, the explorer's move tables).
 */
export const FADE_RIGHT =
  '[mask-image:linear-gradient(to_right,black_calc(100%-3.5rem),transparent)]'

/**
 * Whether a region that scrolls sideways still has content off to its right: `ref` and
 * `onScroll` go on the scrolling element, and `moreRight` says when to draw `FADE_RIGHT`.
 * It is measured on scroll and on resize; `watch` is whatever changes the content's width
 * without resizing the frame (the rows arriving), so the answer follows it too.
 */
export function useMoreRight<T extends HTMLElement>(watch?: unknown) {
  const ref = useRef<T>(null)
  const [moreRight, setMoreRight] = useState(false)
  const measure = useCallback(() => {
    const node = ref.current
    if (!node) return
    setMoreRight(node.scrollLeft + node.clientWidth < node.scrollWidth - 1)
  }, [])
  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [measure, watch])
  return { ref, onScroll: measure, moreRight }
}

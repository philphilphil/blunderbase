import type * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The fade on a sideways-scrolling table's right edge, while there is more to that side.
 * Overlay scrollbars show nothing at rest, so without it a table cut at the pane's edge
 * reads as a table that ends there (the Games table, the explorer's move tables).
 */
export const FADE_RIGHT =
  '[mask-image:linear-gradient(to_right,black_calc(100%-3.5rem),transparent)]'

/**
 * `FADE_RIGHT` from `md` up only, for a table that folds into cards on a phone and never
 * scrolls sideways there. Written out whole rather than built from `FADE_RIGHT`, so
 * Tailwind's scanner sees the class.
 */
export const FADE_RIGHT_MD =
  'md:[mask-image:linear-gradient(to_right,black_calc(100%-3.5rem),transparent)]'

/**
 * Whether a region that scrolls sideways still has content off to its right: `ref` and
 * `onScroll` go on the scrolling element, and `moreRight` says when to draw `FADE_RIGHT`.
 * It is measured on scroll and on resize; `watch` is whatever changes the content's width
 * without resizing the frame (the rows arriving), so the answer follows it too.
 *
 * `content`, where given, is observed as well: an element as wide as the scrolled content
 * (the Games table's header, which spans every track). A grid whose tracks follow its
 * cells can widen past the frame while neither the frame nor a full-width grid changes
 * size, and only that element's resize says so.
 */
export function useMoreRight<T extends HTMLElement>(
  watch?: unknown,
  content?: React.RefObject<HTMLElement | null>,
) {
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
    if (content?.current) observer.observe(content.current)
    return () => observer.disconnect()
  }, [measure, watch, content])
  return { ref, onScroll: measure, moreRight }
}

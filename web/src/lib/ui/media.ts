/**
 * A CSS media query as React state.
 *
 * Most of the responsive work in this app is done in CSS, with Tailwind's `max-md:`/`md:`
 * variants — that is cheaper, and it survives a resize without a render. This hook is for
 * the cases CSS cannot reach: a component that must not be *mounted* at all on the other
 * side of the breakpoint. `display: none` still runs effects, and a hidden
 * `ColumnSplitter` would install pointer capture and take the body's selection for a
 * boundary a phone has no way to drag.
 *
 * Guarded the way `theme.tsx` guards its own `matchMedia`: jsdom (and any renderer without
 * a window) has none, and a missing one reads as "does not match" rather than as a crash.
 */
import { useCallback, useSyncExternalStore } from 'react'

/**
 * Tailwind's `md` floor is 768px, so the phone layout is everything strictly under it.
 * Kept in pixels rather than `rem` because that is the unit Tailwind's own `md:` compiles
 * to — the app scales its root font (`lib/ui/scale.ts`), and a `rem` query would resolve
 * against the browser's root size instead and put the two breaks in different places.
 */
export const MOBILE_QUERY = '(max-width: 767.98px)'

function matchesNow(query: string): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(query).matches
  )
}

/**
 * `true` while the query matches, kept current as the window is resized or rotated.
 *
 * Read through `useSyncExternalStore` rather than an effect that seeds state: the answer
 * is already there at the first render, so a phone never paints the desktop layout for a
 * frame before correcting itself.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => {}
      }
      const list = window.matchMedia(query)
      // `addListener` is the pre-2019 spelling; the optional calls are for the stubs a
      // test environment supplies, which need not have either.
      list.addEventListener?.('change', onChange)
      return () => list.removeEventListener?.('change', onChange)
    },
    [query],
  )
  const snapshot = useCallback(() => matchesNow(query), [query])
  // Nothing here is server-rendered, but the server snapshot is what makes that a
  // decision rather than a crash waiting for the day something is.
  return useSyncExternalStore(subscribe, snapshot, () => false)
}

/** Below Tailwind's `md`: one scrolling column, no draggable furniture. */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY)
}

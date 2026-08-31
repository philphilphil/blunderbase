import { useEffect, useRef, type RefObject } from 'react'

/**
 * Wheel travel — in CSS pixels, whatever the device reports in — that counts as one move.
 *
 * Tuned per-tick rather than per-notch: a mouse's discrete wheel tick is ~15px of deltaY, so
 * one tick alone crosses this and steps once. A trackpad's stream of small deltas is added up
 * to the same threshold and then reset, so one flick is one move rather than ten.
 */
export const WHEEL_STEP = 10

interface Seeking {
  /** The ply the surface is standing on; `-1` for the starting position. */
  cursor: number
  /** Where a step lands when the surface has no stepper of its own. */
  onSeek: (cursor: number) => void
  /** The page's own stepper, which knows about branches; preferred where it is given. */
  onStep?: (delta: number) => void
}

/**
 * Wheeling over a surface steps the game: down is forwards, the way a move list reads.
 *
 * One hook rather than one implementation per surface, because the board and the eval curve
 * sit on the same page and a wheel that stepped one at a different speed — or that scrolled
 * the page under the other — would read as two different wheels rather than one gesture the
 * screen understands. Everything here is the tuning that makes it feel like one: the
 * threshold, the trackpad accumulation, and the reset when the reader turns round.
 *
 * The listener is attached by hand because React's `onWheel` is passive, and a passive
 * listener cannot stop the page scrolling underneath the gesture. It binds once, so the
 * caller's live cursor and callbacks are read through a ref rather than closed over.
 */
export function useWheelStep(ref: RefObject<HTMLElement | null>, seeking: Seeking): void {
  const live = useRef(seeking)
  useEffect(() => {
    live.current = seeking
  })
  const travel = useRef(0)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    function onWheel(event: WheelEvent) {
      // A pinch-zoom is a wheel event too, and is not a request for the next move.
      if (event.ctrlKey) return
      event.preventDefault()
      // `deltaMode` is lines or pages on some browsers; both become rough pixels.
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1
      const delta = event.deltaY * scale
      if (delta === 0) return
      // Turning round mid-gesture starts its own count rather than paying off the old one.
      if (delta > 0 !== travel.current > 0) travel.current = 0
      travel.current += delta
      if (Math.abs(travel.current) < WHEEL_STEP) return
      const step = travel.current > 0 ? 1 : -1
      travel.current = 0
      const { onStep, onSeek, cursor } = live.current
      if (onStep) onStep(step)
      else onSeek(cursor + step)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [ref])
}

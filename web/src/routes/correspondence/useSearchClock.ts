/**
 * Now, in milliseconds, for the "searching · 2d 4h" readouts — one clock per screen, so one
 * tick redraws every card and pane on it at once.
 *
 * It reads the time again the moment a search goes live, not only on the next tick: a
 * search started after the screen opened has a `started_at` later than a clock read at
 * mount, and `runningSeconds` clamps that to zero. And it ticks every second, because
 * `formatSpan` prints seconds for the first minute; a slower tick left "0s" standing, and
 * any change to `running` inside the interval restarted the wait without moving the clock.
 */
import { useEffect, useState } from 'react'

const TICK_MS = 1_000

export function useSearchClock(running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const tick = () => setNow(Date.now())
    tick()
    const timer = setInterval(tick, TICK_MS)
    return () => clearInterval(timer)
  }, [running])
  return now
}

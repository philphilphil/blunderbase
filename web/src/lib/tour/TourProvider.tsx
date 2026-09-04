/**
 * The tour's state machine: which step is showing, and what it is pointing at.
 *
 * The whole of the interesting behaviour is "get to the step, or give up on it". A step
 * names a route and a `data-tour` element; the runner navigates there, then watches for the
 * element to appear, and if it has not within `ANCHOR_WAIT_MS` the step is dropped and the
 * tour moves on in whichever direction it was already going. That is what makes the tour
 * safe on an install where half of it does not apply yet: an empty library has no game to
 * open, a deployment with the assistant switched off has no page to point at, and neither
 * is an error — the counter is over the steps that can actually be shown.
 *
 * Whether the tour has been seen is a row on the deployment (`GET /settings/tour`), so it
 * survives a new browser and a new machine; the read-only demo cannot write that row and
 * keeps its own copy in `localStorage` instead (`demoSeen.ts`). Either way it is read once
 * per mount and starts the tour by itself when the answer is no — which on the demo is
 * every fresh visitor, and on an install exactly the first run.
 *
 * The provider renders no chrome. `components/tour/TourCoachmark` is what is on screen.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useGames, useSetTourSeen, useTourState } from '@/lib/api/queries'
import { useRuntimeCapabilities } from '@/lib/runtime/capabilities'

import { readDemoTourSeen, writeDemoTourSeen } from './demoSeen'
import { routeFor, TOUR_STEPS, type TourStep } from './steps'

/**
 * How long a step waits for its element before giving up on it.
 *
 * Long enough for a lazily-loaded route to arrive over a slow connection and for the query
 * behind it to answer, short enough that a step which is never coming does not read as the
 * tour having hung.
 */
export const ANCHOR_WAIT_MS = 2500
/** How often it looks while it waits. A frame would be wasteful; this is imperceptible. */
export const ANCHOR_POLL_MS = 80

export interface TourValue {
  /** The step on screen, or null whenever the tour is not running. */
  step: TourStep | null
  /** Its place in the tour, 1-based, for the "2 of 5" counter. */
  position: number
  total: number
  /** The element the step is about. Null while it is still being looked for. */
  anchor: HTMLElement | null
  next: () => void
  back: () => void
  /** Finish or skip — both mean "do not show me this again". */
  dismiss: () => void
  /** Settings' "Show the tour again". */
  replay: () => void
}

const TourContext = createContext<TourValue | null>(null)

export function useTour(): TourValue {
  const value = useContext(TourContext)
  if (!value) throw new Error('useTour must be used inside <TourProvider>')
  return value
}

export function TourProvider({ children }: { children: ReactNode }) {
  const { read_only: demo, mcp } = useRuntimeCapabilities()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // null is "not running". Nothing else distinguishes a tour that has finished from one
  // that was never started: both are the app with no overlay on it.
  const [index, setIndex] = useState<number | null>(null)
  const [direction, setDirection] = useState<1 | -1>(1)
  // Bumped whenever a step is abandoned without the index moving, so the effect below runs
  // again for what is otherwise the same state — see the backwards case in `skip`.
  const [attempt, setAttempt] = useState(0)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const running = index !== null

  // The game the board step opens. Only while the tour is up: on every other screen this is
  // a request nobody asked for. The rail asks for the same page, so on a desktop window it
  // is usually already in the cache.
  const games = useGames({ limit: 1 }, { enabled: running })
  const latestGameId = games.data?.games[0]?.id ?? null
  // Everything a step needs to answer "can I be shown here, and where". A deployment with
  // MCP switched off has no assistant page, which is a step skipped rather than a route
  // that redirects out from under the coachmark.
  const context = useMemo(() => ({ latestGameId, mcp }), [latestGameId, mcp])
  // A step is only resolved once the library has answered; otherwise the board step would
  // be skipped for an empty library before the first page of games had landed.
  const contextReady = !running || !games.isPending

  const stored = useTourState({ enabled: !demo })
  // The mutation's `mutate` rather than the mutation: the object is new on every render,
  // and this ends up in the dependency list of the effect that drives the whole tour.
  const { mutate: saveSeen } = useSetTourSeen()
  const seen = demo ? undefined : stored.data?.seen
  const [demoSeen, setDemoSeen] = useState(() => (demo ? readDemoTourSeen() : true))

  const remember = useCallback(
    (value: boolean) => {
      if (demo) {
        setDemoSeen(value)
        writeDemoTourSeen(value)
        return
      }
      saveSeen(value)
    },
    [demo, saveSeen],
  )

  const stop = useCallback(() => {
    setIndex(null)
    setAnchor(null)
  }, [])

  const dismiss = useCallback(() => {
    stop()
    remember(true)
  }, [remember, stop])

  const start = useCallback(() => {
    setDirection(1)
    setAnchor(null)
    setIndex(0)
  }, [])

  /**
   * "Show the tour again" forgets the flag as well as starting the tour: somebody who asked
   * for it and then reloaded halfway through has not seen it, and the alternative is a
   * button whose effect a refresh silently undoes.
   */
  const replay = useCallback(() => {
    remember(false)
    start()
  }, [remember, start])

  // Started once per mount, and only ever from "nobody has seen this". The ref is what
  // keeps a refetch of the flag — or the demo's own state changing — from starting the tour
  // a second time over an owner who has just skipped it.
  const autoStarted = useRef(false)
  useEffect(() => {
    if (autoStarted.current) return
    const answer = demo ? demoSeen : seen
    if (answer === undefined) return
    autoStarted.current = true
    if (!answer) start()
  }, [demo, demoSeen, seen, start])

  const step = index === null ? null : (TOUR_STEPS[index] ?? null)
  // Which step's navigation has already been asked for — see the route block below.
  const navigated = useRef<string | null>(null)

  /**
   * Get to the current step, or give up on it.
   *
   * One effect rather than three, because the three are one sequence and each of them can
   * end it: resolve where the step lives, navigate if we are not there, then watch for the
   * element. A route change re-runs the effect, which is how the navigation and the watch
   * are joined without a second piece of state saying which half we are in.
   */
  useEffect(() => {
    if (index === null || !contextReady) return
    if (!step) {
      // Walked off the end: the tour is over and it counts as seen.
      dismiss()
      return
    }

    const skip = () => {
      const next = index + direction
      if (next >= TOUR_STEPS.length) {
        dismiss()
        return
      }
      if (next < 0) {
        // Nothing before the first step to fall back to, so the only way out of a missing
        // anchor here is forwards. The attempt bump is what re-runs this effect on an index
        // that has not moved.
        setDirection(1)
        setAttempt((count) => count + 1)
        return
      }
      setIndex(next)
    }

    const route = routeFor(step, context)
    if (route === null) {
      skip()
      return
    }
    // At most one navigation per attempt at a step, and the watch below runs either way: a
    // route that answers with a redirect somewhere else would otherwise be navigated to
    // again on every pathname change, and a step whose screen never arrives would sit
    // there rather than timing out like any other missing anchor.
    const token = `${index}:${attempt}:${route}`
    if (route !== undefined && route !== pathname && navigated.current !== token) {
      navigated.current = token
      navigate(route)
    }

    setAnchor(null)
    let timer = 0
    const deadline = Date.now() + ANCHOR_WAIT_MS
    const look = () => {
      const found = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`)
      if (found) {
        setAnchor(found)
        return
      }
      if (Date.now() >= deadline) {
        skip()
        return
      }
      timer = window.setTimeout(look, ANCHOR_POLL_MS)
    }
    look()
    return () => window.clearTimeout(timer)
    // `attempt` is deliberately a dependency and used nowhere in the body: it is the only
    // thing that changes when a backwards skip leaves the index where it was.
  }, [index, step, direction, attempt, context, contextReady, pathname, navigate, dismiss])

  const next = useCallback(() => {
    setDirection(1)
    setAnchor(null)
    setIndex((current) => (current === null ? null : current + 1))
  }, [])

  const back = useCallback(() => {
    setDirection(-1)
    setAnchor(null)
    setIndex((current) => (current === null || current === 0 ? current : current - 1))
  }, [])

  const value = useMemo<TourValue>(
    () => ({
      step,
      position: (index ?? 0) + 1,
      total: TOUR_STEPS.length,
      anchor,
      next,
      back,
      dismiss,
      replay,
    }),
    [step, index, anchor, next, back, dismiss, replay],
  )

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>
}

/**
 * What the tour looks like: one card beside one highlighted thing, over a dimmed app.
 *
 * A coachmark rather than a modal with a screenshot in it, because the point is the actual
 * screen — the queue card the owner will look at tomorrow, not a picture of one. So the
 * dimming is four panels around a hole rather than a scrim with a cut-out image: the thing
 * being explained is the app itself, at full brightness, in the place it lives.
 *
 * The overlay is modal on purpose. The hole is covered by a transparent panel of its own,
 * so a click on the highlighted control does nothing: a tour that let you press the button
 * it was describing would be a tour whose next step is about a screen you have left.
 *
 * Where the card stands is `lib/tour/place.ts` — it prefers the side the step names and
 * flips when there is no room, which is what makes the same five steps work on a phone.
 * Everything here is measured every frame while the tour is up: the app underneath keeps
 * laying out (a queue row arrives, a board finishes sizing itself), and a card pointing at
 * where something used to be is worse than no card.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'

import { place, type Box, type Size } from '@/lib/tour/place'
import { useTour } from '@/lib/tour/TourProvider'
import { cn } from '@/lib/utils'

/** Breathing room between the highlighted element and the hole cut around it. */
const PAD = 6

interface Metrics {
  anchor: Box
  card: Size
  viewport: Size
}

function same(left: Metrics | null, right: Metrics): boolean {
  if (!left) return false
  return (
    left.anchor.left === right.anchor.left &&
    left.anchor.top === right.anchor.top &&
    left.anchor.width === right.anchor.width &&
    left.anchor.height === right.anchor.height &&
    left.card.width === right.card.width &&
    left.card.height === right.card.height &&
    left.viewport.width === right.viewport.width &&
    left.viewport.height === right.viewport.height
  )
}

/** The dim. Four panels, because the fifth rectangle is the one that must stay lit. */
function Scrim({ hole, viewport }: { hole: Box; viewport: Size }) {
  const bottom = hole.top + hole.height
  const right = hole.left + hole.width
  const panels: Box[] = [
    { left: 0, top: 0, width: viewport.width, height: Math.max(0, hole.top) },
    { left: 0, top: bottom, width: viewport.width, height: Math.max(0, viewport.height - bottom) },
    { left: 0, top: hole.top, width: Math.max(0, hole.left), height: hole.height },
    { left: right, top: hole.top, width: Math.max(0, viewport.width - right), height: hole.height },
  ]
  return (
    <>
      {panels.map((panel, index) => (
        <div
          key={index}
          aria-hidden
          className="fixed bg-void/80"
          style={{
            left: panel.left,
            top: panel.top,
            width: panel.width,
            height: panel.height,
          }}
        />
      ))}
    </>
  )
}

const BUTTON =
  'rounded-md border border-input bg-elevated px-2.5 py-[0.3125rem] text-[0.6875rem] text-soft transition-colors hover:border-edge-hover hover:text-ink'

export function TourCoachmark() {
  const { step, position, total, anchor, next, back, dismiss } = useTour()
  const card = useRef<HTMLDivElement>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)

  // A fresh step measures from nothing, so the card is never placed for one frame against
  // the previous step's anchor.
  useLayoutEffect(() => setMetrics(null), [step?.id])

  useEffect(() => {
    if (!anchor) return
    let frame = 0
    const tick = () => {
      const box = anchor.getBoundingClientRect()
      const own = card.current?.getBoundingClientRect()
      const taken: Metrics = {
        anchor: { left: box.left, top: box.top, width: box.width, height: box.height },
        card: { width: own?.width ?? 0, height: own?.height ?? 0 },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }
      setMetrics((current) => (same(current, taken) ? current : taken))
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [anchor])

  // The step's element may be below the fold — the queue card on a phone, a pane the page
  // scrolls. Nothing else brings it into view, because the tour is what did the navigating.
  useEffect(() => {
    anchor?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [anchor])

  // Focus follows the step, so a keyboard reaches Next without tabbing through the app
  // behind the dim, and Escape has something to be pressed against. On the next frame
  // rather than on this one: a step that navigated has just made the shell put focus on the
  // page landmark (`AppShell`), which it also does from a frame.
  useEffect(() => {
    if (!anchor) return
    const frame = requestAnimationFrame(() => card.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [anchor, step?.id])

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        dismiss()
        return
      }
      if (event.key !== 'Tab') return
      // The overlay is modal, so Tab stays inside it rather than walking into an app the
      // reader cannot click anyway.
      const focusable = card.current?.querySelectorAll<HTMLElement>('button')
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === card.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    },
    [dismiss],
  )

  if (!step || !anchor) return null

  const hole: Box = metrics
    ? {
        left: metrics.anchor.left - PAD,
        top: metrics.anchor.top - PAD,
        width: metrics.anchor.width + PAD * 2,
        height: metrics.anchor.height + PAD * 2,
      }
    : { left: 0, top: 0, width: 0, height: 0 }
  const at = metrics ? place(hole, metrics.card, metrics.viewport, step.side) : null
  const last = position >= total

  return (
    <div className="fixed inset-0 z-[70]" data-testid="tour">
      {metrics ? <Scrim hole={hole} viewport={metrics.viewport} /> : null}
      {/*
        Over the hole rather than around it: the ring says which thing is being talked
        about, and the same element is what stops a click reaching the control under it.
      */}
      <div
        aria-hidden
        className="fixed rounded-md ring-2 ring-accent-teal"
        style={{ left: hole.left, top: hole.top, width: hole.width, height: hole.height }}
      />
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cn(
          // Deliberately not `bb-card`: a coachmark that looks like every other pane is a
          // coachmark the eye slides off, and this one is standing on top of the app rather
          // than in it. So it takes the accent the spotlight ring is drawn in — which also
          // ties the card to the thing it is about — over a lifted surface and a shadow
          // deep enough to read as floating over the dim.
          'fixed flex w-[19rem] max-w-[calc(100vw-1.5rem)] flex-col gap-2 rounded-md border border-accent-teal/55 bg-elevated p-3.5 shadow-[0_1.25rem_3rem_var(--bb-shadow)] outline-none',
          // Placed off-screen for the frame it takes to measure itself, rather than at the
          // top-left corner where it would flash.
          at ? '' : 'opacity-0',
        )}
        style={at ? { left: at.left, top: at.top } : { left: 0, top: 0 }}
      >
        <p id="tour-title" className="text-[0.8125rem] font-semibold text-ink">
          {step.title}
        </p>
        <p className="text-[0.75rem] leading-relaxed text-soft">{step.body}</p>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-mono text-[0.625rem] tabular text-faint">
            {position} of {total}
          </span>
          <button type="button" onClick={dismiss} className="text-[0.6875rem] text-dim hover:text-ink">
            Skip
          </button>
          <span className="flex-1" />
          {position > 1 ? (
            <button type="button" onClick={back} className={BUTTON}>
              Back
            </button>
          ) : null}
          <button
            type="button"
            onClick={last ? dismiss : next}
            className="rounded-md bg-accent-teal px-2.5 py-[0.3125rem] text-[0.6875rem] font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
          >
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}

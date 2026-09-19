/**
 * The app's tooltips, for everything that carries a `title`.
 *
 * Two hundred-odd controls say what they are through `title=`, and until now the browser
 * drew every one of those: a second late, in the operating system's own box, in whichever
 * font and colours it liked, and never on a control that only had keyboard focus. The
 * themed `Tooltip` component was used three times. Rewriting every site to wrap itself in
 * a trigger and a portal would have been a very large diff to say the same words, so the
 * words stay where they are and one listener draws them.
 *
 * On the first hover (or keyboard focus) of an element with a `title`, the attribute is
 * moved to `data-title` — that is the only way to stop the browser drawing its own — and,
 * where the element had no other accessible name, the same text goes into `aria-label` so a
 * screen reader loses nothing. A React re-render that changes the label writes `title`
 * afresh, and the next hover picks the new words up the same way. The box itself is one
 * fixed element under the pointer's control, centred beneath the control or above it when
 * the window ends first, and gone on leave, on Escape, on a press, and on any scroll.
 *
 * Touch gets nothing: there is no hover on a phone, and a box that appears under a finger
 * is a box in the way.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/** Long enough that sweeping the pointer across a toolbar does not light every button. */
const SHOW_AFTER_MS = 450
/** Once a tooltip is up, the next control's comes at once — the way menus behave. */
const SHOW_NEXT_MS = 80
/** The gap between the control and the box, and the box's distance from the window edge. */
const GAP_PX = 6
const MARGIN_PX = 8
const TOOLTIP_ID = 'bb-title-tooltip'

interface Tip {
  text: string
  /** The centre of the control, horizontally. */
  x: number
  /** The edge of the control the box hangs off. */
  y: number
  above: boolean
}

/** The words a control carries, taken out of the browser's hands the first time they are read. */
function takeTitle(element: Element): string | null {
  const title = element.getAttribute('title')
  if (title !== null) {
    element.setAttribute('data-title', title)
    element.removeAttribute('title')
    const named =
      element.hasAttribute('aria-label') ||
      element.hasAttribute('aria-labelledby') ||
      (element.textContent ?? '').trim() !== ''
    if (!named && title.trim() !== '') element.setAttribute('aria-label', title)
  }
  const text = element.getAttribute('data-title')
  return text && text.trim() !== '' ? text : null
}

export function TitleTooltips() {
  const [tip, setTip] = useState<Tip | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let anchor: Element | null = null
    let shown = false
    /** When the last tooltip went away, so the next one can come quickly. */
    let hiddenAt = 0

    const hide = () => {
      clearTimeout(timer)
      timer = undefined
      if (anchor?.getAttribute('aria-describedby') === TOOLTIP_ID) {
        anchor.removeAttribute('aria-describedby')
      }
      if (shown) hiddenAt = Date.now()
      shown = false
      anchor = null
      setTip(null)
    }

    const show = (element: Element) => {
      const text = takeTitle(element)
      if (!text || !element.isConnected) return
      const rect = element.getBoundingClientRect()
      const roomBelow = window.innerHeight - rect.bottom
      // A tooltip is a line or two; a control with less than that under it gets the box above.
      const above = roomBelow < 64 && rect.top > roomBelow
      anchor = element
      shown = true
      if (!element.hasAttribute('aria-describedby')) {
        element.setAttribute('aria-describedby', TOOLTIP_ID)
      }
      setTip({
        text,
        x: rect.left + rect.width / 2,
        y: above ? rect.top - GAP_PX : rect.bottom + GAP_PX,
        above,
      })
    }

    const arm = (element: Element) => {
      if (element === anchor) return
      hide()
      // The words are taken at hover rather than at show, so the browser never gets its
      // 500ms head start on a control the pointer is resting on.
      if (!takeTitle(element)) return
      anchor = element
      const delay = Date.now() - hiddenAt < SHOW_AFTER_MS ? SHOW_NEXT_MS : SHOW_AFTER_MS
      timer = setTimeout(() => show(element), delay)
    }

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const target = event.target instanceof Element ? event.target : null
      const element = target?.closest('[title], [data-title]')
      if (element) arm(element)
      else if (anchor) hide()
    }
    const onPointerOut = (event: PointerEvent) => {
      if (!anchor) return
      const to = event.relatedTarget
      if (to instanceof Node && anchor.contains(to)) return
      hide()
    }
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const element = target?.closest('[title], [data-title]')
      // Only a focus the keyboard put there: a click focuses too, and the pointer is
      // already handling that one.
      let visible = false
      try {
        visible = element?.matches(':focus-visible') ?? false
      } catch {
        visible = false
      }
      if (element && visible) arm(element)
    }
    const onFocusOut = () => hide()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }

    document.addEventListener('pointerover', onPointerOver, { passive: true })
    document.addEventListener('pointerout', onPointerOut, { passive: true })
    document.addEventListener('pointerdown', hide, { passive: true, capture: true })
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    document.addEventListener('keydown', onKeyDown, { capture: true })
    document.addEventListener('scroll', hide, { passive: true, capture: true })
    window.addEventListener('blur', hide)
    return () => {
      hide()
      document.removeEventListener('pointerover', onPointerOver)
      document.removeEventListener('pointerout', onPointerOut)
      document.removeEventListener('pointerdown', hide, { capture: true })
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('keydown', onKeyDown, { capture: true })
      document.removeEventListener('scroll', hide, { capture: true })
      window.removeEventListener('blur', hide)
    }
  }, [])

  if (!tip) return null

  // Centred on the control, then pulled back inside the window; the transform does the
  // centring so the width is never measured. Above the highest overlay (`z-[80]` is the
  // skip link), because a tooltip belongs to whatever is on top.
  const half = Math.min(tip.x - MARGIN_PX, window.innerWidth - MARGIN_PX - tip.x)
  return createPortal(
    <div
      id={TOOLTIP_ID}
      role="tooltip"
      style={{
        left: tip.x,
        top: tip.above ? undefined : tip.y,
        bottom: tip.above ? window.innerHeight - tip.y : undefined,
        maxWidth: Math.max(120, half * 2),
      }}
      className="bb-fade-in pointer-events-none fixed z-[90] max-w-[20rem] -translate-x-1/2 rounded-md border border-edge bg-elevated px-2 py-1 text-[0.6875rem] leading-snug text-body shadow-[0_0.375rem_1.125rem_var(--bb-shadow)]"
    >
      {tip.text}
    </div>,
    document.body,
  )
}

import { useLingui } from '@lingui/react/macro'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * One ArrowLeft/ArrowRight press, in rendered pixels. Sixteen is a nudge you can see
 * landing without being able to cross a column floor in a single press.
 */
const NUDGE_PX = 16

/**
 * The boundary between two columns, as something to grab: the hairline that used to be a
 * border, with five design pixels of padding either side so it can be caught by a pointer
 * that is not quite on the line.
 *
 * It knows nothing about what it separates. A drag reports how far the pointer has
 * travelled since it went down, and whoever owns the width decides what that is worth —
 * which is what keeps the floors, the container and the clamping in one place, the page
 * that has them, rather than half here.
 *
 * A hairline alone did not say it could be moved: nobody finds a resize they were never
 * shown, and the only hint was a cursor that changes once the pointer is already on the
 * line. So the line carries a short grip at its middle — three design pixels of the same
 * rule colour, quiet at rest — that turns the interaction blue under the pointer, with the
 * keyboard on it, and for as long as a drag lasts (`data-dragging`, since a drag that
 * outruns the strip is no longer hovering it). The title says the two gestures it takes.
 */
export function ColumnSplitter({
  label,
  onResizeStart,
  onResize,
  onResizeEnd,
  onReset,
  className,
}: {
  /** What a screen reader calls it — the column it moves, not the line it draws. */
  label: string
  /** A drag or a key nudge begins: the owner snapshots the width the deltas offset. */
  onResizeStart: () => void
  /** Pointer travel since `onResizeStart`, in rendered pixels; rightwards is positive. */
  onResize: (deltaPx: number) => void
  /** The drag is over — where the owner persists what it settled on. */
  onResizeEnd: () => void
  /** Double-click: back to the default width. */
  onReset: () => void
  className?: string
}) {
  const { t } = useLingui()
  /** Where the pointer went down. Null between drags, which is also "not dragging". */
  const origin = useRef<number | null>(null)
  /** The same fact as state, for the grip — a ref does not re-render anything. */
  const [dragging, setDragging] = useState(false)

  useEffect(
    () => () => {
      // Unmounted mid-drag — the page gets its selection back anyway.
      if (origin.current !== null) document.body.style.userSelect = ''
    },
    [],
  )

  const stop = () => {
    if (origin.current === null) return
    origin.current = null
    setDragging(false)
    document.body.style.userSelect = ''
    onResizeEnd()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={t`Drag to resize · double-click to reset`}
      tabIndex={0}
      data-dragging={dragging ? '' : undefined}
      className={cn(
        'group flex flex-none cursor-col-resize touch-none justify-center px-[0.3125rem] select-none',
        className,
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        // Captured, so a drag that outruns an eleven-pixel strip — or leaves the window —
        // keeps reporting here instead of being dropped where the pointer went.
        event.currentTarget.setPointerCapture(event.pointerId)
        origin.current = event.clientX
        setDragging(true)
        // A drag across two columns of text would otherwise select them both.
        document.body.style.userSelect = 'none'
        onResizeStart()
      }}
      onPointerMove={(event) => {
        if (origin.current === null) return
        onResize(event.clientX - origin.current)
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        const step =
          event.key === 'ArrowLeft' ? -NUDGE_PX : event.key === 'ArrowRight' ? NUDGE_PX : 0
        if (step === 0) return
        event.preventDefault()
        // The board's own arrow keys are bound on `window` and would step the game under
        // the press; with focus on the separator the arrows mean the separator.
        event.stopPropagation()
        // A press is a drag that starts and ends on the spot, so the owner clamps it by
        // exactly the path a drag takes.
        onResizeStart()
        onResize(step)
        onResizeEnd()
      }}
    >
      {/* At rest it is the workspace's own board/moves rule, in the weight every other
          boundary on the screen carries; under the pointer it darkens to say it can be
          dragged. The grip sits on its middle and is the part that answers in blue. */}
      <span className="relative w-px flex-none bg-edge-strong transition-colors group-hover:bg-edge-hover">
        <span
          data-testid="splitter-grip"
          aria-hidden
          className="absolute top-1/2 left-1/2 h-8 w-[0.1875rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-edge-strong transition-colors group-hover:bg-accent-teal group-focus-visible:bg-accent-teal group-data-[dragging]:bg-accent-teal"
        />
      </span>
    </div>
  )
}

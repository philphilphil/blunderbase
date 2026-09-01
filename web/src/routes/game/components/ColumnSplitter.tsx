import { useEffect, useRef } from 'react'

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
  /** Where the pointer went down. Null between drags, which is also "not dragging". */
  const origin = useRef<number | null>(null)

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
    document.body.style.userSelect = ''
    onResizeEnd()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
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
          dragged. */}
      <span className="w-px flex-none bg-edge-strong transition-colors group-hover:bg-edge-hover" />
    </div>
  )
}

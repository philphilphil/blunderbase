import { useEffect, useMemo, useRef } from 'react'

import { Board, type BoardArrow, type BoardSquare } from '@/components/board/Board'
import type { MoveRow } from '@/lib/api/types'
import { glyphFor } from '@/lib/chess/classification'
import { formatScore, type Score } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

import { sameMove, type MaiaLevel, type PlyPosition, type Side } from '../gameModel'
import { EvalBar } from './EvalBar'

export interface BoardPanelProps {
  position: PlyPosition
  orientation: Side
  /** The move that produced this position, for the last-move highlight. */
  lastMove: MoveRow | undefined
  /** The move about to be played — what Maia and the flags describe. */
  upcoming: MoveRow | undefined
  /**
   * The engine's own move in the position on the board, in UCI: the first move of the top
   * stored line. Null where nothing has analysed this position — the board then says
   * nothing rather than pointing at a move no engine ever recommended.
   */
  engineBest: string | null
  /** A line being hovered in one of the engine panels, previewed as its own arrow. */
  hoverMove?: string | null
  maia: MaiaLevel | null
  win: number | null
  score: Score | null
  /** `-1` for the starting position. */
  cursor: number
  plyCount: number
  hints: boolean
  onHintsChange: (hints: boolean) => void
  onFlip: () => void
  onSeek: (cursor: number) => void
  className?: string
}

/**
 * Wheel travel — in CSS pixels, whatever the device reports in — that counts as one move.
 * A mouse notch is 100 or so and steps once; a trackpad's stream of small deltas is added
 * up to the same threshold and then reset, so one flick is one move rather than ten.
 */
const WHEEL_STEP = 60

/**
 * The board column's middle band: eval bar, board with its overlays, and the transport
 * toolbar. Square marks follow design 1c — the flagged move's two squares outlined in its
 * own colour, the engine's target and Maia's target as a teal and a purple mark.
 *
 * The arrows are about the position on the board, never about the move that happens next:
 * an arrow means "this is what the engine would play here". Maia's arrow is the same claim
 * for a human of the owner's rating, and is left out when the two agree.
 */
export function BoardPanel({
  position,
  orientation,
  lastMove,
  upcoming,
  engineBest,
  hoverMove,
  maia,
  win,
  score,
  cursor,
  plyCount,
  hints,
  onHintsChange,
  onFlip,
  onSeek,
  className,
}: BoardPanelProps) {
  const squares = useMemo<BoardSquare[]>(() => {
    const marks = new Map<string, string>()
    if (hints) {
      const maiaTop = maia?.moves[0]?.uci
      if (maiaTop) marks.set(maiaTop.slice(2, 4), 'bb-maia')
      if (engineBest) marks.set(engineBest.slice(2, 4), 'bb-engine')
    }
    const glyph = glyphFor(upcoming?.classification)
    if (glyph && upcoming?.uci && glyph !== 'best' && glyph !== 'brilliant') {
      marks.set(upcoming.uci.slice(0, 2), `bb-${glyph}`)
      marks.set(upcoming.uci.slice(2, 4), `bb-${glyph}`)
    }
    return [...marks].map(([square, className]) => ({ square, className }))
  }, [engineBest, hints, maia, upcoming])

  const arrows = useMemo<BoardArrow[]>(() => {
    const drawn: BoardArrow[] = []
    if (hints) {
      if (engineBest) {
        drawn.push({ from: engineBest.slice(0, 2), to: engineBest.slice(2, 4), color: 'accent' })
      }
      const maiaTop = maia?.moves[0]?.uci
      if (maiaTop && !(engineBest && sameMove(maiaTop, engineBest))) {
        drawn.push({ from: maiaTop.slice(0, 2), to: maiaTop.slice(2, 4), color: 'paleMaia' })
      }
    }
    // The hover preview is an answer to something the reader is doing right now, so it is
    // drawn whether or not the standing hints are on — but never twice over its own arrow.
    if (hoverMove && !(hints && engineBest && sameMove(hoverMove, engineBest))) {
      drawn.push({ from: hoverMove.slice(0, 2), to: hoverMove.slice(2, 4), color: 'paleAccent' })
    }
    return drawn
  }, [engineBest, hints, hoverMove, maia])

  // Wheeling over the board steps the game: down is forwards, the way a move list reads.
  // The listener is attached by hand because React's `onWheel` is passive, and a passive
  // listener cannot stop the page from scrolling underneath the gesture.
  const column = useRef<HTMLDivElement>(null)
  // The listener is bound once, so the current cursor lives behind a ref (as in `Board`).
  const seeking = useRef({ cursor, onSeek })
  useEffect(() => {
    seeking.current = { cursor, onSeek }
  })
  const travel = useRef(0)

  useEffect(() => {
    const node = column.current
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
      seeking.current.onSeek(seeking.current.cursor + step)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div ref={column} className={cn('flex flex-col gap-3.5', className)}>
      <div className="flex items-start gap-2.5">
        <EvalBar win={win} score={score} className="self-stretch" />
        {/* Nothing floats over the squares: Maia's prediction is a panel of its own, under
            the engine lines, and only its target square is marked here. */}
        <Board
          fen={position.fen}
          orientation={orientation}
          lastMove={lastMove?.uci ?? null}
          squares={squares}
          arrows={arrows}
          turnColor={position.turn}
          check={position.check ? position.turn : false}
          coordinates="edge"
          className="min-w-0 flex-1"
        />
      </div>

      <div className="flex items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-edge bg-elevated">
          <TransportButton label="First" disabled={cursor < 0} onClick={() => onSeek(-1)}>
            ⏮
          </TransportButton>
          <TransportButton label="Previous" disabled={cursor < 0} onClick={() => onSeek(cursor - 1)}>
            ◀
          </TransportButton>
          <TransportButton
            label="Next"
            disabled={cursor >= plyCount - 1}
            onClick={() => onSeek(cursor + 1)}
          >
            ▶
          </TransportButton>
          <TransportButton
            label="Last"
            last
            disabled={cursor >= plyCount - 1}
            onClick={() => onSeek(plyCount - 1)}
          >
            ⏭
          </TransportButton>
        </div>

        <button
          type="button"
          onClick={onFlip}
          className="rounded-md border border-edge bg-elevated px-2.5 py-[0.3125rem] text-xs text-soft hover:text-ink"
        >
          ⇅ Flip
        </button>

        <button
          type="button"
          onClick={() => onHintsChange(!hints)}
          aria-pressed={hints}
          title="Engine and Maia marks on the board"
          className={cn(
            'rounded-md border px-2.5 py-[0.3125rem] text-xs',
            hints
              ? 'border-accent-teal/30 bg-accent-teal/10 text-accent-teal'
              : 'border-edge bg-elevated text-dim hover:text-ink',
          )}
        >
          Hints
        </button>

        <div className="flex-1" />
        <span className="font-mono text-[0.6875rem] tabular text-dim">
          ply {cursor + 1} / {plyCount}
        </span>
        <span className="rounded-sm border border-edge bg-chip-info px-1.5 py-0.5 font-mono text-[0.6875rem] tabular text-ink">
          {formatScore(score)}
        </span>
      </div>
    </div>
  )
}

function TransportButton({
  children,
  label,
  disabled,
  last,
  onClick,
}: {
  children: string
  label: string
  disabled?: boolean
  last?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'px-2.5 py-[0.3125rem] text-xs text-soft hover:bg-selected hover:text-ink disabled:cursor-default disabled:text-faint-2 disabled:hover:bg-transparent',
        !last && 'border-r border-edge',
      )}
    >
      {children}
    </button>
  )
}

import { useMemo } from 'react'

import { Board, type BoardArrow, type BoardSquare } from '@/components/board/Board'
import type { MoveRow } from '@/lib/api/types'
import { glyphFor } from '@/lib/chess/classification'
import { formatScore, type Score } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

import type { MaiaLevel, PlyPosition, Side } from '../gameModel'
import { EvalBar } from './EvalBar'
import { MaiaOverlay } from './MaiaOverlay'

export interface BoardPanelProps {
  position: PlyPosition
  orientation: Side
  /** The move that produced this position, for the last-move highlight. */
  lastMove: MoveRow | undefined
  /** The move about to be played — what the engine, Maia and the flags all describe. */
  upcoming: MoveRow | undefined
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
 * The board column's middle band: eval bar, board with its overlays, and the transport
 * toolbar. Square marks follow design 1c — the flagged move's two squares outlined in its
 * own colour, the engine's target and Maia's target as a teal and a purple mark.
 */
export function BoardPanel({
  position,
  orientation,
  lastMove,
  upcoming,
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
      const best = upcoming?.best_move_uci
      if (best) marks.set(best.slice(2, 4), 'bb-engine')
    }
    const glyph = glyphFor(upcoming?.classification)
    if (glyph && upcoming?.uci && glyph !== 'best' && glyph !== 'brilliant') {
      marks.set(upcoming.uci.slice(0, 2), `bb-${glyph}`)
      marks.set(upcoming.uci.slice(2, 4), `bb-${glyph}`)
    }
    return [...marks].map(([square, className]) => ({ square, className }))
  }, [hints, maia, upcoming])

  const arrows = useMemo<BoardArrow[]>(() => {
    if (!hints) return []
    const drawn: BoardArrow[] = []
    const best = upcoming?.best_move_uci
    if (best) drawn.push({ from: best.slice(0, 2), to: best.slice(2, 4), color: 'paleAccent' })
    const maiaTop = maia?.moves[0]?.uci
    if (maiaTop && (!best || maiaTop.slice(0, 4) !== best.slice(0, 4))) {
      drawn.push({ from: maiaTop.slice(0, 2), to: maiaTop.slice(2, 4), color: 'paleMaia' })
    }
    return drawn
  }, [hints, maia, upcoming])

  return (
    <div className={cn('flex flex-col gap-3.5', className)}>
      <div className="flex items-start gap-2.5">
        <EvalBar win={win} score={score} className="self-stretch" />
        {/* The overlay is a child of the board so it is positioned against the squares
            rather than against the rank rail beside them. */}
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
        >
          {hints && maia ? <MaiaOverlay level={maia} played={upcoming} /> : null}
        </Board>
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

import type { MoveRow } from '@/lib/api/types'
import { glyphStyle } from '@/lib/chess/classification'
import { cn } from '@/lib/utils'

import { sameMove, type MaiaLevel } from '../gameModel'

const OVERLAY_MOVES = 3

/**
 * The human-model card that floats over the board in design 1a: what a player of this
 * rating plays here, and how often. Purple is the Maia/deep hue throughout the app.
 *
 * `played` is the move actually made from this position, so the card can colour its own
 * prediction with the verdict the engine later gave it — the "it called your move before
 * you made it" line only earns its place when the prediction was the blunder.
 */
export function MaiaOverlay({
  level,
  played,
  className,
}: {
  level: MaiaLevel
  played: MoveRow | undefined
  className?: string
}) {
  const shown = level.moves.slice(0, OVERLAY_MOVES)
  const top = shown[0]
  if (!top) return null

  const playedUci = played?.uci ?? null
  const predictedThePlayed = playedUci !== null && sameMove(top.uci, playedUci)
  const verdict = predictedThePlayed ? glyphStyle(played?.classification) : null

  return (
    <div
      className={cn(
        'pointer-events-none absolute left-2.5 top-2.5 flex w-[15.375rem] flex-col gap-2 rounded-lg border border-edge-strong bg-panel/93 p-[0.6875rem_0.75rem] shadow-[0_1rem_2.5rem_-0.75rem_var(--bb-shadow)] backdrop-blur-[0.375rem]',
        className,
      )}
      data-testid="maia-overlay"
    >
      <div className="flex items-center gap-[0.4375rem]">
        <span className="size-1.5 rounded-full bg-brilliant" />
        <span className="text-[0.6875rem] font-semibold tracking-[0.02em] text-ink">
          Maia {level.rating}
        </span>
        <div className="flex-1" />
        <span className="font-mono text-[0.625rem] text-faint">human model</span>
      </div>

      <div className="text-[0.75rem] leading-[1.45] text-body-3">
        A {level.rating} plays{' '}
        <span className={cn('font-mono', verdict ? verdict.textClass : 'text-ink')}>{top.san}</span>{' '}
        here
        {top.probability !== null ? (
          <>
            {' — '}
            <span className="font-mono tabular text-ink">{percent(top.probability)}</span>
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        {shown.map((move) => {
          const isPlayed = playedUci !== null && sameMove(move.uci, playedUci)
          const tone = isPlayed && verdict ? verdict.color : 'var(--bb-faint-2)'
          const share = move.probability ?? 0
          return (
            <div key={move.uci} className="flex items-center gap-2">
              <span className="w-11 truncate font-mono text-[0.625rem] text-soft">{move.san}</span>
              <div className="h-1 flex-1 overflow-hidden rounded-[0.125rem] bg-track">
                <div
                  className="h-full rounded-[0.125rem]"
                  style={{ width: `${Math.min(100, share * 100)}%`, background: tone }}
                />
              </div>
              <span className="w-[1.625rem] text-right font-mono text-[0.625rem] tabular text-dim">
                {move.probability === null ? '—' : Math.round(move.probability * 100)}
              </span>
            </div>
          )
        })}
      </div>

      {predictedThePlayed ? (
        <div className="border-t border-line pt-[0.4375rem] text-[0.6875rem] italic text-dim-2">
          It called your move before you made it.
        </div>
      ) : null}
    </div>
  )
}

function percent(probability: number): string {
  return `${Math.round(probability * 100)}%`
}

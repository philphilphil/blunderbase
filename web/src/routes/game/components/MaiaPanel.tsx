import type { MoveRow } from '@/lib/api/types'
import { glyphStyle } from '@/lib/chess/classification'
import { cn } from '@/lib/utils'

import { sameMove, type MaiaLevel } from '../gameModel'

const PANEL_MOVES = 3

/**
 * The human model, as a panel under the engine's own lines: what a player of this rating
 * plays here, and how often. Purple is the Maia/deep hue throughout the app.
 *
 * It used to float over the board. It reads better stacked with the two engine panels —
 * the same position, three claims about it — and the board keeps its squares to itself.
 *
 * `played` is the move actually made from this position, so the panel can colour its own
 * prediction with the verdict the engine later gave it — the "it called your move before
 * you made it" line only earns its place when the prediction was the blunder.
 */
export function MaiaPanel({
  level,
  played,
  className,
}: {
  level: MaiaLevel
  played: MoveRow | undefined
  className?: string
}) {
  const shown = level.moves.slice(0, PANEL_MOVES)
  const top = shown[0]
  if (!top) return null

  const playedUci = played?.uci ?? null
  const predictedThePlayed = playedUci !== null && sameMove(top.uci, playedUci)
  const verdict = predictedThePlayed ? glyphStyle(played?.classification) : null

  return (
    <div
      className={cn(
        'flex flex-none flex-col gap-2 border-t border-hairline bg-panel px-3 py-2.5',
        className,
      )}
      data-testid="maia-panel"
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

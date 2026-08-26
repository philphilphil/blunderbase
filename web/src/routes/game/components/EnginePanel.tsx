import type { GameRunSummary } from '@/lib/api/types'
import { glyphStyle, isFlagged } from '@/lib/chess/classification'
import { formatNodes, formatScore } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

import { plyLabel, type EngineLineView } from '../gameModel'

/**
 * A glyph colour at a fraction of its opacity. The colours are `var(--bb-…)` tokens, so the
 * design's `rgba(240,82,74,.06)` tints have to be mixed rather than written as a hex-alpha
 * suffix — and mixing keeps them right in both themes, where the token itself changes.
 */
function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`
}

/**
 * The engine panel pinned under the move list: which run is speaking, what it spent, and
 * its multi-PV lines for the position on the board. The move actually played is always the
 * last row, marked `played`, so a blunder reads as "these were the options, this happened".
 */
export function EnginePanel({
  run,
  lines,
  ply,
  className,
}: {
  /** The run whose evals the current ply is showing, if any. */
  run: GameRunSummary | null
  lines: EngineLineView[]
  /** The ply the lines start from — the move about to be played. */
  ply: number
  className?: string
}) {
  const nodes = formatNodes(run?.nodes)

  return (
    <div className={cn('flex flex-none flex-col border-t border-hairline bg-panel', className)}>
      <div className="flex items-center gap-2 px-3 pb-2 pt-2.5">
        <span
          className={cn('size-1.5 rounded-full', run ? 'bg-accent-teal' : 'bg-edge-strong')}
        />
        <span className="text-xs font-semibold text-ink">{run?.engine ?? 'No engine run'}</span>
        {run?.engine_kind ? (
          <span className="font-mono text-[0.625rem] uppercase text-faint">{run.engine_kind}</span>
        ) : null}
        <div className="flex-1" />
        {run?.depth ? (
          <span className="font-mono text-[0.625rem] tabular text-dim">d{run.depth}</span>
        ) : null}
        {nodes !== '—' ? (
          <span className="font-mono text-[0.625rem] tabular text-dim">{nodes} nodes</span>
        ) : null}
        {run?.multipv ? (
          <span className="rounded-sm border border-edge px-[0.3125rem] py-px font-mono text-[0.625rem] tabular text-dim">
            MPV {run.multipv}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col px-1.5 pb-1.5 font-mono text-[0.71875rem]">
        {lines.length === 0 ? (
          <p className="px-1.5 py-3 text-center font-sans text-[0.71875rem] text-dim">
            No engine lines for this position.
          </p>
        ) : null}
        {lines.map((line) => {
          // A played move is only drawn in its own colour when the engine had something
          // against it: playing the top line is not a warning, and `best` is a compliment,
          // so only the flagged classifications tint the row.
          const verdict =
            line.played && isFlagged(line.classification)
              ? glyphStyle(line.classification)
              : null
          return (
            <div
              key={`${line.multipv}-${line.firstUci ?? 'x'}`}
              data-testid={line.played ? 'engine-played-line' : undefined}
              className={cn(
                'flex h-[1.625rem] items-center gap-[0.5625rem] rounded-[0.3125rem] px-1.5',
                verdict ? null : 'hover:bg-raised',
              )}
              style={verdict ? { background: tint(verdict.color, 6) } : undefined}
            >
              <span
                className={cn(
                  'min-w-11 rounded-[0.1875rem] px-1.5 py-0.5 text-right tabular',
                  verdict
                    ? ''
                    : line.multipv === 1
                      ? 'bg-cell-strong text-ink-2'
                      : 'bg-cell text-body-3',
                )}
                style={
                  verdict ? { background: tint(verdict.color, 13), color: verdict.color } : undefined
                }
              >
                {formatScore(line.score)}
              </span>
              <span className="flex-1 truncate text-soft" title={line.text || plyLabel(ply)}>
                {line.text || '—'}
              </span>
              {line.played ? (
                <span
                  className={cn(
                    'flex-none rounded-[0.1875rem] border px-1 py-px text-[0.59375rem]',
                    verdict ? '' : 'border-edge text-dim',
                  )}
                  style={
                    verdict
                      ? { borderColor: tint(verdict.color, 35), color: verdict.color }
                      : undefined
                  }
                >
                  played
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

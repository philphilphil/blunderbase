import { ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { SourceBadge } from '@/components/badges/SourceBadge'
import type { GameSummary, LiveState } from '@/lib/api/types'
import { cn } from '@/lib/utils'

import { isVariation, plyLabel } from './live'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-hairline py-1.5 last:border-b-0">
      <span className="w-20 flex-none text-[0.6875rem] text-dim">{label}</span>
      <div className="min-w-0 flex-1 text-right text-[0.75rem] text-body">{children}</div>
    </div>
  )
}

/**
 * What the live board is: the game and ply it follows, the moves played past it, and the
 * marks currently drawn on it.
 */
export function SessionMeta({
  state,
  game,
  className,
}: {
  state: LiveState
  game: GameSummary | undefined
  className?: string
}) {
  const marks = state.arrows.length + state.squares.length

  return (
    <section className={cn('flex flex-col rounded-xl border border-line bg-panel', className)}>
      <div className="flex items-center gap-2 border-b border-hairline px-3.5 py-2.5">
        <span className="text-xs font-semibold text-ink">Session</span>
        <div className="flex-1" />
        <span className="font-mono text-[0.625rem] text-dim tabular">
          {state.viewer_count} viewer{state.viewer_count === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex flex-col px-3.5 py-2">
        <Row label="Board">
          {state.game_id ? (
            <Link
              to={`/games/${state.game_id}`}
              className="inline-flex items-center gap-1.5 text-accent-teal hover:text-accent-link"
            >
              {game ? `${game.white ?? '?'} — ${game.black ?? '?'}` : `game ${state.game_id}`}
              <ExternalLink className="size-3" aria-hidden />
            </Link>
          ) : (
            <span className="text-soft">ad-hoc position</span>
          )}
        </Row>

        {game ? (
          <Row label="Source">
            <span className="inline-flex items-center gap-2">
              {game.opening ? (
                <span className="truncate text-[0.71875rem] text-soft-2">{game.opening}</span>
              ) : null}
              <SourceBadge source={game.source} size="sm" />
            </span>
          </Row>
        ) : null}

        <Row label="Ply">
          <span className="font-mono tabular">
            {typeof state.ply === 'number' ? `${state.ply} · ${plyLabel(state.ply)}` : '—'}
          </span>
        </Row>

        <Row label="To move">
          <span className={state.turn === 'black' ? 'text-soft' : 'text-bright'}>
            {state.turn ?? '—'}
          </span>
        </Row>

        <Row label="Last move">
          <span className="font-mono">{state.last_move ?? '—'}</span>
        </Row>

        <Row label="Marks">
          <span className="font-mono tabular text-soft">
            {state.arrows.length} arrow{state.arrows.length === 1 ? '' : 's'} ·{' '}
            {state.squares.length} square{state.squares.length === 1 ? '' : 's'}
          </span>
        </Row>
      </div>

      {state.moves.length > 0 ? (
        <div className="flex flex-col gap-1.5 border-t border-hairline px-3.5 py-2.5">
          <span className="text-[0.625rem] tracking-[0.1em] text-faint uppercase">
            {isVariation(state) ? 'Off the game' : 'Played'}
          </span>
          <div className="flex flex-wrap gap-1">
            {state.moves.map((move, index) => (
              <span
                key={`${move}-${index}`}
                className="rounded-sm border border-edge bg-elevated px-1.5 py-px font-mono text-[0.6875rem] text-soft"
              >
                {move}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {marks === 0 ? null : (
        <div className="flex flex-col gap-1 border-t border-hairline px-3.5 py-2.5">
          {state.arrows.map((arrow, index) => (
            <div key={`arrow-${index}`} className="flex items-center gap-2 font-mono text-[0.6875rem]">
              <span className="size-[0.375rem] rounded-full" style={{ background: color(arrow.color) }} />
              <span className="text-soft">
                {arrow.from}
                <span className="text-faint">→</span>
                {arrow.to}
              </span>
            </div>
          ))}
          {state.squares.map((square, index) => (
            <div key={`square-${index}`} className="flex items-center gap-2 font-mono text-[0.6875rem]">
              <span
                className="size-[0.375rem] rounded-[0.0625rem]"
                style={{ background: color(square.color) }}
              />
              <span className="text-soft">{square.square}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** The brush colours from `components/board/brushes.ts`, for the legend swatches. */
function color(brush: string): string {
  switch (brush) {
    case 'red':
      return 'var(--bb-blunder)'
    case 'blue':
      return 'var(--bb-info)'
    case 'yellow':
      return 'var(--bb-inaccuracy)'
    default:
      return 'var(--bb-good)'
  }
}

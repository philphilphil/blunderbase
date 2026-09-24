/**
 * The Board's move list: the mainline, with the one branch set off in brackets after the
 * move it leaves from, the way a printed game carries a variation.
 *
 * Every move is a button that puts the board there, so the list is how the owner walks a
 * pasted game as well as a line of their own — which is what the old "Game replay" mini
 * board did for a game the coach had put up, and why that board is gone. The branch stays
 * listed while the board is back on the mainline; it only goes when another is started.
 */
import { Trans, useLingui } from '@lingui/react/macro'

import type { LiveState } from '@/lib/api/types'
import { useNotation } from '@/lib/chess/notationPrefs'
import { cn } from '@/lib/utils'

import { moveNumber } from './live'

const TOKEN = 'rounded px-1 py-0.5 font-mono text-[0.71875rem] transition-colors'
const CURRENT = 'bg-accent-teal/20 text-ink'
const IDLE = 'text-soft hover:bg-elevated hover:text-ink'

export function BoardMoves({
  state,
  onGoto,
  className,
}: {
  state: LiveState
  onGoto: (ply: number, cursor: number) => void
  className?: string
}) {
  const { t } = useLingui()
  const notate = useNotation()
  const positions = state.line_positions ?? []
  const startFen = positions[0]?.fen
  const line = positions.slice(1)
  const branch = state.move_sans ?? []
  const base = branch.length > 0 ? (state.base ?? 0) : null
  const cursor = state.cursor ?? 0
  const ply = cursor > 0 ? (base ?? 0) : (state.ply ?? 0)

  if (line.length === 0 && branch.length === 0) {
    return (
      <p className={cn('text-[0.71875rem] leading-[1.55] text-dim', className)}>
        <Trans>Play a move on the board, or load a FEN or a PGN.</Trans>
      </p>
    )
  }

  // A number goes before every White move, and before a Black one that opens a run — the
  // first move of the list, of the branch, or of the mainline again after the branch.
  const label = (index: number, opensRun: boolean) => {
    const { number, white } = moveNumber(startFen, index)
    if (white) return `${number}.`
    return opensRun ? `${number}…` : null
  }

  const branchBlock =
    base === null ? null : (
      <span
        key="branch"
        className="mx-0.5 inline-flex flex-wrap items-baseline gap-x-0.5 rounded border-l-2 border-accent-teal/40 bg-elevated/60 px-1 py-0.5"
        aria-label={t`Your variation`}
      >
        {branch.map((san, index) => {
          const number = label(base + index, index === 0)
          const current = cursor === index + 1
          return (
            <span key={`b${index}`} className="inline-flex items-baseline">
              {number ? <span className="pr-0.5 font-mono text-[0.65625rem] text-faint">{number}</span> : null}
              <button
                type="button"
                aria-current={current ? 'step' : undefined}
                className={cn(TOKEN, current ? CURRENT : IDLE)}
                onClick={() => onGoto(base, index + 1)}
              >
                {notate(san)}
              </button>
            </span>
          )
        })}
      </span>
    )

  return (
    <div className={cn('flex flex-wrap items-baseline gap-x-0.5 gap-y-1', className)} aria-label={t`Moves`}>
      <button
        type="button"
        aria-current={cursor === 0 && ply === 0 ? 'step' : undefined}
        className={cn(TOKEN, 'font-sans', cursor === 0 && ply === 0 ? CURRENT : IDLE)}
        onClick={() => onGoto(0, 0)}
      >
        <Trans context="move list">Start</Trans>
      </button>
      {base === 0 ? branchBlock : null}
      {line.map((position, index) => {
        const number = label(index, index === 0 || index === base)
        const current = cursor === 0 && ply === index + 1
        return (
          <span key={position.ply} className="inline-flex items-baseline">
            {number ? <span className="pr-0.5 pl-1 font-mono text-[0.65625rem] text-faint">{number}</span> : null}
            <button
              type="button"
              aria-current={current ? 'step' : undefined}
              className={cn(TOKEN, current ? CURRENT : IDLE)}
              onClick={() => onGoto(index + 1, 0)}
            >
              {notate(position.san ?? '')}
            </button>
            {base !== null && base > 0 && base === index + 1 ? branchBlock : null}
          </span>
        )
      })}
    </div>
  )
}

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { MoveRow } from '@/lib/api/types'

import { FlaggedMoments } from './FlaggedMoments'

function move(ply: number, san: string, extra: Partial<MoveRow> = {}): MoveRow {
  return { ply, move_number: Math.floor(ply / 2) + 1, san, uci: 'e2e4', ...extra }
}

/** 1.e4 e5 2.Nf3 Qh4?? 3.Nxh4 d5?! — two flagged moves among four quiet ones. */
const MOVES: MoveRow[] = [
  move(0, 'e4', { classification: 'best' }),
  move(1, 'e5'),
  move(2, 'Nf3'),
  move(3, 'Qh4', { classification: 'blunder', win_loss: 26.3, best_move_uci: 'g8f6' }),
  move(4, 'Nxh4'),
  move(5, 'd5', { classification: 'inaccuracy', win_loss: 4.5 }),
]

describe('FlaggedMoments', () => {
  it('lists one row per flagged move, in the order they were played', () => {
    render(<FlaggedMoments moves={MOVES} cursor={-1} onSelect={vi.fn()} />)

    const rows = screen.getAllByRole('button')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('2…Qh4')
    expect(rows[0]).toHaveTextContent('26.3%')
    expect(rows[1]).toHaveTextContent('3…d5')
    // The quiet moves are not moments; `best` is not a flag either.
    expect(screen.queryByText('e4')).not.toBeInTheDocument()
    expect(screen.queryByText('Nf3')).not.toBeInTheDocument()
  })

  it('seeks the position the mistake was made from, not the one it produced', () => {
    const onSelect = vi.fn()
    render(<FlaggedMoments moves={MOVES} cursor={-1} onSelect={onSelect} />)

    // Qh4 is ply 3, so the board goes to cursor 2 — where the board still marks the
    // blunder's squares and the engine can say what it would have played. The same landing
    // as `j` and the flagged-jump buttons under the board.
    fireEvent.click(screen.getAllByRole('button')[0]!)
    expect(onSelect).toHaveBeenCalledWith(2)
  })

  it('lights the row the board is standing at', () => {
    render(<FlaggedMoments moves={MOVES} cursor={2} onSelect={vi.fn()} />)

    const [blunder, inaccuracy] = screen.getAllByRole('button')
    expect(blunder).toHaveClass('bg-selected')
    expect(inaccuracy).not.toHaveClass('bg-selected')
  })

  it('says so rather than drawing an empty list', () => {
    render(<FlaggedMoments moves={[move(0, 'e4'), move(1, 'e5')]} cursor={-1} onSelect={vi.fn()} />)

    expect(screen.getByText('Nothing flagged in this game.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

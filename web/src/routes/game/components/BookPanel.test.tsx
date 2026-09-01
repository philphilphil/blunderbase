import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { BookPanel, type BookMove } from './BookPanel'

/** A Sicilian after 2…e6, where the owner has been nine times. The mockup's own numbers. */
const MOVES: BookMove[] = [
  { uci: 'd2d4', san: 'd4', games: 6, wins: 3, draws: 1, losses: 2, avg_win_loss: 9 },
  { uci: 'b1c3', san: 'Nc3', games: 2, wins: 0, draws: 1, losses: 1, avg_win_loss: 16 },
  { uci: 'b2b3', san: 'b3', games: 1, wins: 0, draws: 0, losses: 1, avg_win_loss: null },
]

describe('BookPanel', () => {
  it('cuts the explorer to four columns, in the explorer’s order and vocabulary', () => {
    render(<BookPanel moves={MOVES} ply={4} onPlay={vi.fn()} />)

    const [header] = screen.getAllByRole('row')
    expect(header).toHaveTextContent(/^MoveGamesScoreAvg drop$/)
    // The three the narrow track cannot afford stay on the explorer's own screen.
    expect(header).not.toHaveTextContent('Score%')
    expect(header).not.toHaveTextContent('Blund')
    expect(header).not.toHaveTextContent('Opening')
  })

  it('labels a continuation with the ply it occupies, not the one before it', () => {
    render(<BookPanel moves={MOVES} ply={4} onPlay={vi.fn()} />)

    // Ply 4 is White's third move.
    expect(screen.getByText(/3\.d4/)).toBeInTheDocument()
  })

  it('renders an em dash where nothing of the owner’s has been analysed', () => {
    render(<BookPanel moves={MOVES} ply={4} onPlay={vi.fn()} />)

    const rows = screen.getAllByRole('row')
    expect(rows[1]).toHaveTextContent('−9.0%')
    // `b3`: played once and never analysed, so there is no drop to report — and a `0.0%`
    // there would read as a move played faultlessly.
    expect(rows[3]).toHaveTextContent('—')
  })

  it('plays a row on click and previews it as a one-move line on hover', () => {
    const onPlay = vi.fn()
    const onPreview = vi.fn()
    render(<BookPanel moves={MOVES} ply={4} onPlay={onPlay} onPreview={onPreview} />)


    // Rows carry `role="row"` — the explorer's own pattern — so they are not `button`s to
    // a query even though they are `<button>`s in the DOM.
    const row = screen.getAllByRole('row')[1]!
    fireEvent.pointerEnter(row)
    expect(onPreview).toHaveBeenCalledWith(['d2d4'])
    fireEvent.pointerLeave(row)
    expect(onPreview).toHaveBeenLastCalledWith(null)
    fireEvent.click(row)
    expect(onPlay).toHaveBeenCalledWith(MOVES[0])
  })

  it('leaves the rows inert where the page gave it nowhere to go', () => {
    render(<BookPanel moves={MOVES} ply={4} />)

    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(4)
    expect(rows[1]!.tagName).toBe('DIV')
  })

  it('says so for a position no two games reached', () => {
    render(<BookPanel moves={[]} ply={4} onPlay={vi.fn()} />)

    // The Book tab is permanent now (`NotesTrack`), so this is the answer to "have I been
    // here before?" rather than a placeholder standing in for a hidden tab. 452k of the
    // owner's 463k positions are reached by one game, so it is also the common case.
    expect(screen.getByTestId('book-panel-empty')).toHaveTextContent(
      'None of your games reached this position.',
    )
    expect(screen.queryByTestId('book-panel')).not.toBeInTheDocument()
  })
})

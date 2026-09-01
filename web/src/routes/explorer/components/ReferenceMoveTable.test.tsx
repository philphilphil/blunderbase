import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ReferenceExplorerResponse } from '@/lib/api/types'

import { ReferenceMoveTable } from './ReferenceMoveTable'

const BOOK: ReferenceExplorerResponse = {
  source: 'masters',
  fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -',
  opening: { eco: 'B00', name: "King's Pawn Game" },
  totals: { games: 400_000, white: 150_000, draws: 160_000, black: 90_000 },
  moves: [
    {
      uci: 'c7c5',
      san: 'c5',
      games: 200_000,
      white: 70_000,
      draws: 80_000,
      black: 50_000,
      average_rating: 2489,
    },
    {
      uci: 'e7e5',
      san: 'e5',
      games: 100_000,
      white: 40_000,
      draws: 45_000,
      black: 15_000,
      average_rating: 2471,
    },
    // A move nobody's rating was recorded for — the column dashes rather than printing 0.
    { uci: 'e7e6', san: 'e6', games: 3_000, white: 1_200, draws: 1_000, black: 800 },
  ],
  top_games: [],
}

describe('ReferenceMoveTable', () => {
  it('shows skeleton rows while the database is being asked', () => {
    render(<ReferenceMoveTable data={undefined} ply={1} loading onPlay={vi.fn()} />)
    expect(screen.getByTestId('reference-loading')).toBeInTheDocument()
  })

  it('says so when the database has nothing from here', () => {
    render(
      <ReferenceMoveTable
        data={{ ...BOOK, moves: [] }}
        ply={1}
        loading={false}
        onPlay={vi.fn()}
      />,
    )
    expect(screen.getByText(/No game in this database/)).toBeInTheDocument()
  })

  it('renders a row per continuation with a short count and its share of the position', () => {
    render(<ReferenceMoveTable data={BOOK} ply={1} loading={false} onPlay={vi.fn()} />)
    expect(screen.getByText('1…c5')).toBeInTheDocument()
    expect(screen.getByText('200.0k')).toBeInTheDocument()
    // 200k of the position's 400k games.
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('2489')).toBeInTheDocument()
  })

  it('keeps the exact count in the title, since the cell is rounded', () => {
    render(<ReferenceMoveTable data={BOOK} ply={1} loading={false} onPlay={vi.fn()} />)
    expect(screen.getByText('200.0k')).toHaveAttribute('title', '200000 games')
  })

  it('dashes the rating on a move whose players Lichess did not rate', () => {
    render(<ReferenceMoveTable data={BOOK} ply={1} loading={false} onPlay={vi.fn()} />)
    const row = screen.getByText('1…e6').closest('button') as HTMLButtonElement
    expect(row.textContent).toContain('—')
  })

  it('draws the split as the two sides rather than as a win and a loss', () => {
    render(<ReferenceMoveTable data={BOOK} ply={1} loading={false} onPlay={vi.fn()} />)
    // There is no owner in a reference game, so the bar says "white wins" and not "wins".
    expect(
      screen.getByLabelText('70000 white wins, 80000 draws, 50000 black wins'),
    ).toBeInTheDocument()
  })

  it('plays a continuation into the line when its row is clicked', async () => {
    const onPlay = vi.fn()
    render(<ReferenceMoveTable data={BOOK} ply={1} loading={false} onPlay={onPlay} />)
    await userEvent.click(screen.getByText('1…e5'))
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ uci: 'e7e5' }))
  })

  it('previews a continuation on hover and clears it on leave', async () => {
    const user = userEvent.setup()
    const onPreview = vi.fn()
    render(
      <ReferenceMoveTable
        data={BOOK}
        ply={1}
        loading={false}
        onPlay={vi.fn()}
        onPreview={onPreview}
      />,
    )
    const row = screen.getByText('1…e5')
    await user.hover(row)
    expect(onPreview).toHaveBeenLastCalledWith(['e7e5'])
    await user.unhover(row)
    expect(onPreview).toHaveBeenLastCalledWith(null)
  })

  it('mirrors the same preview on keyboard focus and blur', () => {
    const onPreview = vi.fn()
    render(
      <ReferenceMoveTable
        data={BOOK}
        ply={1}
        loading={false}
        onPlay={vi.fn()}
        onPreview={onPreview}
      />,
    )
    const row = screen.getByText('1…c5').closest('button') as HTMLButtonElement
    row.focus()
    expect(onPreview).toHaveBeenLastCalledWith(['c7c5'])
    row.blur()
    expect(onPreview).toHaveBeenLastCalledWith(null)
  })
})

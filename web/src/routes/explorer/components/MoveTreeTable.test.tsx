import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ExplorerResponse } from '@/lib/api/types'

import { MoveTreeTable } from './MoveTreeTable'

const TREE = {
  fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -',
  side_to_move: 'black',
  path: [],
  totals: { games: 12, wins: 5, draws: 1, losses: 6, score: 0.4583 },
  moves: [
    {
      uci: 'e7e5',
      san: 'e5',
      games: 5,
      wins: 3,
      draws: 1,
      losses: 1,
      score: 0.7,
      evaluated: 5,
      avg_win_loss: 0.294,
      blunders: 0,
    },
    {
      uci: 'g8f6',
      san: 'Nf6',
      games: 3,
      wins: 1,
      draws: 0,
      losses: 2,
      score: 0.3333,
      evaluated: 3,
      avg_win_loss: 12.8,
      blunders: 2,
    },
  ],
  main_line: [{ ply: 0, uci: 'e7e5', san: 'e5', games: 5 }],
  book_depth: 3,
  leaves_book_with: { ply: 3, uci: 'b1c3', san: 'Nc3', games: 1 },
  leaves_book_because: 'novelty',
} as unknown as ExplorerResponse

describe('MoveTreeTable', () => {
  it('shows skeleton rows while the tree loads', () => {
    render(<MoveTreeTable tree={undefined} ply={1} loading onPlay={vi.fn()} />)
    expect(screen.getByTestId('tree-loading')).toBeInTheDocument()
  })

  it('says so when no game of the owner’s goes further', () => {
    render(
      <MoveTreeTable
        tree={{ ...TREE, moves: [] }}
        ply={1}
        loading={false}
        onPlay={vi.fn()}
      />,
    )
    expect(screen.getByText(/No game of yours goes any further/)).toBeInTheDocument()
  })

  it('renders one row per continuation, numbered at the right ply', () => {
    render(<MoveTreeTable tree={TREE} ply={1} loading={false} onPlay={vi.fn()} />)
    expect(screen.getByText('1…e5')).toBeInTheDocument()
    expect(screen.getByText('1…Nf6')).toBeInTheDocument()
    // score 0.7 -> 70.0, avg drop 12.8 win percentage points, 2 blunders behind Nf6.
    expect(screen.getByText('70.0')).toBeInTheDocument()
    expect(screen.getByText('−12.8%')).toBeInTheDocument()
    expect(screen.getByText('main line')).toBeInTheDocument()
    expect(screen.getByText('2 blunders from here')).toBeInTheDocument()
  })

  it('walks the tree when a continuation is clicked', async () => {
    const onPlay = vi.fn()
    render(<MoveTreeTable tree={TREE} ply={1} loading={false} onPlay={onPlay} />)
    await userEvent.click(screen.getByText('1…Nf6'))
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ uci: 'g8f6' }))
  })
})

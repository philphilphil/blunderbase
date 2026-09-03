import { render, screen } from '@testing-library/react'
import type { UseQueryResult } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MomentResponse } from '@/lib/api/types'

import { WorstMomentsRow } from './WorstMomentsRow'

const useWorstMoments = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/queries', () => ({ useWorstMoments }))

function result<T>(state: Partial<UseQueryResult<T, Error>>) {
  return {
    data: undefined,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...state,
  }
}

/** A query that answered, with these rows. */
function answered(data: MomentResponse[]) {
  return result<MomentResponse[]>({ data, isSuccess: true })
}

/** A position with Black to move — the FEN a moment Black blundered in carries. */
const BLACK_TO_MOVE = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 4'

function moment(over: Partial<MomentResponse> & { game: MomentResponse['game'] }): MomentResponse {
  return {
    ply: 47,
    move_number: 24,
    san: 'Nxe4',
    uci: 'f6e4',
    classification: 'blunder',
    win_loss: 44.2,
    fen: BLACK_TO_MOVE,
    best_move_uci: 'd7d6',
    best_move_san: 'd6',
    ...over,
  }
}

function draw() {
  render(
    <MemoryRouter>
      <WorstMomentsRow />
    </MemoryRouter>,
  )
}

describe('WorstMomentsRow — dashboard moment cards (design 2a)', () => {
  beforeEach(() => useWorstMoments.mockReset())

  it('shows placeholder cards while the grid is in flight', () => {
    useWorstMoments.mockReturnValue(result({ isPending: true }))
    draw()
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('asks for the last thirty days, and says so', () => {
    useWorstMoments.mockReturnValue(
      answered([moment({ game: { id: 7, source: 'lichess', opponent: 'jazzoz' } })]),
    )
    draw()

    expect(useWorstMoments).toHaveBeenCalledWith({ amount: 6, days: 30 })
    expect(screen.getByText(/last 30 days/)).toBeInTheDocument()
  })

  it('opens the game on the position the blunder was played from, not at move one', () => {
    useWorstMoments.mockReturnValue(
      answered([moment({ game: { id: 7, source: 'lichess', opponent: 'jazzoz' } })]),
    )
    draw()

    const card = screen.getByRole('link', { name: /jazzoz/ })
    expect(card).toHaveAttribute('href', '/games/7?ply=47')
    // What the ranking is by, which is what the heading promises — not the eval swing,
    // which used to cost a request per card to show.
    expect(card).toHaveTextContent('−44.2%')
    expect(card).toHaveTextContent('24…Nxe4')
  })

  it('falls back to the whole library when the window holds nothing, and relabels', () => {
    // The empty window is a real answer for someone reading an imported archive rather
    // than playing into it, and an empty panel is not.
    useWorstMoments
      .mockReturnValueOnce(answered([]))
      .mockReturnValueOnce(
        answered([moment({ game: { id: 9, source: 'chesscom', opponent: 'gambiteer' } })]),
      )
    draw()

    expect(useWorstMoments).toHaveBeenLastCalledWith({ amount: 6 }, { enabled: true })
    expect(screen.getByText(/nothing in the last 30 days/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /gambiteer/ })).toBeInTheDocument()
  })

  it('leaves the second query alone while the window has something to show', () => {
    useWorstMoments.mockReturnValue(
      answered([moment({ game: { id: 7, source: 'lichess', opponent: 'jazzoz' } })]),
    )
    draw()

    expect(useWorstMoments).toHaveBeenLastCalledWith({ amount: 6 }, { enabled: false })
  })

  it('says so where nothing anywhere has gone wrong', () => {
    useWorstMoments.mockReturnValue(answered([]))
    draw()

    expect(screen.getByText(/have not blundered/)).toBeInTheDocument()
  })
})

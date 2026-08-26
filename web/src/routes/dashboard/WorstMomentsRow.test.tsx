import { render, screen } from '@testing-library/react'
import type { UseQueryResult } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GameDetail, MomentResponse, MoveRow } from '@/lib/api/types'

import { WorstMomentsRow } from './WorstMomentsRow'

const useWorstMoments = vi.hoisted(() => vi.fn())
const useGame = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/queries', () => ({ useWorstMoments, useGame }))

function result<T>(state: Partial<UseQueryResult<T, Error>>) {
  return {
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...state,
  }
}

/** A position with Black to move — the FEN a moment Black blundered in carries. */
const BLACK_TO_MOVE = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 4'
const WHITE_TO_MOVE = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4'

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

/**
 * One ply of a game detail. `eval_*` are stored the way `services/analysis.py: _move_row`
 * writes them — from the point of view of the side that played the move.
 */
function detail(row: Partial<MoveRow>): GameDetail {
  return {
    game: { id: 1, source: 'lichess' },
    moves: [{ ply: 47, ...row }],
  } as GameDetail
}

describe('WorstMomentsRow — dashboard moment cards (design 2a)', () => {
  beforeEach(() => {
    useWorstMoments.mockReset()
    useGame.mockReset()
  })

  it('shows placeholder cards while the row is in flight', () => {
    useWorstMoments.mockReturnValue(result({ isPending: true }))
    useGame.mockReturnValue(result({ isPending: true }))
    render(
      <MemoryRouter>
        <WorstMomentsRow />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('flips a mover-relative eval into White’s frame, as the game view does', () => {
    // Black played the blunder at ply 47. Stored mover-relative, the move goes from
    // "+0.85 for Black" to "−2.10 for Black"; every eval in the app is White-relative,
    // so the card must read −0.85 → +2.10 — the same two numbers the move list shows.
    useWorstMoments.mockReturnValue(
      result({ data: [moment({ game: { id: 7, source: 'lichess', opponent: 'jazzoz' } })] }),
    )
    useGame.mockReturnValue(
      result({ data: detail({ eval_before_cp: 85, eval_after_cp: -210 }) }),
    )

    render(
      <MemoryRouter>
        <WorstMomentsRow />
      </MemoryRouter>,
    )
    const card = screen.getByRole('link', { name: /jazzoz/ })
    expect(card).toHaveTextContent('−0.85 → +2.10')
    expect(card).not.toHaveTextContent('+0.85')
  })

  it('leaves a White blunder’s eval alone — the mover is already White', () => {
    useWorstMoments.mockReturnValue(
      result({
        data: [
          moment({
            game: { id: 8, source: 'lichess', opponent: 'pawnshop_hero' },
            ply: 46,
            fen: WHITE_TO_MOVE,
          }),
        ],
      }),
    )
    useGame.mockReturnValue(
      result({ data: { game: { id: 8, source: 'lichess' }, moves: [{ ply: 46, eval_before_cp: 85, eval_after_cp: -210 }] } as GameDetail }),
    )

    render(
      <MemoryRouter>
        <WorstMomentsRow />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: /pawnshop_hero/ })).toHaveTextContent(
      '+0.85 → −2.10',
    )
  })

  it('falls back to the win percentage the moment carries when the ply has no eval', () => {
    useWorstMoments.mockReturnValue(
      result({ data: [moment({ game: { id: 9, source: 'chesscom', opponent: 'gambiteer' } })] }),
    )
    useGame.mockReturnValue(result({ data: detail({}) }))

    render(
      <MemoryRouter>
        <WorstMomentsRow />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: /gambiteer/ })).toHaveTextContent('−44.2% win chance')
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { I18nProvider } from '@/lib/i18n/I18nProvider'
import type { CorrespondenceTreeNode } from '@/lib/api/types'

import { EnginesPane } from './EnginesPane'

const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

function node(patch: Partial<CorrespondenceTreeNode> = {}): CorrespondenceTreeNode {
  return {
    id: 2,
    game_id: 1,
    parent_id: 1,
    uci: 'e2e4',
    san: 'e4',
    epd: 'epd-2',
    ply: 1,
    move_number: 1,
    rank: 0,
    played: true,
    conditional: false,
    comment: '',
    fen: AFTER_E4,
    // After 1.e4 Black is to move, so an engine row is stored in Black's frame while the
    // node — and the tree, and the candidates table — print White's.
    turn: 'black',
    frame: 'white',
    own: { cp: 30 },
    evals: [],
    searches: [],
    disagree: false,
    flags: {},
    children: [],
    ...patch,
  }
}

function draw(value: CorrespondenceTreeNode | null) {
  render(
    <I18nProvider>
      <EnginesPane node={value} />
    </I18nProvider>,
  )
}

describe('EnginesPane', () => {
  it('prints a stored row in the node’s frame, not the side to move’s', () => {
    // The row is `cp: -30` after 1.e4 — Black's point of view — which is the same verdict
    // the node's `own` states as `+0.30`. Both are on screen at once, so both must agree.
    draw(
      node({
        evals: [
          {
            engine_id: 1,
            engine_name: 'Stockfish 17',
            cp: -30,
            depth: 51,
            best_lines: [{ multipv: 1, cp: -30, pv: ['e7e5'] }],
          },
        ],
      }),
    )

    expect(screen.getAllByText('+0.30')).toHaveLength(2)
    expect(screen.queryByText('-0.30')).not.toBeInTheDocument()
    expect(screen.queryByText('−0.30')).not.toBeInTheDocument()
  })

  it('leaves the root alone, where the mover and the side to move are the same', () => {
    draw(
      node({
        parent_id: null,
        uci: null,
        san: null,
        ply: 0,
        turn: 'white',
        frame: 'white',
        evals: [{ engine_id: 1, engine_name: 'Stockfish 17', cp: 21, depth: 40 }],
      }),
    )

    expect(screen.getByText('+0.21')).toBeInTheDocument()
  })

  it('says why it is empty while no engine has looked here', () => {
    draw(node())
    expect(screen.getByText(/No engine has looked at this position yet/)).toBeInTheDocument()
  })
})

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/lib/i18n/I18nProvider'
import type { CorrespondenceTreeNode } from '@/lib/api/types'

import { SearchDialog } from './SearchDialog'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function child(id: number, uci: string, san: string): CorrespondenceTreeNode {
  return {
    id,
    game_id: 1,
    parent_id: 1,
    uci,
    san,
    epd: `epd-${id}`,
    ply: 1,
    rank: id - 1,
    played: false,
    conditional: false,
    collapsed: false,
    comment: '',
    fen: START,
    turn: 'black',
    frame: 'white',
    evals: [],
    searches: [],
    disagree: false,
    flags: {},
    children: [],
  }
}

const ROOT: CorrespondenceTreeNode = {
  id: 1,
  game_id: 1,
  parent_id: null,
  uci: null,
  san: null,
  epd: 'root',
  ply: 0,
  rank: 0,
  played: true,
  conditional: false,
  collapsed: false,
  comment: '',
  fen: START,
  turn: 'white',
  frame: 'white',
  evals: [],
  searches: [],
  disagree: false,
  flags: {},
  children: [child(2, 'e2e4', 'e4'), child(3, 'd2d4', 'd4')],
}

const ENGINES = [
  { engine_id: 1, name: 'Stockfish 17', version: '17', default: true },
  { engine_id: 2, name: 'Leela 0.31', version: '0.31' },
]

function draw(onStart = vi.fn()) {
  render(
    <I18nProvider>
      <SearchDialog
        node={ROOT}
        engines={ENGINES}
        defaultMultipv={3}
        pending={false}
        error={null}
        onStart={onStart}
        onClose={() => {}}
      />
    </I18nProvider>,
  )
  return onStart
}

describe('SearchDialog', () => {
  it('opens on an hour: the default engine, and sixty minutes as seconds', async () => {
    const onStart = draw()
    await userEvent.click(screen.getByRole('button', { name: /Start searching/ }))
    expect(onStart).toHaveBeenCalledWith({
      node_id: 1,
      engine_id: 1,
      multipv: null,
      limit_depth: null,
      limit_nodes: null,
      limit_seconds: 3600,
      root_moves: null,
    })
  })

  it('Nothing is a choice: no limit at all', async () => {
    const onStart = draw()
    await userEvent.click(screen.getByRole('button', { name: 'Nothing' }))
    await userEvent.click(screen.getByRole('button', { name: /Start searching/ }))
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ limit_depth: null, limit_nodes: null, limit_seconds: null }),
    )
  })

  it('carries the chosen engine, the line count and one limit', async () => {
    const onStart = draw()
    await userEvent.click(screen.getByRole('button', { name: /Leela 0.31/ }))
    await userEvent.type(screen.getByLabelText('Lines'), '4')
    await userEvent.click(screen.getByRole('button', { name: 'Depth' }))
    expect(screen.getByLabelText('Limit')).toHaveValue(45)
    await userEvent.clear(screen.getByLabelText('Limit'))
    await userEvent.type(screen.getByLabelText('Limit'), '50')
    await userEvent.click(screen.getByRole('button', { name: /Start searching/ }))

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        engine_id: 2,
        multipv: 4,
        limit_depth: 50,
        limit_nodes: null,
        limit_seconds: null,
      }),
    )
  })

  it('sends the picked moves as root_moves, in UCI', async () => {
    const onStart = draw()
    await userEvent.click(screen.getByRole('checkbox', { name: /Only the marked moves/ }))
    const moves = screen.getByRole('group', { name: 'Only the marked moves' })
    await userEvent.click(within(moves).getByRole('button', { name: 'd4' }))
    await userEvent.click(screen.getByRole('button', { name: /Start searching/ }))

    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ root_moves: ['d2d4'] }))
  })

  it('will not start a restricted search with no move picked', async () => {
    draw()
    await userEvent.click(screen.getByRole('checkbox', { name: /Only the marked moves/ }))
    expect(screen.getByRole('button', { name: /Start searching/ })).toBeDisabled()
  })
})

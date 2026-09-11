import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/lib/i18n/I18nProvider'
import type { CorrespondenceTreeNode } from '@/lib/api/types'

import { ExpandDialog, expansionSize } from './ExpandDialog'

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function node(patch: Partial<CorrespondenceTreeNode> = {}): CorrespondenceTreeNode {
  return {
    id: 7,
    game_id: 1,
    parent_id: 1,
    uci: 'e2e4',
    san: 'e4',
    epd: 'epd',
    ply: 1,
    rank: 0,
    played: false,
    conditional: false,
    collapsed: false,
    comment: '',
    fen: FEN,
    turn: 'black',
    frame: 'white',
    evals: [{ engine_id: 1, engine_name: 'Stockfish 17', cp: 20, depth: 40 }],
    searches: [],
    disagree: false,
    flags: {},
    children: [],
    ...patch,
  }
}

const ENGINES = [
  { engine_id: 1, name: 'Stockfish 17', default: true, host: 'this host', search_trouble: null },
  {
    engine_id: 9,
    name: 'Stockfish 17',
    runner_id: 4,
    host: "runner 'gpu-box'",
    search_trouble: "'Stockfish 17' lives on runner 'gpu-box', and correspondence searches run on this host only for now",
  },
]

function draw(overrides: Partial<Parameters<typeof ExpandDialog>[0]> = {}) {
  const props = {
    node: node(),
    engines: ENGINES,
    defaultWidth: 3,
    pending: false,
    error: null,
    onExpand: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  render(
    <I18nProvider>
      <ExpandDialog {...props} />
    </I18nProvider>,
  )
  return props
}

describe('the expand dialog', () => {
  it('sends a blank width as null, which is the deployment’s line count', async () => {
    const props = draw()
    expect(screen.getByLabelText('Width')).toHaveAttribute('placeholder', '3')
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(props.onExpand).toHaveBeenCalledWith({
      width: null,
      stages: 1,
      tasks: true,
      engine_id: 1,
    })
  })

  it('sends the width and the stages that were chosen', async () => {
    const props = draw()
    await userEvent.type(screen.getByLabelText('Width'), '4')
    await userEvent.click(screen.getByRole('button', { name: '2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(props.onExpand).toHaveBeenCalledWith({ width: 4, stages: 2, tasks: true, engine_id: 1 })
  })

  it('offers a runner’s engine for the tasks, which a search could never use', async () => {
    // A task is ordinary queue work: the remote engine is live here, with its host beside
    // it, where the search dialog would grey it out.
    const props = draw()
    const remote = screen.getByRole('button', { name: /gpu-box/ })
    expect(remote).toBeEnabled()
    await userEvent.click(remote)
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(props.onExpand).toHaveBeenCalledWith(expect.objectContaining({ engine_id: 9 }))
  })

  it('can put the moves in the tree and calculate nothing, and then asks for no engine', async () => {
    const props = draw()
    await userEvent.click(screen.getByRole('checkbox'))
    expect(screen.queryByRole('group', { name: 'Engine' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(props.onExpand).toHaveBeenCalledWith({
      width: null,
      stages: 1,
      tasks: false,
      engine_id: null,
    })
  })

  it('says how many positions the two numbers come to, because nobody does that sum', async () => {
    draw()
    expect(screen.getByText(/Up to 3 positions/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '3' }))
    expect(screen.getByText(/Up to 39 positions/)).toBeInTheDocument()
    expect(expansionSize(5, 3)).toBe(155)
  })

  it('warns that a position no engine has judged expands only when its task answers', () => {
    draw({ node: node({ evals: [] }) })
    expect(screen.getByText(/one task is queued on the move itself/)).toBeInTheDocument()
  })
})

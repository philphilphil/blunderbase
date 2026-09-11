import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/lib/i18n/I18nProvider'
import type { CorrespondenceTreeNode } from '@/lib/api/types'

import { TreePane } from './TreePane'

let nextId = 1

function node(patch: Partial<CorrespondenceTreeNode> = {}): CorrespondenceTreeNode {
  const id = patch.id ?? nextId++
  return {
    id,
    game_id: 1,
    parent_id: null,
    uci: 'e2e4',
    san: 'e4',
    epd: `epd-${id}`,
    ply: 1,
    move_number: 1,
    rank: 0,
    played: false,
    conditional: false,
    comment: '',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    turn: 'black',
    frame: 'white',
    evals: [],
    searches: [],
    disagree: false,
    flags: {},
    children: [],
    ...patch,
  }
}

/**
 *  root ─ 1.e4 (played) ─ 1…e5 (played, own +0.34 backed +0.12, two engines disagreeing)
 *                      └─ 1…c5 (left behind, marked `?!`)
 *         and a comment on e4.
 */
function sample(): CorrespondenceTreeNode {
  const e5 = node({
    id: 3,
    san: 'e5',
    uci: 'e7e5',
    ply: 2,
    move_number: 1,
    frame: 'black',
    played: true,
    own: { cp: 34, depth: 51 },
    backed: { cp: 12 },
    disagree: true,
  })
  const c5 = node({
    id: 4,
    san: 'c5',
    uci: 'c7c5',
    ply: 2,
    move_number: 1,
    frame: 'black',
    rank: 1,
    mark: 'dubious',
  })
  const e4 = node({
    id: 2,
    san: 'e4',
    played: true,
    comment: 'The move the game was built on.',
    children: [
      { ...e5, parent_id: 2 },
      { ...c5, parent_id: 2 },
    ],
  })
  return node({
    id: 1,
    uci: null,
    san: null,
    ply: 0,
    played: true,
    children: [{ ...e4, parent_id: 1 }],
  })
}

function draw(overrides: Partial<Parameters<typeof TreePane>[0]> = {}) {
  const props = {
    tree: sample(),
    selectedId: null,
    onSelect: vi.fn(),
    onMark: vi.fn(),
    onComment: vi.fn(),
    onPromote: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
  render(
    <I18nProvider>
      <TreePane {...props} />
    </I18nProvider>,
  )
  return props
}

describe('the tree pane', () => {
  it('prints the spine, the numbers and the alternative under it', () => {
    draw()
    expect(within(screen.getByTestId('tree-node-2')).getByText('e4')).toBeInTheDocument()
    expect(within(screen.getByTestId('tree-node-3')).getByText('e5')).toBeInTheDocument()
    expect(within(screen.getByTestId('tree-node-4')).getByText('c5')).toBeInTheDocument()
  })

  it('draws a mark as its glyph', () => {
    draw()
    expect(within(screen.getByTestId('tree-node-4')).getByText('?!')).toBeInTheDocument()
  })

  it('shows the backed number with the arrow that says the engine was refuted', () => {
    draw()
    const refuted = screen.getByTestId('tree-node-3')
    expect(within(refuted).getByText('+0.34')).toBeInTheDocument()
    expect(within(refuted).getByText(/▼/)).toHaveTextContent('+0.12')
  })

  it('marks a position two engines disagree on', () => {
    draw()
    expect(within(screen.getByTestId('tree-node-3')).getByText('≠')).toBeInTheDocument()
  })

  it('carries the node comment under the move it belongs to', () => {
    draw()
    expect(screen.getByText('The move the game was built on.')).toBeInTheDocument()
  })

  it('selects a node when it is clicked', async () => {
    const props = draw()
    await userEvent.click(screen.getByTestId('tree-node-4'))
    expect(props.onSelect).toHaveBeenCalledWith(4)
  })

  it('opens the verb set on a right click, and marks from it', async () => {
    const props = draw()
    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTestId('tree-node-4') })
    const menu = screen.getByTestId('tree-menu')
    // Pressing the mark a node already carries takes it off again.
    await userEvent.click(within(menu).getByRole('button', { name: 'Dubious' }))
    expect(props.onMark).toHaveBeenCalledWith(4, null)
  })

  it('refuses to delete a move the game played, and the root', async () => {
    draw()
    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTestId('tree-node-3') })
    expect(
      within(screen.getByTestId('tree-menu')).getByRole('menuitem', { name: 'Delete subtree' }),
    ).toBeDisabled()
  })

  it('opens no menu at all on a finished game', async () => {
    draw({ readOnly: true })
    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTestId('tree-node-4') })
    expect(screen.queryByTestId('tree-menu')).not.toBeInTheDocument()
  })
})

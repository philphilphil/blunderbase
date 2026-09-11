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

  it('prints the main move before the alternatives to it, and the line goes on after them', () => {
    // 1.e4 e5 (1…c5) 2.Nf3 — the notation everybody reads, not the variations first.
    const tree = sample()
    const e5 = tree.children[0].children.find((child) => child.san === 'e5') as CorrespondenceTreeNode
    e5.children = [
      node({ id: 9, san: 'Nf3', uci: 'g1f3', ply: 3, move_number: 2, frame: 'white', played: true }),
    ]
    draw({ tree })
    const order = [2, 3, 4, 9].map((id) => screen.getByTestId(`tree-node-${id}`))
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }
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

/**
 * A move with a task waiting on it, one child being worked on, and a stale verdict — the
 * three marks step 3 adds, on one tree.
 */
function tasked(): CorrespondenceTreeNode {
  const grandchild = node({
    id: 12,
    san: 'Nf6',
    uci: 'g8f6',
    ply: 3,
    frame: 'black',
    task: { search_id: 31, status: 'queued' },
  })
  const child = node({
    id: 11,
    san: 'Nf3',
    uci: 'g1f3',
    ply: 2,
    frame: 'white',
    task: { search_id: 30, status: 'running' },
    children: [grandchild],
  })
  const root = node({
    id: 10,
    san: 'e4',
    uci: 'e2e4',
    ply: 1,
    own: { cp: 20, depth: 18 },
    stale: true,
    task: { search_id: 29, status: 'queued', stages: 2, width: 3 },
    children: [child],
  })
  return node({ id: 9, uci: null, san: null, ply: 0, played: true, children: [root] })
}

describe('the tree pane and the tasks under it', () => {
  it('marks the position a task is waiting on, and how much is still out below it', () => {
    draw({ tree: tasked() })
    const chip = screen.getByTestId('tree-queued-10')
    expect(chip).toHaveTextContent('◌')
    // Two of the two positions under this move are still waiting; the node's own task is
    // the mark itself and is not counted twice.
    expect(chip).toHaveTextContent('2 of 2')
  })

  it('marks a stale verdict, and says why', () => {
    draw({ tree: tasked() })
    expect(screen.getByTestId('tree-stale-10')).toHaveAttribute(
      'title',
      expect.stringContaining('stale'),
    )
  })

  it('queues a task from the menu, and refuses one where a task is already going', async () => {
    const onQueueTask = vi.fn()
    draw({ tree: tasked(), onQueueTask })
    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTestId('tree-node-10') })
    expect(
      within(screen.getByTestId('tree-menu')).getByRole('menuitem', { name: 'Queue task' }),
    ).toBeDisabled()

    await userEvent.keyboard('{Escape}')
    const plain = node({ id: 4, san: 'c5', uci: 'c7c5', ply: 2, frame: 'black' })
    draw({ tree: node({ id: 1, uci: null, san: null, children: [plain] }), onQueueTask })
    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTestId('tree-node-4') })
    await userEvent.click(
      within(screen.getByTestId('tree-menu')).getByRole('menuitem', { name: 'Queue task' }),
    )
    expect(onQueueTask).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }))
  })

  it('never offers engine time on an excluded move', async () => {
    const excluded = node({ id: 5, san: 'h5', uci: 'h7h5', ply: 2, frame: 'black', mark: 'excluded' })
    draw({
      tree: node({ id: 1, uci: null, san: null, children: [excluded] }),
      onQueueTask: vi.fn(),
      onExpand: vi.fn(),
    })
    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTestId('tree-node-5') })
    const menu = screen.getByTestId('tree-menu')
    expect(within(menu).getByRole('menuitem', { name: 'Queue task' })).toBeDisabled()
    expect(within(menu).getByRole('menuitem', { name: 'Expand…' })).toBeDisabled()
  })

  it('cancels a waiting task, and offers no cancel for one already being worked on', async () => {
    const onCancelTask = vi.fn()
    draw({ tree: tasked(), onExpand: vi.fn(), onRefresh: vi.fn(), onCancelTask })
    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTestId('tree-node-11') })
    expect(
      within(screen.getByTestId('tree-menu')).queryByRole('menuitem', { name: 'Cancel task' }),
    ).not.toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTestId('tree-node-12') })
    await userEvent.click(
      within(screen.getByTestId('tree-menu')).getByRole('menuitem', { name: 'Cancel task' }),
    )
    expect(onCancelTask).toHaveBeenCalledWith(31)
  })

  it('offers Expand… and Refresh subtree, and hands over the node they were raised on', async () => {
    const onExpand = vi.fn()
    const onRefresh = vi.fn()
    draw({ tree: tasked(), onExpand, onRefresh })
    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTestId('tree-node-11') })
    await userEvent.click(
      within(screen.getByTestId('tree-menu')).getByRole('menuitem', { name: 'Expand…' }),
    )
    expect(onExpand).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }))

    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTestId('tree-node-11') })
    await userEvent.click(
      within(screen.getByTestId('tree-menu')).getByRole('menuitem', { name: 'Refresh subtree' }),
    )
    expect(onRefresh).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }))
  })
})

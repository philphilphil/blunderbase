import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/lib/i18n/I18nProvider'
import type { CorrespondenceSearch, CorrespondenceTreeNode } from '@/lib/api/types'

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

function search(patch: Partial<CorrespondenceSearch> = {}): CorrespondenceSearch {
  return {
    id: 9,
    node_id: 2,
    game_id: 1,
    engine_id: 1,
    engine_name: 'Stockfish 17',
    kind: 'search',
    status: 'running',
    warm: false,
    multipv: 3,
    started_at: new Date(Date.now() - 3_600_000).toISOString(),
    ...patch,
  }
}

function draw(value: CorrespondenceTreeNode | null, props: Record<string, unknown> = {}) {
  return render(
    <I18nProvider>
      <EnginesPane
        node={value}
        onHover={() => {}}
        onPause={() => {}}
        onResume={() => {}}
        onStop={() => {}}
        {...props}
      />
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

  it('draws the live snapshot rather than the stored row while a search runs', () => {
    // The checkpoint says depth 38; the search is at 51 and has moved on to another line.
    // A pane that mixed the two would put a depth-51 header over depth-38 lines.
    draw(
      node({
        evals: [
          {
            engine_id: 1,
            engine_name: 'Stockfish 17',
            cp: -18,
            depth: 38,
            best_lines: [{ multipv: 1, cp: -18, pv: ['c7c5'] }],
          },
        ],
        searches: [
          search({
            snapshot: {
              search_id: 9,
              seq: 4,
              depth: 51,
              nodes: 7_200_000,
              nps: 41_000_000,
              lines: [{ multipv: 1, cp: -34, pv: ['e7e5'] }],
            },
          }),
        ],
      }),
    )

    const pane = screen.getByTestId('engine-pane-1')
    expect(pane).toHaveAttribute('data-live', 'true')
    expect(within(pane).getByText(/depth 51/)).toBeInTheDocument()
    // The live line, in the node's frame. The stored −0.18 is nowhere on screen.
    expect(within(pane).getAllByText('+0.34').length).toBeGreaterThan(0)
    expect(within(pane).queryByText('+0.18')).not.toBeInTheDocument()
  })

  it('falls back to the stored lines for a search that is parked', () => {
    draw(
      node({
        evals: [
          {
            engine_id: 1,
            engine_name: 'Stockfish 17',
            cp: -18,
            depth: 38,
            best_lines: [{ multipv: 1, cp: -18, pv: ['c7c5'] }],
          },
        ],
        searches: [search({ status: 'paused', warm: true })],
      }),
    )

    const pane = screen.getByTestId('engine-pane-1')
    expect(pane).not.toHaveAttribute('data-live')
    expect(within(pane).getByText(/parked, warm/)).toBeInTheDocument()
    expect(within(pane).getAllByText('+0.18').length).toBeGreaterThan(0)
  })

  it('stacks one pane per engine, running first', () => {
    draw(
      node({
        evals: [
          { engine_id: 1, engine_name: 'Stockfish 17', cp: -30, depth: 51 },
          { engine_id: 2, engine_name: 'Leela 0.31', cp: -18, depth: 22 },
        ],
        searches: [search({ id: 11, engine_id: 2, engine_name: 'Leela 0.31' })],
      }),
    )

    const panes = screen.getAllByTestId(/^engine-pane-/)
    expect(panes).toHaveLength(2)
    expect(panes[0]).toHaveAttribute('data-testid', 'engine-pane-2')
  })

  it('hands Pause, Stop and the pin back with the search’s id', async () => {
    const user = userEvent.setup()
    const onPause = vi.fn()
    const onStop = vi.fn()
    const onPin = vi.fn()
    draw(
      node({
        evals: [{ engine_id: 1, engine_name: 'Stockfish 17', cp: -30, depth: 51 }],
        searches: [search()],
      }),
      { onPause, onStop, onPin },
    )

    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await user.click(screen.getByRole('button', { name: 'Pin' }))
    expect(onPause).toHaveBeenCalledWith(9)
    expect(onStop).toHaveBeenCalledWith(9)
    expect(onPin).toHaveBeenCalledWith(1)
  })

  it('says why it is empty while no engine has looked here', () => {
    draw(node())
    expect(screen.getByText(/No engine has looked at this position yet/)).toBeInTheDocument()
  })
})

describe('the engine column and the tasks in it', () => {
  it('draws a waiting task as this engine’s pane, with Cancel instead of Pause', async () => {
    const onCancel = vi.fn()
    draw(
      node({
        searches: [
          search({ id: 21, kind: 'task', status: 'queued', limit_nodes: 40_000_000 }),
        ],
      }),
      { onCancel },
    )
    const pane = screen.getByTestId('engine-pane-1')
    expect(within(pane).getByText('task waiting in the queue')).toBeInTheDocument()
    expect(within(pane).queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
    await userEvent.click(within(pane).getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledWith(21)
  })

  it('says why a task died on a position nothing had evaluated', () => {
    // An expansion's children are fresh positions: no eval row, no active search. The
    // failed task's row is the only place the reason exists, so the pane is made for it.
    draw(
      node({
        searches: [
          search({
            id: 21,
            kind: 'task',
            status: 'failed',
            error: 'Stockfish 17: no such file or directory',
          }),
        ],
      }),
    )
    const pane = screen.getByTestId('engine-pane-1')
    expect(within(pane).getByText('task stopped')).toBeInTheDocument()
    expect(within(pane).getByRole('alert')).toHaveTextContent('no such file or directory')
  })

  it('offers no cancel for a task an engine already has: it finishes', () => {
    draw(
      node({ searches: [search({ id: 21, kind: 'task', status: 'running' })] }),
      { onCancel: vi.fn() },
    )
    const pane = screen.getByTestId('engine-pane-1')
    expect(within(pane).getByText('task running')).toBeInTheDocument()
    expect(within(pane).getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  it('marks a stored verdict that is stale, and says which of the two reasons applies', () => {
    draw(
      node({
        evals: [
          {
            engine_id: 1,
            engine_name: 'Stockfish 17',
            cp: 30,
            depth: 18,
            stale: true,
            best_lines: [{ multipv: 1, cp: 30, pv: ['e7e5'] }],
          },
        ],
      }),
    )
    expect(screen.getByTestId('engine-pane-stale')).toHaveAttribute(
      'title',
      expect.stringContaining('stale'),
    )
  })
})

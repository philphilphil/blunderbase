import { describe, expect, it } from 'vitest'

import type {
  CorrespondenceEval,
  CorrespondenceSearch,
  CorrespondenceTreeNode,
} from '@/lib/api/types'

import {
  countPruned,
  countTasks,
  enginePanes,
  formatSpan,
  isTask,
  prunableNodes,
  readHistory,
  sparkline,
  taskCounts,
  taskProgress,
  weakChildren,
} from './searches'

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

function node(patch: Partial<CorrespondenceTreeNode> = {}): CorrespondenceTreeNode {
  return {
    id: 1,
    game_id: 1,
    parent_id: null,
    uci: null,
    san: null,
    epd: 'epd',
    ply: 0,
    rank: 0,
    played: false,
    conditional: false,
    collapsed: false,
    comment: '',
    fen: FEN,
    turn: 'white',
    frame: 'white',
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
    id: 1,
    node_id: 1,
    kind: 'search',
    status: 'running',
    ...patch,
  }
}

function stored(patch: Partial<CorrespondenceEval> = {}): CorrespondenceEval {
  return { engine_id: 1, engine_name: 'Stockfish 17', cp: 20, depth: 40, ...patch }
}

describe('enginePanes', () => {
  it('folds a search and that engine’s stored row into one pane', () => {
    const panes = enginePanes(
      node({ evals: [stored()], searches: [search({ engine_id: 1, engine_name: 'Stockfish 17' })] }),
    )
    expect(panes).toHaveLength(1)
    expect(panes[0].search?.id).toBe(1)
    expect(panes[0].stored?.depth).toBe(40)
  })

  it('puts what is running first, whatever its depth', () => {
    const panes = enginePanes(
      node({
        evals: [stored({ depth: 51 }), stored({ engine_id: 2, engine_name: 'Leela', depth: 22 })],
        searches: [search({ engine_id: 2, engine_name: 'Leela' })],
      }),
    )
    expect(panes.map((pane) => pane.engineId)).toEqual([2, 1])
  })

  it('ignores a search that has already ended: its verdict is the stored row now', () => {
    const panes = enginePanes(
      node({ evals: [stored()], searches: [search({ status: 'done', engine_id: 1 })] }),
    )
    expect(panes[0].search).toBeNull()
  })

  it('reads the pin off the node, not off the engine', () => {
    const panes = enginePanes(node({ evals: [stored()], pinned_engine_id: 1, chosen_engine_id: 1 }))
    expect(panes[0].pinned).toBe(true)
    expect(panes[0].chosen).toBe(true)
  })
})

describe('weakChildren', () => {
  const kids = (...backed: (number | null)[]) =>
    node({
      children: backed.map((cp, at) =>
        node({ id: at + 2, rank: at, backed: cp === null ? null : { cp } }),
      ),
    })

  it('fades what has fallen a pawn and a half behind the best of its siblings', () => {
    expect([...weakChildren(kids(30, 10, -160))]).toEqual([4])
  })

  it('fades nothing where the gap is inside the threshold', () => {
    expect(weakChildren(kids(30, -100)).size).toBe(0)
  })

  it('never fades a move nobody has evaluated — unknown is not bad', () => {
    expect(weakChildren(kids(30, null)).size).toBe(0)
  })

  it('falls back to a node’s own number when nothing has been backed up', () => {
    const parent = node({
      children: [
        node({ id: 2, rank: 0, own: { cp: 40 } }),
        node({ id: 3, rank: 1, own: { cp: -200 } }),
      ],
    })
    expect([...weakChildren(parent)]).toEqual([3])
  })
})

describe('prunableNodes', () => {
  it('offers the faded subtree’s root and counts it whole', () => {
    const tree = node({
      children: [
        node({ id: 2, rank: 0, backed: { cp: 40 } }),
        node({
          id: 3,
          rank: 1,
          backed: { cp: -300 },
          children: [node({ id: 4, parent_id: 3 })],
        }),
      ],
    })
    const found = prunableNodes(tree)
    expect(found.map((one) => one.id)).toEqual([3])
    expect(countPruned(found)).toBe(2)
  })

  it('leaves a played line and anything with an engine still on it alone', () => {
    const tree = node({
      children: [
        node({ id: 2, rank: 0, backed: { cp: 40 } }),
        node({ id: 3, rank: 1, backed: { cp: -300 }, played: true }),
        node({
          id: 4,
          rank: 2,
          backed: { cp: -300 },
          searches: [search({ id: 8, node_id: 4, status: 'paused' })],
        }),
      ],
    })
    expect(prunableNodes(tree)).toEqual([])
  })
})

describe('the eval history', () => {
  it('draws nothing from a single entry — a trajectory needs two', () => {
    expect(sparkline([{ depth: 20, cp: 10 }])).toBe('')
  })

  it('plots one point per entry across the box', () => {
    const points = sparkline([{ cp: 0 }, { cp: 300 }, { cp: -300 }]).split(' ')
    expect(points).toHaveLength(3)
    expect(points[0]).toMatch(/^0\.0,6\.0$/)
    expect(points[2].startsWith('100.0')).toBe(true)
  })

  it('reads the two ends and says whether the number has stopped moving', () => {
    const reading = readHistory([
      { depth: 30, cp: 18, best: 'g1f3' },
      { depth: 40, cp: 33, best: 'g1f3' },
      { depth: 50, cp: 34, best: 'g1f3' },
    ])
    expect(reading?.from.depth).toBe(30)
    expect(reading?.to.cp).toBe(34)
    expect(reading?.stableFor).toBe(3)
    expect(reading?.settled).toBe(true)
  })
})

describe('formatSpan', () => {
  it('says a three-day search in days, not in minutes', () => {
    expect(formatSpan(48)).toBe('48s')
    expect(formatSpan(30 * 60)).toBe('30m')
    expect(formatSpan(6 * 3600 + 12 * 60)).toBe('6h 12m')
    expect(formatSpan(2 * 86_400 + 4 * 3600)).toBe('2d 4h')
  })
})

describe('tasks', () => {
  it('tells the two engine modes apart, and counts the tasks by themselves', () => {
    const rows = [
      search({ id: 1, kind: 'search', status: 'running' }),
      search({ id: 2, kind: 'task', status: 'queued' }),
      search({ id: 3, kind: 'task', status: 'running' }),
      search({ id: 4, kind: 'task', status: 'done' }),
    ]
    expect(rows.filter(isTask).map((row) => row.id)).toEqual([2, 3, 4])
    // The finished one is neither queued nor running: the counts are what is still out.
    expect(countTasks(rows)).toEqual({ queued: 1, running: 1 })
  })

  it('counts what is still out under a node, and never the node itself', () => {
    // A move whose expansion made three children, two of which still have a task, and one
    // of those has a grandchild with one too: 3 of 4 positions under it are still waiting.
    const tree = node({
      id: 1,
      task: { search_id: 9, status: 'queued' },
      children: [
        node({
          id: 2,
          task: { search_id: 10, status: 'running' },
          children: [node({ id: 5, task: { search_id: 12, status: 'queued' } })],
        }),
        node({ id: 3, task: { search_id: 11, status: 'queued' } }),
        node({ id: 4 }),
      ],
    })
    expect(taskProgress(tree)).toEqual({ left: 3, total: 4 })
    // A leaf with a task of its own reports nothing: that one is the mark beside the move.
    expect(taskProgress(node({ id: 7, task: { search_id: 3, status: 'queued' } }))).toEqual({
      left: 0,
      total: 0,
    })

    // One walk for the whole tree answers the same as asking node by node.
    const counts = taskCounts(tree)
    expect(counts.get(1)).toEqual({ left: 3, total: 4 })
    expect(counts.get(2)).toEqual({ left: 1, total: 1 })
    expect(counts.get(4)).toEqual({ left: 0, total: 0 })
  })

  it('keeps the reason a stopped task left behind, beside the engine it belonged to', () => {
    // "Clear the queue" takes a task's run with it and writes why on the row. Nothing is
    // active on the engine any more, so without this the sentence would be unreadable.
    const panes = enginePanes(
      node({
        evals: [stored()],
        searches: [
          search({
            id: 4,
            kind: 'task',
            status: 'stopped',
            engine_id: 1,
            error: 'the analysis queue was cleared before this task ran',
          }),
        ],
      }),
    )
    expect(panes).toHaveLength(1)
    expect(panes[0].search).toBeNull()
    expect(panes[0].ended?.error).toMatch(/queue was cleared/)
  })

  it('makes a pane for a failed task on a position nothing has evaluated', () => {
    // The expansion case: a fresh child has no eval row and no active search, so unless the
    // failed task makes a pane of its own the reason is nowhere and the branch dies quietly.
    const panes = enginePanes(
      node({
        evals: [],
        searches: [
          search({
            id: 7,
            kind: 'task',
            status: 'failed',
            engine_id: 3,
            engine_name: 'Stockfish 17',
            error: 'no such file or directory',
          }),
        ],
      }),
    )
    expect(panes).toHaveLength(1)
    expect(panes[0].engineId).toBe(3)
    expect(panes[0].engineName).toBe('Stockfish 17')
    expect(panes[0].search).toBeNull()
    expect(panes[0].stored).toBeNull()
    expect(panes[0].ended?.error).toMatch(/no such file/)
  })

  it('keeps the newest reason when two tasks died on the same engine', () => {
    const panes = enginePanes(
      node({
        evals: [],
        searches: [
          search({ id: 7, kind: 'task', status: 'failed', engine_id: 3, error: 'the first' }),
          search({ id: 9, kind: 'task', status: 'failed', engine_id: 3, error: 'the second' }),
        ],
      }),
    )
    expect(panes).toHaveLength(1)
    expect(panes[0].ended?.error).toBe('the second')
  })

  it('says nothing about an ended task while the engine is working again', () => {
    const panes = enginePanes(
      node({
        evals: [stored()],
        searches: [
          search({ id: 4, kind: 'task', status: 'failed', engine_id: 1, error: 'boom' }),
          search({ id: 5, kind: 'search', status: 'running', engine_id: 1 }),
        ],
      }),
    )
    expect(panes[0].search?.id).toBe(5)
    expect(panes[0].ended).toBeNull()
  })
})

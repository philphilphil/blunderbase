import { describe, expect, it } from 'vitest'

import type {
  CorrespondenceEval,
  CorrespondenceSearch,
  CorrespondenceTreeNode,
} from '@/lib/api/types'

import {
  countPruned,
  enginePanes,
  formatSpan,
  prunableNodes,
  readHistory,
  sparkline,
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

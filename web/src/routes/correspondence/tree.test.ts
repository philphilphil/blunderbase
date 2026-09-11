import { describe, expect, it } from 'vitest'

import type { CorrespondenceTreeNode } from '@/lib/api/types'

import {
  backedDirection,
  candidatesOf,
  countEvaluated,
  countNodes,
  indexTree,
  inWhiteFrame,
  isLeftBehind,
  mainlineFrom,
  nextSelection,
  pathTo,
  playedPath,
  scoreRank,
  sortSiblings,
} from './tree'

let nextId = 1

/** One node, with only what a test cares about spelled out. */
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

/** The children's `parent_id` set for them, which the backend always does. */
function withChildren(
  parent: CorrespondenceTreeNode,
  children: CorrespondenceTreeNode[],
): CorrespondenceTreeNode {
  return { ...parent, children: children.map((child) => ({ ...child, parent_id: parent.id })) }
}

describe('scoreRank', () => {
  it('ranks a mate past every centipawn score, and a shorter mate first', () => {
    expect(scoreRank({ mate: 2 })).toBeGreaterThan(scoreRank({ mate: 5 }))
    expect(scoreRank({ mate: 5 })).toBeGreaterThan(scoreRank({ cp: 900 }))
    expect(scoreRank({ mate: -3 })).toBeLessThan(scoreRank({ cp: -900 }))
  })

  it('is the bottom of every order for a position nobody has evaluated', () => {
    expect(scoreRank(null)).toBe(Number.NEGATIVE_INFINITY)
    expect(scoreRank({ cp: null, mate: null })).toBe(Number.NEGATIVE_INFINITY)
  })
})

describe('inWhiteFrame', () => {
  it('turns a node reached by a Black move, and leaves a White one alone', () => {
    expect(inWhiteFrame({ cp: 40, mate: null }, 'white')).toEqual({ cp: 40, mate: null })
    expect(inWhiteFrame({ cp: -40, mate: null }, 'black')).toEqual({ cp: 40, mate: null })
    expect(inWhiteFrame({ cp: null, mate: 3 }, 'black')).toEqual({ cp: null, mate: -3 })
    expect(inWhiteFrame({ cp: null, mate: null }, 'black')).toEqual({ cp: null, mate: null })
    expect(inWhiteFrame(null, 'black')).toBeNull()
  })
})

describe('candidatesOf', () => {
  it('sorts by the backed evaluation, best first — not by the engine\'s own number', () => {
    const best = node({ id: 10, san: 'Nf5', own: { cp: 34 }, backed: { cp: 12 } })
    const solid = node({ id: 11, san: 'Rad1', own: { cp: 10 }, backed: { cp: 20 } })
    const parent = withChildren(node({ id: 1, uci: null, san: null }), [best, solid])

    expect(candidatesOf(parent).map((child) => child.san)).toEqual(['Rad1', 'Nf5'])
  })

  it('falls back to a move\'s own number where nothing has been backed up yet', () => {
    const rich = node({ id: 10, san: 'Nf5', own: { cp: 5 } })
    const poor = node({ id: 11, san: 'h4', own: { cp: -40 } })
    const parent = withChildren(node({ id: 1 }), [poor, rich])

    expect(candidatesOf(parent).map((child) => child.san)).toEqual(['Nf5', 'h4'])
  })

  it('sinks an excluded move below everything, whatever its number says', () => {
    const ruled = node({ id: 10, san: 'Bxf6', own: { cp: 300 }, mark: 'excluded' })
    const played = node({ id: 11, san: 'Nf5', own: { cp: 10 } })
    const parent = withChildren(node({ id: 1 }), [ruled, played])

    expect(candidatesOf(parent).map((child) => child.san)).toEqual(['Nf5', 'Bxf6'])
  })

  it('keeps the tree\'s own order among moves nothing has evaluated', () => {
    const first = node({ id: 10, san: 'a3', rank: 0 })
    const second = node({ id: 11, san: 'b3', rank: 1 })
    const parent = withChildren(node({ id: 1 }), [second, first])

    expect(candidatesOf(parent).map((child) => child.san)).toEqual(['a3', 'b3'])
  })

  it('answers with nothing for a node that has no children and for no node at all', () => {
    expect(candidatesOf(node())).toEqual([])
    expect(candidatesOf(null)).toEqual([])
  })
})

describe('sortSiblings', () => {
  it('orders by rank, with the id as the tie-break', () => {
    const ordered = sortSiblings([
      node({ id: 3, rank: 1 }),
      node({ id: 2, rank: 0 }),
      node({ id: 1, rank: 1 }),
    ])
    expect(ordered.map((each) => each.id)).toEqual([2, 1, 3])
  })
})

describe('backedDirection', () => {
  it('says which way the minimax moved, and stays quiet about rounding', () => {
    expect(backedDirection(node({ own: { cp: 34 }, backed: { cp: 12 } }))).toBe('down')
    expect(backedDirection(node({ own: { cp: 8 }, backed: { cp: 40 } }))).toBe('up')
    expect(backedDirection(node({ own: { cp: 20 }, backed: { cp: 22 } }))).toBe('same')
  })

  it('is null where there is nothing to compare', () => {
    expect(backedDirection(node({ own: { cp: 34 } }))).toBeNull()
    expect(backedDirection(node({ backed: { cp: 34 } }))).toBeNull()
  })
})

describe('walking the tree', () => {
  /**
   *  root ─ e4 ─ e5 ─ Nf3
   *              └─ c5 (an alternative to e5)
   */
  function sample() {
    const nf3 = node({ id: 4, san: 'Nf3', played: true, frame: 'white' })
    const e5 = withChildren(node({ id: 3, san: 'e5', played: true, frame: 'black' }), [nf3])
    const c5 = node({ id: 5, san: 'c5', rank: 1, frame: 'black' })
    const e4 = withChildren(node({ id: 2, san: 'e4', played: true, frame: 'white' }), [e5, c5])
    return withChildren(node({ id: 1, uci: null, san: null, played: true, ply: 0 }), [e4])
  }

  it('indexes every node with its parent', () => {
    const index = indexTree(sample())
    expect(index.size).toBe(5)
    expect(index.get(5)?.parent?.id).toBe(2)
    expect(index.get(1)?.parent).toBeNull()
  })

  it('follows the first child for the line a node starts', () => {
    const root = sample()
    expect(mainlineFrom(root).map((each) => each.id)).toEqual([1, 2, 3, 4])
  })

  it('reads a path back to the root, and the played path down from it', () => {
    const root = sample()
    expect(pathTo(indexTree(root), 4).map((each) => each.id)).toEqual([1, 2, 3, 4])
    expect(playedPath(root).map((each) => each.id)).toEqual([1, 2, 3, 4])
  })

  it('greys a line that hangs off a position the game has left', () => {
    const root = sample()
    const e4 = root.children[0]
    const [e5, c5] = e4.children
    expect(isLeftBehind(e4, c5)).toBe(true)
    expect(isLeftBehind(e4, e5)).toBe(false)
  })

  it('counts the nodes and the ones an engine has looked at', () => {
    const root = sample()
    expect(countNodes(root)).toBe(5)
    expect(countEvaluated(root)).toBe(0)
  })

  describe('arrow keys', () => {
    const index = indexTree(sample())

    it('walks along the line with left and right', () => {
      expect(nextSelection(index, 2, 'ArrowRight')).toBe(3)
      expect(nextSelection(index, 3, 'ArrowLeft')).toBe(2)
    })

    it('crosses the sibling set with up and down', () => {
      expect(nextSelection(index, 3, 'ArrowDown')).toBe(5)
      expect(nextSelection(index, 5, 'ArrowUp')).toBe(3)
    })

    it('stands still rather than clearing the selection at an edge', () => {
      expect(nextSelection(index, 1, 'ArrowLeft')).toBe(1)
      expect(nextSelection(index, 4, 'ArrowRight')).toBe(4)
      expect(nextSelection(index, 3, 'ArrowUp')).toBe(3)
      expect(nextSelection(index, 99, 'ArrowRight')).toBe(99)
    })
  })
})

import { describe, expect, it } from 'vitest'

import type { RepertoireNode } from '@/lib/api/types'

import {
  childrenAt,
  countNodes,
  flattenTree,
  inRepertoire,
  nodeAt,
  pathOf,
  sortSiblings,
  walk,
} from './tree'

let nextId = 0

/** A node with everything the contract requires, so a fixture names only what it is about. */
function node(
  uci: string,
  san: string,
  extra: Partial<RepertoireNode> = {},
): RepertoireNode {
  nextId += 1
  return {
    id: nextId,
    uci,
    san,
    comment: '',
    rank: 0,
    epd: `epd-${uci}`,
    children: [],
    ...extra,
  }
}

/**
 * 1.e4 (main) with 1.d4 beside it; after 1.e4 the mainline runs 1…e5 2.Nf3, with 1…c5 as
 * a sideline. Ids are explicit because half of what is tested here is the ordering.
 */
function repertoire(): RepertoireNode[] {
  const nf3 = node('g1f3', 'Nf3', { id: 40 })
  const e5 = node('e7e5', 'e5', { id: 20, children: [nf3] })
  const c5 = node('c7c5', 'c5', { id: 30, rank: 1, comment: 'the Sicilian' })
  const e4 = node('e2e4', 'e4', { id: 10, children: [e5, c5] })
  const d4 = node('d2d4', 'd4', { id: 11, rank: 1 })
  return [e4, d4]
}

describe('sortSiblings', () => {
  it('orders by rank and then by id, and does not mutate its input', () => {
    const nodes = [
      node('a2a3', 'a3', { id: 3, rank: 1 }),
      node('b2b3', 'b3', { id: 1, rank: 1 }),
      node('c2c3', 'c3', { id: 9, rank: 0 }),
    ]
    expect(sortSiblings(nodes).map((each) => each.id)).toEqual([9, 1, 3])
    expect(nodes.map((each) => each.id)).toEqual([3, 1, 9])
  })
})

describe('walk', () => {
  it('follows a line as far as the repertoire goes', () => {
    const roots = repertoire()
    expect(walk(roots, ['e2e4', 'e7e5', 'g1f3']).map((each) => each.san)).toEqual([
      'e4',
      'e5',
      'Nf3',
    ])
  })

  it('stops where the line leaves the tree rather than throwing', () => {
    const roots = repertoire()
    expect(walk(roots, ['e2e4', 'e7e6', 'd2d4']).map((each) => each.san)).toEqual(['e4'])
  })
})

describe('nodeAt', () => {
  it('answers with the node the path ends on', () => {
    expect(nodeAt(repertoire(), ['e2e4', 'c7c5'])?.id).toBe(30)
  })

  it('is null for a path that leaves the repertoire', () => {
    expect(nodeAt(repertoire(), ['e2e4', 'e7e5', 'b1c3'])).toBeNull()
  })

  it('is null at the initial array, which no node stands for', () => {
    expect(nodeAt(repertoire(), [])).toBeNull()
  })
})

describe('inRepertoire', () => {
  it('counts the initial array as in the repertoire', () => {
    expect(inRepertoire([], [])).toBe(true)
  })

  it('separates a line that is held from one that is not', () => {
    const roots = repertoire()
    expect(inRepertoire(roots, ['e2e4', 'e7e5'])).toBe(true)
    expect(inRepertoire(roots, ['e2e4', 'g8f6'])).toBe(false)
  })
})

describe('childrenAt', () => {
  it('answers with the roots at the start, in printing order', () => {
    expect(childrenAt(repertoire(), []).map((each) => each.san)).toEqual(['e4', 'd4'])
  })

  it('answers with a node’s children, main move first', () => {
    expect(childrenAt(repertoire(), ['e2e4']).map((each) => each.san)).toEqual(['e5', 'c5'])
  })

  it('answers with nothing once the line has left the repertoire', () => {
    expect(childrenAt(repertoire(), ['e2e4', 'g8f6'])).toEqual([])
  })
})

describe('pathOf', () => {
  it('finds the path to a node deep in a sideline', () => {
    expect(pathOf(repertoire(), 40)).toEqual(['e2e4', 'e7e5', 'g1f3'])
    expect(pathOf(repertoire(), 30)).toEqual(['e2e4', 'c7c5'])
  })

  it('is null for an id no branch holds', () => {
    expect(pathOf(repertoire(), 999)).toBeNull()
  })
})

describe('countNodes', () => {
  it('counts every move in every branch', () => {
    expect(countNodes(repertoire())).toBe(5)
    expect(countNodes([])).toBe(0)
  })
})

describe('flattenTree', () => {
  it('prints movetext order: a sideline before the main move’s own continuation', () => {
    const rows = flattenTree(repertoire())
    expect(rows.map((row) => `${row.depth}:${row.node.san}`)).toEqual([
      '0:e4',
      '1:d4',
      '0:e5',
      '1:c5',
      '0:Nf3',
    ])
  })

  it('numbers plies absolutely and carries the full path of every row', () => {
    const rows = flattenTree(repertoire())
    const nf3 = rows.find((row) => row.node.san === 'Nf3')
    expect(nf3?.ply).toBe(2)
    expect(nf3?.path).toEqual(['e2e4', 'e7e5', 'g1f3'])
    const c5 = rows.find((row) => row.node.san === 'c5')
    expect(c5?.ply).toBe(1)
    expect(c5?.path).toEqual(['e2e4', 'c7c5'])
  })

  it('marks exactly the first sibling of each group as the main move', () => {
    const rows = flattenTree(repertoire())
    expect(rows.filter((row) => row.main).map((row) => row.node.san)).toEqual([
      'e4',
      'e5',
      'Nf3',
    ])
  })

  it('has nothing to print for an empty repertoire', () => {
    expect(flattenTree([])).toEqual([])
  })
})

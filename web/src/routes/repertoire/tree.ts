/**
 * The repertoire tree, as the page has to read it: by path, by id, and in reading order.
 *
 * The backend hands over one nested payload per colour and nothing else — no cursor, no
 * "current node". Everything the page shows is derived from the line in the URL, which is
 * a list of UCI moves, so the three questions asked here are the only ones there are:
 * *what node does this path end on*, *what path reaches this node*, and *in what order do
 * the nodes print*. Keeping them in a plain module rather than in the component is what
 * makes them testable without a DOM, and what keeps the page from growing a second,
 * subtly different walk.
 *
 * Sibling order is `rank` then `id`, exactly as the contract states, and the first sibling
 * after that sort is the main move. The page never trusts `rank === 0` on its own: a tree
 * mid-promotion, or one a future importer wrote, could carry no zero at all, and "the move
 * printed first" and "the move called main" must not be able to disagree on screen.
 */
import type { RepertoireNode } from '@/lib/api/types'

/** One printed line of the tree pane. */
export interface RepertoireRow {
  node: RepertoireNode
  /** The full UCI path from the initial array — what clicking the row sets `?line=` to. */
  path: string[]
  /** Absolute, like `LineStep.ply`: 0 is White's first move. */
  ply: number
  /** How far the row is indented: 0 is the main line, each sideline adds one. */
  depth: number
  /** Whether this move is the main move among its own siblings. */
  main: boolean
}

/** Siblings in printing order: `rank` first, `id` as the tie-break. */
export function sortSiblings(nodes: readonly RepertoireNode[]): RepertoireNode[] {
  return [...nodes].sort((left, right) => left.rank - right.rank || left.id - right.id)
}

function childrenOf(node: RepertoireNode): RepertoireNode[] {
  return node.children ?? []
}

/**
 * The nodes the path passes through, in order, stopping where it leaves the repertoire.
 * A shorter answer than `ucis` is exactly how far the line is still in book.
 */
export function walk(
  roots: readonly RepertoireNode[],
  ucis: readonly string[],
): RepertoireNode[] {
  const found: RepertoireNode[] = []
  let level: readonly RepertoireNode[] = roots
  for (const uci of ucis) {
    const node = level.find((candidate) => candidate.uci === uci)
    if (!node) break
    found.push(node)
    level = childrenOf(node)
  }
  return found
}

/**
 * The node the path ends on, or null when the path leaves the repertoire (or is empty —
 * the initial array is a position, not a move, and no node stands for it).
 */
export function nodeAt(
  roots: readonly RepertoireNode[],
  ucis: readonly string[],
): RepertoireNode | null {
  if (ucis.length === 0) return null
  const found = walk(roots, ucis)
  return found.length === ucis.length ? found[found.length - 1] : null
}

/** Whether the whole line is in the repertoire. The initial array always is. */
export function inRepertoire(
  roots: readonly RepertoireNode[],
  ucis: readonly string[],
): boolean {
  return ucis.length === 0 || walk(roots, ucis).length === ucis.length
}

/**
 * What may be played from the position the line stands on — the roots at the start, the
 * node's children further in, and nothing at all once the line has left the repertoire.
 */
export function childrenAt(
  roots: readonly RepertoireNode[],
  ucis: readonly string[],
): RepertoireNode[] {
  if (ucis.length === 0) return sortSiblings(roots)
  const node = nodeAt(roots, ucis)
  return node ? sortSiblings(childrenOf(node)) : []
}

/** The path that reaches a node id, or null when no branch holds it. */
export function pathOf(roots: readonly RepertoireNode[], id: number): string[] | null {
  for (const node of roots) {
    if (node.id === id) return [node.uci]
    const deeper = pathOf(childrenOf(node), id)
    if (deeper) return [node.uci, ...deeper]
  }
  return null
}

/** How many moves the tree holds in total — what the empty state is decided on. */
export function countNodes(roots: readonly RepertoireNode[]): number {
  return roots.reduce((total, node) => total + 1 + countNodes(childrenOf(node)), 0)
}

/**
 * The whole tree in movetext order.
 *
 * A sideline prints immediately after the move it is an alternative to and before that
 * move's own continuation — the order a PGN writes its parentheses in — so a branch reads
 * as "…or this instead" rather than as a second game appended to the end of the first.
 * Only sidelines indent; following the main line down the page costs no horizontal space
 * however deep it runs, which is what makes a twenty-move main line legible at all.
 */
export function flattenTree(roots: readonly RepertoireNode[]): RepertoireRow[] {
  return flatten(roots, [], 0, 0)
}

function flatten(
  nodes: readonly RepertoireNode[],
  prefix: readonly string[],
  ply: number,
  depth: number,
): RepertoireRow[] {
  const ordered = sortSiblings(nodes)
  if (ordered.length === 0) return []

  const [main, ...sidelines] = ordered
  const mainPath = [...prefix, main.uci]
  const rows: RepertoireRow[] = [{ node: main, path: mainPath, ply, depth, main: true }]

  for (const side of sidelines) {
    const sidePath = [...prefix, side.uci]
    rows.push({ node: side, path: sidePath, ply, depth: depth + 1, main: false })
    rows.push(...flatten(childrenOf(side), sidePath, ply + 1, depth + 1))
  }

  rows.push(...flatten(childrenOf(main), mainPath, ply + 1, depth))
  return rows
}

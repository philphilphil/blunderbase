/**
 * The correspondence tree, as the screens have to read it.
 *
 * The backend hands over one nested payload per game — the root, its children in rank
 * order with the played child promoted to rank 0, and every node carrying its own FEN, its
 * numbers and what the engines know. Everything the page shows is derived from that and
 * from which node is selected, so the questions asked here are the only ones there are:
 * *where is this node*, *what line does it start*, *which move does an arrow key mean*, and
 * *in what order do the candidates print*.
 *
 * Kept in a plain module rather than in the components, so the ordering that decides which
 * move the owner plays can be tested without a DOM — and so the tree pane and the
 * candidates table cannot grow two subtly different walks of the same payload.
 */
import type {
  Color,
  CorrespondenceScore,
  CorrespondenceTreeNode,
} from '@/lib/api/types'

/** Where a node sits: itself, its parent, and how deep off the played path it hangs. */
export interface Placed {
  node: CorrespondenceTreeNode
  parent: CorrespondenceTreeNode | null
}

export type TreeIndex = Map<number, Placed>

/** Every node by id, with its parent. One walk, and the components share the answer. */
export function indexTree(root: CorrespondenceTreeNode | null): TreeIndex {
  const index: TreeIndex = new Map()
  if (!root) return index
  const walk = (node: CorrespondenceTreeNode, parent: CorrespondenceTreeNode | null) => {
    index.set(node.id, { node, parent })
    for (const child of node.children) walk(child, node)
  }
  walk(root, null)
  return index
}

/** Siblings in printing order: `rank`, with the id as the tie-break a promotion cannot skew. */
export function sortSiblings(
  nodes: readonly CorrespondenceTreeNode[],
): CorrespondenceTreeNode[] {
  return [...nodes].sort((left, right) => left.rank - right.rank || left.id - right.id)
}

/**
 * The run of moves that starts at `node` and follows the first child at every step —
 * the spine of whatever line this node begins.
 */
export function mainlineFrom(node: CorrespondenceTreeNode): CorrespondenceTreeNode[] {
  const line: CorrespondenceTreeNode[] = []
  let current: CorrespondenceTreeNode | undefined = node
  // Bounded by the tree's own depth; a cycle is impossible in a payload built from a path.
  while (current) {
    line.push(current)
    current = sortSiblings(current.children)[0]
  }
  return line
}

/** The nodes from the root down to `id`, root first, or an empty list for an unknown id. */
export function pathTo(index: TreeIndex, id: number): CorrespondenceTreeNode[] {
  const path: CorrespondenceTreeNode[] = []
  let placed = index.get(id)
  while (placed) {
    path.unshift(placed.node)
    placed = placed.parent ? index.get(placed.parent.id) : undefined
  }
  return path
}

/** The played path: the root and every node the game actually reached, in order. */
export function playedPath(root: CorrespondenceTreeNode | null): CorrespondenceTreeNode[] {
  if (!root) return []
  const path = [root]
  let current = root
  for (;;) {
    const next = current.children.find((child) => child.played)
    if (!next) return path
    path.push(next)
    current = next
  }
}

/**
 * A comparable number for one score, in whatever frame it was given: bigger is better for
 * the side the frame names. A mate is ranked past every centipawn value and by distance, so
 * `M2` beats `M5` beats `+9.00`, and a node nobody has evaluated sorts last.
 */
export function scoreRank(score: CorrespondenceScore | null | undefined): number {
  if (!score) return Number.NEGATIVE_INFINITY
  const { mate, cp } = score
  if (mate !== null && mate !== undefined) {
    // `mate: 0` is "is mated" as often as "has mated"; the sign of `cp` is what tells them
    // apart when the engine folded it, and 0 without one reads as the loss it usually is.
    const sign = mate > 0 ? 1 : mate < 0 ? -1 : (cp ?? 0) >= 0 ? 1 : -1
    return sign * (1_000_000 - Math.min(999, Math.abs(mate)))
  }
  if (cp === null || cp === undefined) return Number.NEGATIVE_INFINITY
  return cp
}

/**
 * One node's score read as White's, whichever side the node's frame names.
 *
 * The tree gives every number in the frame of the side that played the move into the node,
 * because that is how a variation is read — `15.Bd3 +0.41` means White stands better. The
 * evaluation bar and everything else that talks about *the position* rather than about a
 * move speaks White's, so the two have to be told apart at the boundary: a number handed to
 * a White-frame reader in the mover's frame is the wrong sign half the time.
 */
export function inWhiteFrame(
  score: CorrespondenceScore | null | undefined,
  frame: Color,
): CorrespondenceScore | null {
  if (!score) return null
  if (frame === 'white') return score
  return {
    ...score,
    cp: score.cp === null || score.cp === undefined ? score.cp : -score.cp,
    mate: score.mate === null || score.mate === undefined ? score.mate : -score.mate,
  }
}

/** What a node is judged by: the minimax over what is under it, falling back to its own. */
export function candidateRank(node: CorrespondenceTreeNode): number {
  const backed = scoreRank(node.backed)
  return backed === Number.NEGATIVE_INFINITY ? scoreRank(node.own) : backed
}

/**
 * The selected node's children as the decision table prints them: by backed evaluation,
 * best first.
 *
 * Every child of one node was played by the same side, so their frames agree and the
 * numbers are directly comparable — which is the whole reason the table can be sorted at
 * all. An excluded move sinks below everything valued, whatever its number says: it is a
 * move the owner has ruled out, and it must not sit at the top of the list of what to play.
 * Unevaluated moves keep the tree's own order among themselves, so a line just added does
 * not jump about as the first numbers land.
 */
export function candidatesOf(node: CorrespondenceTreeNode | null): CorrespondenceTreeNode[] {
  if (!node) return []
  const ordered = sortSiblings(node.children)
  return ordered
    .map((child, position) => ({ child, position, rank: candidateRank(child) }))
    .sort((left, right) => {
      const excluded = Number(left.child.mark === 'excluded') - Number(right.child.mark === 'excluded')
      if (excluded !== 0) return excluded
      if (left.rank !== right.rank) return right.rank - left.rank
      return left.position - right.position
    })
    .map((entry) => entry.child)
}

/**
 * Whether a node's own number and the minimax under it disagree enough to say so, and
 * which way. `null` when there is nothing to compare — the arrow is a claim about a
 * refutation, not a decoration.
 */
export function backedDirection(
  node: CorrespondenceTreeNode,
): 'up' | 'down' | 'same' | null {
  const own = scoreRank(node.own)
  const backed = scoreRank(node.backed)
  if (own === Number.NEGATIVE_INFINITY || backed === Number.NEGATIVE_INFINITY) return null
  // Five centipawns: under that the two numbers are the same number with different
  // rounding, and an arrow on every node says nothing at all.
  if (Math.abs(backed - own) < 5) return 'same'
  return backed > own ? 'up' : 'down'
}

/**
 * True while this node hangs off a position the game has already left — the parent is on
 * the played path and played something else. These print greyed: they are what was
 * considered before the move was made, kept in case of a transposition.
 */
export function isLeftBehind(parent: CorrespondenceTreeNode | null, node: CorrespondenceTreeNode): boolean {
  if (!parent || !parent.played || node.played) return false
  return parent.children.some((child) => child.played)
}

export type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

/**
 * Where an arrow key goes from here: left and right walk along the line, up and down cross
 * the sibling set. The root has no siblings and no parent, so both of those stand still —
 * a key press that cannot move must leave the selection where it is rather than clear it.
 */
export function nextSelection(index: TreeIndex, id: number, key: ArrowKey): number {
  const placed = index.get(id)
  if (!placed) return id
  const { node, parent } = placed
  if (key === 'ArrowRight') return sortSiblings(node.children)[0]?.id ?? id
  if (key === 'ArrowLeft') return parent?.id ?? id
  if (!parent) return id
  const siblings = sortSiblings(parent.children)
  const at = siblings.findIndex((sibling) => sibling.id === node.id)
  if (at < 0) return id
  const to = key === 'ArrowUp' ? at - 1 : at + 1
  return siblings[to]?.id ?? id
}

/** How many nodes the tree holds — the count the pane's title strip carries. */
export function countNodes(root: CorrespondenceTreeNode | null): number {
  return root ? 1 + root.children.reduce((total, child) => total + countNodes(child), 0) : 0
}

/** How many of them an engine has a verdict on. */
export function countEvaluated(root: CorrespondenceTreeNode | null): number {
  if (!root) return 0
  const here = root.evals.length > 0 ? 1 : 0
  return here + root.children.reduce((total, child) => total + countEvaluated(child), 0)
}

/**
 * `correspondence.snapshot` straight into the query cache, never a refetch.
 *
 * A running search sends two pictures a second and may run for three days. Refetching
 * `GET /correspondence/games/{id}` on each one would be a two-hundred-node tree over the
 * wire twice a second for a change that touches one search row's `snapshot` field — so the
 * frame *is* the update, the way `live.updated` is, and this is where it is applied.
 *
 * Four places hold a copy of the same search row and all four are patched: the game's tree
 * (the node the search is on), the game detail's top-level `searches`, the
 * `/correspondence/searches` list "Running now" reads, and the games list, whose rows carry
 * the same searches as engine chips — a chip still reading `d31` three days later while the
 * card below it reads `d58` is two numbers for one search on one screen. They are patched
 * by `search_id` alone — a node id would not find the row in the flat list, and the frame
 * carries both.
 *
 * `seq` rises per search, so a frame that lost a race with a newer one is dropped rather
 * than winding the pane back. Every patch is copy-on-write down the path it changes and
 * returns the *same* object where nothing moved, so React Query's structural sharing does
 * not re-render a tree of two hundred nodes for one search's depth going from 41 to 42.
 */
import type { QueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/api/keys'
import type {
  CorrespondenceGameDetail,
  CorrespondenceGameList,
  CorrespondenceGameSummary,
  CorrespondenceSearch,
  CorrespondenceSearchList,
  CorrespondenceSnapshot,
  CorrespondenceTreeNode,
} from '@/lib/api/types'

import type { CorrespondenceSnapshotEvent } from './types'

/** The frame as the row carries it — the event minus its name. */
export function snapshotOf(event: CorrespondenceSnapshotEvent): CorrespondenceSnapshot {
  const { event: _name, ...snapshot } = event
  return snapshot as CorrespondenceSnapshot
}

/** The row with the newer picture on it, or the row itself when the frame is stale. */
function withSnapshot(
  search: CorrespondenceSearch,
  snapshot: CorrespondenceSnapshot,
): CorrespondenceSearch {
  const held = search.snapshot
  if (held && held.seq > snapshot.seq) return search
  return { ...search, snapshot }
}

function patchSearches(
  searches: CorrespondenceSearch[],
  snapshot: CorrespondenceSnapshot,
): CorrespondenceSearch[] {
  let moved = false
  const next = searches.map((search) => {
    if (search.id !== snapshot.search_id) return search
    const patched = withSnapshot(search, snapshot)
    if (patched !== search) moved = true
    return patched
  })
  return moved ? next : searches
}

function patchNode(
  node: CorrespondenceTreeNode,
  snapshot: CorrespondenceSnapshot,
): CorrespondenceTreeNode {
  const searches = patchSearches(node.searches, snapshot)
  let children = node.children
  let childrenMoved = false
  const nextChildren = node.children.map((child) => {
    const patched = patchNode(child, snapshot)
    if (patched !== child) childrenMoved = true
    return patched
  })
  if (childrenMoved) children = nextChildren
  if (searches === node.searches && children === node.children) return node
  return { ...node, searches, children }
}

/**
 * Apply one frame everywhere a copy of that search row lives. Called from the socket, so
 * it never throws for a cache that holds nothing yet — an absent query is simply skipped
 * and the row arrives with its `snapshot` on the next fetch.
 */
export function applyCorrespondenceSnapshot(
  client: QueryClient,
  event: CorrespondenceSnapshotEvent,
): void {
  const snapshot = snapshotOf(event)

  if (typeof event.game_id === 'number') {
    client.setQueryData<CorrespondenceGameDetail>(
      queryKeys.correspondenceGame(event.game_id),
      (detail) => {
        if (!detail) return detail
        const tree = detail.tree ? patchNode(detail.tree, snapshot) : detail.tree
        const searches = patchSearches(detail.searches, snapshot)
        if (tree === detail.tree && searches === detail.searches) return detail
        return { ...detail, tree, searches }
      },
    )
  }

  for (const active of [true, false]) {
    client.setQueryData<CorrespondenceSearchList>(
      queryKeys.correspondenceSearches(active),
      (list) => {
        if (!list) return list
        const searches = patchSearches(list.searches, snapshot)
        return searches === list.searches ? list : { ...list, searches }
      },
    )
  }

  // Every cut of the games list that is cached — the page holds one per state — because
  // the chips on a row are the same search rows under another name.
  client.setQueriesData<CorrespondenceGameList>(
    { queryKey: queryKeys.correspondenceGameLists() },
    (list) => {
      if (!list) return list
      const games = patchGames(list.games, snapshot)
      return games === list.games ? list : { ...list, games }
    },
  )
}

function patchGames(
  games: CorrespondenceGameSummary[],
  snapshot: CorrespondenceSnapshot,
): CorrespondenceGameSummary[] {
  let moved = false
  const next = games.map((game) => {
    if (!game.searches || game.searches.length === 0) return game
    const searches = patchSearches(game.searches, snapshot)
    if (searches === game.searches) return game
    moved = true
    return { ...game, searches }
  })
  return moved ? next : games
}

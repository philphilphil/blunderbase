import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { queryKeys } from '@/lib/api/keys'
import type {
  CorrespondenceGameDetail,
  CorrespondenceGameList,
  CorrespondenceGameSummary,
  CorrespondenceSearchList,
  CorrespondenceTreeNode,
} from '@/lib/api/types'

import { applyCorrespondenceSnapshot } from './correspondenceSnapshots'
import type { CorrespondenceSnapshotEvent } from './types'

function frame(patch: Partial<CorrespondenceSnapshotEvent> = {}): CorrespondenceSnapshotEvent {
  return {
    event: 'correspondence.snapshot',
    search_id: 7,
    node_id: 4,
    game_id: 1,
    engine_id: 1,
    engine_name: 'Stockfish 17',
    seq: 5,
    depth: 51,
    nodes: 7_200_000,
    nps: 41_000_000,
    time_ms: 180_000,
    lines: [{ multipv: 1, cp: 34, pv: ['e7e6'] }],
    ...patch,
  }
}

function node(patch: Partial<CorrespondenceTreeNode> = {}): CorrespondenceTreeNode {
  return {
    id: 4,
    game_id: 1,
    parent_id: 1,
    uci: 'g1f3',
    san: 'Nf3',
    epd: 'epd',
    ply: 1,
    rank: 0,
    played: false,
    conditional: false,
    collapsed: false,
    comment: '',
    fen: 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1',
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

const SEARCH = {
  id: 7,
  node_id: 4,
  game_id: 1,
  engine_id: 1,
  engine_name: 'Stockfish 17',
  kind: 'search' as const,
  status: 'running' as const,
  multipv: 3,
}

function seeded() {
  const client = new QueryClient()
  const tree = node({
    id: 1,
    parent_id: null,
    uci: null,
    san: null,
    children: [node({ searches: [{ ...SEARCH }] })],
  })
  client.setQueryData<CorrespondenceGameDetail>(queryKeys.correspondenceGame(1), {
    game: { game_id: 1 } as CorrespondenceGameDetail['game'],
    tree,
    searches: [{ ...SEARCH }],
  })
  client.setQueryData<CorrespondenceSearchList>(queryKeys.correspondenceSearches(true), {
    searches: [{ ...SEARCH }],
  })
  client.setQueryData<CorrespondenceGameList>(queryKeys.correspondenceGames(), {
    games: [
      { game_id: 1, searches: [{ ...SEARCH }] } as CorrespondenceGameSummary,
      { game_id: 2, searches: [] } as unknown as CorrespondenceGameSummary,
    ],
    counts: {},
  })
  client.setQueryData<CorrespondenceGameList>(queryKeys.correspondenceGames('ongoing'), {
    games: [{ game_id: 1, searches: [{ ...SEARCH }] } as CorrespondenceGameSummary],
    counts: {},
  })
  return client
}

function chips(client: QueryClient, state?: 'ongoing' | 'finished') {
  return client.getQueryData<CorrespondenceGameList>(queryKeys.correspondenceGames(state))
}

describe('applyCorrespondenceSnapshot', () => {
  it('writes the picture onto every copy of the row, by search id', () => {
    const client = seeded()
    applyCorrespondenceSnapshot(client, frame())

    const detail = client.getQueryData<CorrespondenceGameDetail>(queryKeys.correspondenceGame(1))
    expect(detail?.tree?.children[0].searches[0].snapshot?.depth).toBe(51)
    expect(detail?.searches[0].snapshot?.depth).toBe(51)
    const list = client.getQueryData<CorrespondenceSearchList>(
      queryKeys.correspondenceSearches(true),
    )
    expect(list?.searches[0].snapshot?.nodes).toBe(7_200_000)
  })

  it('moves the engine chips on every cached cut of the games list', () => {
    const client = seeded()
    applyCorrespondenceSnapshot(client, frame({ depth: 58 }))

    expect(chips(client)?.games[0].searches?.[0].snapshot?.depth).toBe(58)
    expect(chips(client, 'ongoing')?.games[0].searches?.[0].snapshot?.depth).toBe(58)
    // A row with no search of its own is the same object it was.
    const before = chips(client)?.games[1]
    applyCorrespondenceSnapshot(client, frame({ seq: 6, depth: 59 }))
    expect(chips(client)?.games[1]).toBe(before)
  })

  it('drops a frame that lost a race with a newer one', () => {
    const client = seeded()
    applyCorrespondenceSnapshot(client, frame({ seq: 9, depth: 52 }))
    applyCorrespondenceSnapshot(client, frame({ seq: 4, depth: 30 }))

    const detail = client.getQueryData<CorrespondenceGameDetail>(queryKeys.correspondenceGame(1))
    expect(detail?.tree?.children[0].searches[0].snapshot?.depth).toBe(52)
  })

  it('leaves untouched nodes identical, so a tree of hundreds does not re-render', () => {
    const client = seeded()
    const before = client.getQueryData<CorrespondenceGameDetail>(queryKeys.correspondenceGame(1))
    applyCorrespondenceSnapshot(client, frame({ search_id: 999 }))
    const after = client.getQueryData<CorrespondenceGameDetail>(queryKeys.correspondenceGame(1))
    expect(after).toBe(before)
  })

  it('does nothing at all for a game nothing has fetched', () => {
    const client = new QueryClient()
    expect(() => applyCorrespondenceSnapshot(client, frame({ game_id: 404 }))).not.toThrow()
    expect(client.getQueryData(queryKeys.correspondenceGame(404))).toBeUndefined()
  })
})

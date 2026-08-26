import type { QueryKey } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { queryKeys } from '@/lib/api/keys'

import { dedupeKeys, invalidationsFor } from './invalidation'
import { parseEvent, type AnyEvent } from './types'

function names(keys: QueryKey[]): string[] {
  return keys.map((key) => JSON.stringify(key))
}

function has(keys: QueryKey[], key: QueryKey): boolean {
  return names(keys).includes(JSON.stringify(key))
}

describe('invalidationsFor — import', () => {
  const started: AnyEvent = {
    event: 'import.started',
    job_id: 3,
    source: 'lichess',
    at: '2026-08-25T10:00:00Z',
  }

  it('refetches the sync history, the games and the aggregates', () => {
    const keys = invalidationsFor(started)
    expect(has(keys, queryKeys.imports())).toBe(true)
    expect(has(keys, queryKeys.games())).toBe(true)
    expect(has(keys, queryKeys.stats())).toBe(true)
  })

  it('touches the queue, because an imported game is enqueued for a quick pass', () => {
    expect(has(invalidationsFor({ ...started, event: 'import.game' }), queryKeys.queue())).toBe(
      true,
    )
  })

  it('treats all three import events the same way', () => {
    const game = invalidationsFor({ ...started, event: 'import.game' })
    const finished = invalidationsFor({ ...started, event: 'import.finished' })
    expect(names(game)).toEqual(names(finished))
  })
})

describe('invalidationsFor — analysis lifecycle', () => {
  const base = { run_id: 9, game_id: 4, tier: 'quick' as const, status: 'queued' as const }

  it('refetches analysis and games when a run is queued or starts', () => {
    for (const event of ['analysis.queued', 'analysis.running'] as const) {
      const keys = invalidationsFor({ ...base, event })
      expect(has(keys, queryKeys.analysis())).toBe(true)
      expect(has(keys, queryKeys.games())).toBe(true)
    }
  })

  it('refetches games, stats and the explorer when a run finishes', () => {
    for (const event of ['analysis.done', 'analysis.failed'] as const) {
      const keys = invalidationsFor({ ...base, event, status: 'done' })
      expect(has(keys, queryKeys.analysis())).toBe(true)
      expect(has(keys, queryKeys.games())).toBe(true)
      expect(has(keys, queryKeys.stats())).toBe(true)
      expect(has(keys, queryKeys.explorer())).toBe(true)
    }
  })

  it('keeps progress cheap: the queue only, never the games table', () => {
    const keys = invalidationsFor({
      ...base,
      event: 'analysis.progress',
      status: 'running',
      done: 12,
      total: 40,
    })
    expect(names(keys)).toEqual([JSON.stringify(queryKeys.queue())])
    expect(has(keys, queryKeys.games())).toBe(false)
  })
})

describe('invalidationsFor — notes', () => {
  const note = {
    note_id: 12,
    text: 'knight grabs on defended squares',
    tags: ['pattern'],
    position_id: null,
    created_at: '2026-08-25T10:00:00Z',
    updated_at: '2026-08-25T10:00:00Z',
  }

  it('refetches the notes and the one game the note hangs on', () => {
    const keys = invalidationsFor({ ...note, event: 'note.created', game_id: 42 })
    expect(has(keys, queryKeys.notes())).toBe(true)
    expect(has(keys, ['games', 'detail', 42])).toBe(true)
  })

  it('leaves the games table alone — a note changes no row in it', () => {
    const keys = invalidationsFor({ ...note, event: 'note.updated', game_id: 42 })
    expect(has(keys, queryKeys.games())).toBe(false)
  })

  it('refetches only the notes for a standalone note', () => {
    const keys = invalidationsFor({ ...note, event: 'note.created', game_id: null })
    expect(names(keys)).toEqual([JSON.stringify(queryKeys.notes())])
  })
})

describe('invalidationsFor — quiet events', () => {
  it('invalidates nothing for a keepalive', () => {
    expect(invalidationsFor({ event: 'ping' })).toEqual([])
  })

  it('invalidates nothing for the live board, which arrives whole on the socket', () => {
    expect(
      invalidationsFor({
        event: 'live.updated',
        active: true,
        moves: [],
        arrows: [],
        squares: [],
        viewer_count: 1,
      }),
    ).toEqual([])
  })

  it('ignores an event name it does not know', () => {
    expect(invalidationsFor({ event: 'something.new' })).toEqual([])
  })
})

describe('dedupeKeys', () => {
  it('drops a key a broader prefix already covers', () => {
    const keys = dedupeKeys([queryKeys.games(), ['games', 'detail', 4], queryKeys.notes()])
    expect(names(keys)).toEqual(names([queryKeys.games(), queryKeys.notes()]))
  })

  it('removes duplicates', () => {
    expect(dedupeKeys([queryKeys.stats(), queryKeys.stats()])).toHaveLength(1)
  })

  it('keeps siblings that do not contain each other', () => {
    expect(dedupeKeys([['games', 'detail', 1], ['games', 'detail', 2]])).toHaveLength(2)
  })
})

describe('parseEvent', () => {
  it('reads a frame off the wire', () => {
    expect(parseEvent('{"event":"ping"}')).toEqual({ event: 'ping' })
  })

  it('rejects anything that is not a shaped event', () => {
    expect(parseEvent('not json')).toBeNull()
    expect(parseEvent('{"nope":1}')).toBeNull()
    expect(parseEvent('[]')).toBeNull()
  })
})

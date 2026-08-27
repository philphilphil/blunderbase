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

  it('refetches the analysis rows and the queue widget when a run is queued or starts', () => {
    for (const event of ['analysis.queued', 'analysis.running'] as const) {
      const keys = invalidationsFor({ ...base, event })
      // `['analysis']` is the prefix of `['analysis', 'queue']`, so the widget comes along
      // with the rows and one key is enough.
      expect(names(keys)).toEqual([JSON.stringify(queryKeys.analysis())])
    }
  })

  // Queueing sixty games is sixty `queued` frames and sixty `running` frames; the games
  // table is the most expensive read there is, and its badge catches up at `done`.
  it('keeps the lifecycle cheap: never the games table before a run has finished', () => {
    for (const event of ['analysis.queued', 'analysis.running'] as const) {
      expect(has(invalidationsFor({ ...base, event }), queryKeys.games())).toBe(false)
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

describe('invalidationsFor — runners', () => {
  const connected: AnyEvent = {
    event: 'runner.connected',
    runner_id: 3,
    name: 'gpu-box',
    slots: 4,
    version: '0.1.0',
    transport: 'websocket',
    engines: ['sf-remote'],
    at: '2026-08-26T10:00:00Z',
  }

  it('refetches the runners, the queue split and the engines when a link comes or goes', () => {
    for (const event of ['runner.connected', 'runner.disconnected'] as const) {
      const keys = invalidationsFor({ ...connected, event })
      expect(has(keys, queryKeys.runners())).toBe(true)
      expect(has(keys, queryKeys.queue())).toBe(true)
      // A disconnect flips `enabled` on that runner's rows, and with it which tiers can run.
      expect(has(keys, queryKeys.engines())).toBe(true)
    }
  })

  it('keeps a slot change cheap: the runners and the queue, never the engine list', () => {
    const keys = invalidationsFor({
      event: 'runner.updated',
      runner_id: 3,
      name: 'gpu-box',
      slots: 4,
      connected: true,
      busy: 2,
      streams: 1,
      free_slots: 1,
      at: '2026-08-26T10:00:00Z',
    })
    expect(names(keys)).toEqual(names([queryKeys.runners(), queryKeys.queue()]))
    expect(has(keys, queryKeys.engines())).toBe(false)
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

  // Two a second per open board: anything but `[]` here is a refetch loop.
  it('invalidates nothing for a stream snapshot, which arrives whole and often', () => {
    expect(
      invalidationsFor({
        event: 'stream.snapshot',
        session_id: 'str_7f3c9a12',
        seq: 7,
        engine_id: 7,
        engine: 'sf-remote',
        runner_id: 3,
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        multipv: 3,
        depth: 24,
        nodes: 18_402_113,
        nps: 1_840_211,
        time_ms: 10_000,
        lines: [{ multipv: 1, cp: 34, mate: null, pv: ['e2e4'] }],
        at: '2026-08-26T10:00:10Z',
      }),
    ).toEqual([])
  })

  it('invalidates nothing when a stream starts or ends — the frame says it all', () => {
    expect(
      invalidationsFor({
        event: 'stream.ended',
        session_id: 'str_7f3c9a12',
        reason: 'runner_gone',
        error: null,
        engine_id: 7,
        runner_id: 3,
        at: '2026-08-26T10:00:10Z',
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

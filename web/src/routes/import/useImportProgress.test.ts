import { describe, expect, it } from 'vitest'

import type { ImportJob } from '@/lib/api/types'
import type { AnyEvent } from '@/lib/events/types'

import { duration, stamp } from './format'
import {
  MAX_TRACKED_FAILURES,
  reduceImportProgress,
  type ImportProgressState,
} from './useImportProgress'

const started: AnyEvent = {
  event: 'import.started',
  job_id: 7,
  source: 'lichess',
  at: '2026-08-26T00:50:19Z',
}

function game(overrides: Record<string, unknown> = {}): AnyEvent {
  return {
    event: 'import.game',
    job_id: 7,
    source: 'lichess',
    ref: 'abc123',
    status: 'imported',
    game_id: 3,
    error: null,
    seen: 1,
    imported: 1,
    skipped: 0,
    failed: 0,
    ...overrides,
  } as AnyEvent
}

function fold(events: AnyEvent[]): ImportProgressState {
  return events.reduce<ImportProgressState>(reduceImportProgress, {})
}

describe('reduceImportProgress', () => {
  it('opens an entry for the source when a sync starts', () => {
    const state = fold([started])
    expect(state.lichess).toMatchObject({ jobId: 7, running: true, seen: 0, imported: 0 })
  })

  it('follows the counts each import.game frame carries', () => {
    const state = fold([started, game(), game({ seen: 2, imported: 2, ref: 'def456' })])
    expect(state.lichess).toMatchObject({ seen: 2, imported: 2, lastRef: 'def456', running: true })
  })

  it('collects the games that failed, with the reason', () => {
    const state = fold([
      started,
      game({ status: 'failed', ref: 'bad1', error: 'no moves', seen: 1, imported: 0, failed: 1 }),
    ])
    expect(state.lichess?.failures).toEqual([{ ref: 'bad1', error: 'no moves' }])
    expect(state.lichess?.failed).toBe(1)
  })

  it('caps the failures it keeps — the job row is the full record', () => {
    const failures = Array.from({ length: MAX_TRACKED_FAILURES + 10 }, (_, index) =>
      game({ status: 'failed', ref: `bad${index}`, error: 'nope', failed: index + 1 }),
    )
    const state = fold([started, ...failures])
    expect(state.lichess?.failures).toHaveLength(MAX_TRACKED_FAILURES)
    // The newest are the ones kept.
    expect(state.lichess?.failures.at(-1)?.ref).toBe(`bad${MAX_TRACKED_FAILURES + 9}`)
  })

  it('records how the sync ended', () => {
    const state = fold([
      started,
      game(),
      {
        event: 'import.finished',
        job_id: 7,
        source: 'lichess',
        status: 'failed',
        seen: 1,
        imported: 1,
        skipped: 0,
        failed: 0,
        message: 'ValueError: a lichess import needs the username',
        at: '2026-08-26T00:50:21Z',
      } as AnyEvent,
    ])
    expect(state.lichess).toMatchObject({
      running: false,
      status: 'failed',
      message: 'ValueError: a lichess import needs the username',
      finishedAt: '2026-08-26T00:50:21Z',
    })
  })

  it('starts a second sync of the same source from zero', () => {
    const state = fold([started, game({ seen: 9, imported: 9 }), started])
    expect(state.lichess).toMatchObject({ seen: 0, imported: 0, running: true })
  })

  it('keeps sources apart', () => {
    const state = fold([started, game({ source: 'chesscom', seen: 4, imported: 4 })])
    expect(state.lichess?.seen).toBe(0)
    expect(state.chesscom?.seen).toBe(4)
  })

  it('returns the same state for frames that are not imports', () => {
    const state = fold([started])
    expect(reduceImportProgress(state, { event: 'ping' })).toBe(state)
    expect(
      reduceImportProgress(state, { event: 'analysis.progress', run_id: 1 } as AnyEvent),
    ).toBe(state)
  })
})

describe('history formatting', () => {
  const job = (started_at: string | null, finished_at: string | null): ImportJob => ({
    id: 1,
    source: 'lichess',
    status: 'done',
    created_at: '2026-08-26T00:50:19Z',
    started_at,
    finished_at,
    games_seen: 0,
    games_imported: 0,
    games_skipped: 0,
    games_blocked: 0,
    games_failed: 0,
    errors: [],
  })

  it('writes short syncs with a decimal and long ones in minutes', () => {
    expect(duration(job('2026-08-26T00:50:19Z', '2026-08-26T00:50:20.300Z'))).toBe('1.3s')
    expect(duration(job('2026-08-26T00:50:19Z', '2026-08-26T00:51:06Z'))).toBe('47s')
    expect(duration(job('2026-08-26T00:50:19Z', '2026-08-26T00:54:31Z'))).toBe('4m 12s')
  })

  it('has an em dash for a sync that never finished', () => {
    expect(duration(job('2026-08-26T00:50:19Z', null))).toBe('—')
    expect(stamp(null)).toBe('—')
    expect(stamp('not a date')).toBe('—')
  })
})

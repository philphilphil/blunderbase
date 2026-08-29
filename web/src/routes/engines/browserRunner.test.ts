import { describe, expect, it } from 'vitest'

import type { BrowserRunnerState } from '@/lib/runner'

import { engineLabel, hasEngine, statusLabel } from './browserRunner'

function state(over: Partial<BrowserRunnerState> = {}): BrowserRunnerState {
  return {
    phase: 'connected',
    runnerId: 4,
    runnerName: 'Chrome on macOS',
    engineName: 'Stockfish 18',
    threads: 8,
    isolated: true,
    activeRuns: 0,
    error: null,
    refused: [],
    ...over,
  }
}

describe('engineLabel', () => {
  it('says browser rather than a path, and how many threads it got', () => {
    expect(engineLabel(state())).toBe('Stockfish 18 · browser · 8 threads')
  })

  it('says plainly when the page was not allowed to be isolated', () => {
    // The one line that turns "analysis is oddly slow" into something the owner can fix.
    expect(engineLabel(state({ threads: 1, isolated: false }))).toBe(
      'Stockfish 18 · browser · 1 thread (not isolated)',
    )
  })

  it('does not blame isolation for a machine that simply has one core', () => {
    expect(engineLabel(state({ threads: 1, isolated: true }))).toBe(
      'Stockfish 18 · browser · 1 thread',
    )
  })

  it('names the engine as something before the handshake has named it', () => {
    expect(engineLabel(state({ engineName: null, threads: 1 }))).toContain('Stockfish · browser')
    expect(hasEngine(state({ engineName: null }))).toBe(false)
    expect(hasEngine(state())).toBe(true)
  })
})

describe('statusLabel', () => {
  it('distinguishes idle from working, and says what it is working on', () => {
    expect(statusLabel(state())).toEqual({ label: 'connected · idle', tone: 'connected' })
    expect(statusLabel(state({ activeRuns: 1 })).label).toBe('analysing a game')
    expect(statusLabel(state({ activeRuns: 3 })).label).toBe('analysing 3 games')
  })

  it('gives a stopped runner a louder tone than one that is merely reconnecting', () => {
    expect(statusLabel(state({ phase: 'refused' }))).toEqual({ label: 'stopped', tone: 'bad' })
    expect(statusLabel(state({ phase: 'retrying' }))).toEqual({
      label: 'reconnecting',
      tone: 'degraded',
    })
    expect(statusLabel(state({ phase: 'off' })).tone).toBe('away')
    // Loading 15 MB of weights is not an error and must not read as one.
    expect(statusLabel(state({ phase: 'starting' }))).toEqual({
      label: 'loading the engine',
      tone: 'working',
    })
  })
})

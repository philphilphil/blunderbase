import { describe, expect, it } from 'vitest'

import { isBestMoveLine, parseIdName, parseInfo, parseOption } from './uci'

/**
 * The handshake `sf_18_smallnet` really prints, captured from the shipped build. Every
 * expectation below was produced by running these same lines through python-chess's own
 * option parser, because the server validates a runner's advertisement against a probe
 * built exactly that way.
 */
const HANDSHAKE = `id name Stockfish 18
id author the Stockfish developers (see AUTHORS file)
option name Debug Log File type string default <empty>
option name NumaPolicy type string default auto
option name Threads type spin default 1 min 1 max 1024
option name Hash type spin default 16 min 1 max 2048
option name Clear Hash type button
option name Ponder type check default false
option name MultiPV type spin default 1 min 1 max 256
option name Skill Level type spin default 20 min 0 max 20
option name Move Overhead type spin default 10 min 0 max 5000
option name nodestime type spin default 0 min 0 max 10000
option name UCI_Chess960 type check default false
option name UCI_LimitStrength type check default false
option name UCI_Elo type spin default 1320 min 1320 max 3190
option name UCI_ShowWDL type check default false
option name SyzygyPath type string default <empty>
option name SyzygyProbeDepth type spin default 1 min 1 max 100
option name Syzygy50MoveRule type check default true
option name SyzygyProbeLimit type spin default 7 min 0 max 7
option name EvalFile type string default nn-4ca89e4b3abf.nnue
uciok`.split('\n')

function declared() {
  return HANDSHAKE.map(parseOption).filter((option) => option !== null)
}

describe('parseOption', () => {
  it('reads every option the real handshake declares', () => {
    expect(declared().map((option) => option.name)).toEqual([
      'Debug Log File',
      'NumaPolicy',
      'Threads',
      'Hash',
      'Clear Hash',
      'Ponder',
      'MultiPV',
      'Skill Level',
      'Move Overhead',
      'nodestime',
      'UCI_Chess960',
      'UCI_LimitStrength',
      'UCI_Elo',
      'UCI_ShowWDL',
      'SyzygyPath',
      'SyzygyProbeDepth',
      'Syzygy50MoveRule',
      'SyzygyProbeLimit',
      'EvalFile',
    ])
  })

  it('coerces each default the way python-chess does', () => {
    const byName = new Map(declared().map((option) => [option.name, option]))
    expect(byName.get('Threads')).toEqual({
      name: 'Threads',
      type: 'spin',
      default: 1,
      min: 1,
      max: 1024,
      var: [],
      managed: false,
    })
    expect(byName.get('Ponder')).toEqual({
      name: 'Ponder',
      type: 'check',
      default: false,
      min: null,
      max: null,
      var: [],
      managed: true,
    })
    expect(byName.get('Clear Hash')?.default).toBeNull()
    expect(byName.get('Syzygy50MoveRule')?.default).toBe(true)
    expect(byName.get('EvalFile')?.default).toBe('nn-4ca89e4b3abf.nnue')
    // python-chess parses a string option's default verbatim, so the placeholder stays the
    // literal text and does not become an empty string.
    expect(byName.get('Debug Log File')?.default).toBe('<empty>')
  })

  it('marks exactly the options python-chess manages per call', () => {
    const managed = declared()
      .filter((option) => option.managed)
      .map((option) => option.name)
    expect(managed).toEqual(['Ponder', 'MultiPV', 'UCI_Chess960'])
  })

  it('is not fooled by lines that are not options', () => {
    expect(parseOption('uciok')).toBeNull()
    expect(parseOption('id name Stockfish 18')).toBeNull()
    expect(parseOption('info depth 1 score cp 12')).toBeNull()
  })

  it('reads a combo option with its choices', () => {
    expect(parseOption('option name Style type combo default Normal var Solid var Normal')).toEqual({
      name: 'Style',
      type: 'combo',
      default: 'Normal',
      min: null,
      max: null,
      var: ['Solid', 'Normal'],
      managed: false,
    })
  })
})

describe('parseIdName', () => {
  it('reads the engine name and ignores the author', () => {
    expect(parseIdName('id name Stockfish 18')).toBe('Stockfish 18')
    expect(parseIdName('id author the Stockfish developers (see AUTHORS file)')).toBeNull()
  })
})

describe('parseInfo', () => {
  it('reads a search line as the engine prints it', () => {
    expect(
      parseInfo(
        'info depth 12 seldepth 24 multipv 1 score cp 35 nodes 200196 nps 1588857 ' +
          'hashfull 71 tbhits 0 time 126 pv e2e4 e7e5 g1f3',
      ),
    ).toEqual({
      depth: 12,
      multipv: 1,
      nodes: 200196,
      // `nps` and `time` are the analysis board's, and `time` stays in UCI's own
      // milliseconds rather than going through python-chess's seconds and back.
      nps: 1588857,
      timeMs: 126,
      score: { cp: 35, mate: null, bounded: false },
      pv: ['e2e4', 'e7e5', 'g1f3'],
    })
  })

  it('reads a mate score and a bound marker', () => {
    // A bounded score is "at least this much" mid-window, which a board must not draw.
    expect(parseInfo('info depth 20 multipv 2 score mate -3 upperbound pv d8h4')?.score).toEqual({
      cp: null,
      mate: -3,
      bounded: true,
    })
    expect(parseInfo('info depth 9 score cp 900 lowerbound pv e2e4')?.score?.bounded).toBe(true)
  })

  it('ignores the engine talking to its log', () => {
    expect(parseInfo('info string NNUE evaluation using nn-4ca89e4b3abf.nnue')).toBeNull()
    expect(parseInfo('bestmove e2e4 ponder e7e5')).toBeNull()
  })

  it('leaves a field the line never mentioned null, so the caller can merge', () => {
    expect(parseInfo('info depth 3 currmove e2e4 currmovenumber 1')).toEqual({
      depth: 3,
      multipv: null,
      nodes: null,
      nps: null,
      timeMs: null,
      score: null,
      pv: null,
    })
  })
})

describe('isBestMoveLine', () => {
  it('ends a search, whether or not there was a move to name', () => {
    expect(isBestMoveLine('bestmove e2e4 ponder e7e5')).toBe(true)
    expect(isBestMoveLine('bestmove (none)')).toBe(true)
    expect(isBestMoveLine('info depth 1')).toBe(false)
  })
})

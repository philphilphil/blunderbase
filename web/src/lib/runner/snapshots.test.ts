import { describe, expect, it } from 'vitest'

import { positionFrom } from './board'
import { SnapshotBuffer } from './snapshots'
import { parseInfo } from './uci'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const BLACK_TO_MOVE = 'rnbqkbnr/pppppppp/8/8/8/5P2/PPPPP1PP/RNBQKBNR b KQkq - 0 1'

/** A clock a test moves by hand, so the throttle is tested rather than the machine. */
function clock() {
  let now = 0
  return {
    now: () => now,
    pass: (ms: number) => {
      now += ms
    },
  }
}

function buffer(fen = START, multipv = 2, intervalMs = 500) {
  const time = clock()
  return {
    time,
    buffer: new SnapshotBuffer(positionFrom(fen)!, { multipv, intervalMs, clock: time.now }),
  }
}

function offer(target: SnapshotBuffer, line: string) {
  return target.offer(parseInfo(line)!)
}

describe('SnapshotBuffer', () => {
  it('hands the first picture over at once and the rest on the interval', () => {
    const { buffer: merge, time } = buffer()

    // A board must not be blank for half a second before its first evaluation appears.
    expect(offer(merge, 'info depth 6 multipv 1 score cp 20 nodes 900 pv e2e4')).not.toBeNull()

    time.pass(100)
    expect(offer(merge, 'info depth 7 multipv 1 score cp 22 nodes 1800 pv d2d4')).toBeNull()

    time.pass(400)
    const due = merge.due()
    expect(due).toMatchObject({ depth: 7, nodes: 1800 })
    // Nothing has changed since, so there is nothing to hand over.
    expect(merge.due()).toBeNull()
  })

  it('merges the ranks of one depth into one picture', () => {
    // The naive thing — one snapshot per `info` — draws a board whose second variation
    // belongs to the previous depth.
    const { buffer: merge } = buffer()
    offer(merge, 'info depth 12 multipv 1 score cp 35 nodes 200196 nps 1588857 time 126 pv e2e4 e7e5')
    offer(merge, 'info depth 12 multipv 2 score cp 28 nodes 200196 nps 1588857 time 126 pv d2d4 d7d5')

    const picture = merge.flush()!
    expect(picture).toMatchObject({ depth: 12, nodes: 200196, nps: 1588857, timeMs: 126 })
    expect(picture.lines).toEqual([
      { multipv: 1, cp: 35, mate: null, pv: ['e2e4', 'e7e5'] },
      { multipv: 2, cp: 28, mate: null, pv: ['d2d4', 'd7d5'] },
    ])
  })

  it('writes a line from the side to move, not from White', () => {
    // `MoveEval.best_lines` is White's; a board is the mover's, because it answers "who is
    // better *here*". The two shapes are otherwise identical, which is why this is stated.
    const { buffer: merge } = buffer(BLACK_TO_MOVE, 1)
    const picture = offer(merge, 'info depth 10 multipv 1 score cp 60 nodes 500 pv e7e5')!
    expect(picture.lines).toEqual([{ multipv: 1, cp: 60, mate: null, pv: ['e7e5'] }])
  })

  it('folds a delivered mate the way the stored row does', () => {
    // `mate 0` cannot carry the sign of "was mated" against "has mated" on its own, so
    // `storedCp` puts the folded score into `cp` for that one case.
    const { buffer: merge } = buffer(BLACK_TO_MOVE, 1)
    const picture = offer(merge, 'info depth 1 multipv 1 score mate 0 nodes 1 pv e7e5')!
    expect(picture.lines).toEqual([{ multipv: 1, cp: -10_000, mate: 0, pv: ['e7e5'] }])
  })

  it('shows no bounded score, no rank past the multipv, and no illegal line', () => {
    const { buffer: merge } = buffer(START, 2)
    offer(merge, 'info depth 9 multipv 1 score cp 900 lowerbound nodes 10 pv e2e4')
    offer(merge, 'info depth 9 multipv 2 score cp 5 nodes 10 pv h1h8')
    offer(merge, 'info depth 9 multipv 3 score cp 1 nodes 10 pv d2d4')

    // Depth and nodes moved, so a picture is due — with nothing on it worth drawing.
    expect(merge.flush()!.lines).toEqual([])
  })

  it('truncates a variation at twelve plies and at the first move that will not replay', () => {
    const long = [
      'e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6',
      'e1g1', 'f8e7', 'f1e1', 'b7b5', 'a4b3', 'd7d6',
    ]
    const { buffer: merge } = buffer(START, 1)
    const picture = offer(merge, `info depth 20 multipv 1 score cp 30 nodes 900 pv ${long.join(' ')}`)!
    expect(picture.lines[0]!.pv).toEqual(long.slice(0, 12))
  })

  it('has nothing to flush when nothing has changed', () => {
    const { buffer: merge } = buffer()
    expect(merge.flush()).toBeNull()
    expect(merge.due()).toBeNull()
  })
})

/**
 * The explorer walks the tree by playing moves on the board, and chessground only accepts a
 * move whose destination is in `movable.dests`. `Board` has no prop for those, so the page
 * writes them through the `Api` handle the component publishes.
 *
 * That leans on two things chessground's `configure` does: it deep-merges, and it only
 * clears `movable.dests` when the incoming config carries its own. If either changed, the
 * board would silently stop accepting moves — hence this test rather than a comment.
 */
import type { Api } from '@lichess-org/chessground/api'
import { render } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { Board } from '@/components/board/Board'

import { buildLine } from '../line'

const AFTER_E4 = buildLine(['e2e4'])

describe('the explorer’s board wiring', () => {
  it('keeps the destinations the page wrote when the board is reconfigured', () => {
    const ref = createRef<Api | null>()
    const { rerender } = render(
      <Board fen={AFTER_E4.fen} viewOnly={false} turnColor="black" ref={ref} />,
    )

    const api = ref.current
    expect(api).not.toBeNull()
    api!.set({ movable: { free: false, showDests: true, dests: AFTER_E4.dests } })
    expect(api!.state.movable.dests?.get('e7')).toEqual(expect.arrayContaining(['e5', 'e6']))

    // Whatever the wrapper writes next — a new last move, an arrow — must not drop them.
    rerender(
      <Board
        fen={AFTER_E4.fen}
        viewOnly={false}
        turnColor="black"
        lastMove="e2e4"
        ref={ref}
      />,
    )
    expect(ref.current).toBe(api)
    expect(api!.state.movable.dests?.get('e7')).toEqual(expect.arrayContaining(['e5', 'e6']))
    expect(api!.state.movable.free).toBe(false)
  })
})

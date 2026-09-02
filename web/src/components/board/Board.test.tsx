import type { Api } from '@lichess-org/chessground/api'
import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'

import { Board, parseLastMove } from './Board'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'

function board() {
  return screen.getByTestId('board')
}

describe('Board', () => {
  it('orients the board and reorients it when the prop changes', () => {
    const { rerender } = render(<Board fen={START} orientation="white" />)
    expect(board()).toHaveClass('orientation-white')
    rerender(<Board fen={START} orientation="black" />)
    expect(board()).toHaveClass('orientation-black')
  })

  it('draws design 1a’s edge coordinates outside the squares, flipped with the board', () => {
    const { container, rerender } = render(<Board fen={START} />)
    // chessground's own in-square coordinates (design 1b) are off.
    expect(board().querySelector('coords')).toBeNull()
    expect(container.textContent).toBe('87654321abcdefgh')
    rerender(<Board fen={START} orientation="black" />)
    expect(container.textContent).toBe('12345678hgfedcba')
  })

  it('leaves the coordinates off entirely when asked to, and can use the in-square ones', () => {
    const { container, rerender } = render(<Board fen={START} coordinates={false} />)
    expect(container.textContent).toBe('')
    expect(board().querySelector('coords')).toBeNull()
    // 1b's treatment: chessground draws them in the squares, nothing sits outside.
    rerender(<Board fen={START} coordinates="inside" />)
    expect(board().querySelector('coords')).not.toBeNull()
    expect(board().textContent).toBe(container.textContent)
  })

  it('follows the FEN it is given', () => {
    const { rerender } = render(<Board fen={START} />)
    expect(board().querySelectorAll('piece')).toHaveLength(32)
    rerender(<Board fen="8/8/8/4k3/8/8/8/4K3 w - - 0 1" />)
    expect(board().querySelectorAll('piece')).toHaveLength(2)
  })

  it('is created on the position it is given, so nothing animates in from the start', () => {
    // The ref is published from inside the creation effect, before the effect that applies
    // the props — what it sees is what chessground paints first. A board created on the
    // default position would show the initial array and then fly every piece into place.
    const seen: { fen: string | undefined; orientation: string | undefined }[] = []
    render(
      <Board
        ref={(api) => {
          if (api) seen.push({ fen: api.getFen(), orientation: api.state.orientation })
        }}
        fen={AFTER_E4}
        orientation="black"
        lastMove="e2e4"
      />,
    )
    expect(seen[0]?.fen).toBe(AFTER_E4.split(' ')[0])
    expect(seen[0]?.orientation).toBe('black')
  })

  it('marks the last move on the board', () => {
    render(<Board fen={AFTER_E4} lastMove="e2e4" />)
    expect(board().querySelectorAll('square.last-move')).toHaveLength(2)
  })

  it('hands arrows and coloured squares to chessground as shapes', () => {
    // jsdom gives the board no bounds, so chessground cannot lay the SVG out; what the
    // wrapper is responsible for is the shape list it passes down.
    const api = createRef<Api>()
    render(
      <Board
        ref={api}
        fen={START}
        arrows={[{ from: 'e2', to: 'e4', color: 'accent' }]}
        squares={[{ square: 'd5', color: 'red' }]}
      />,
    )
    expect(api.current?.state.drawable.autoShapes).toEqual([
      { orig: 'e2', dest: 'e4', brush: 'accent' },
      { orig: 'd5', brush: 'red' },
    ])
  })

  it('defaults an arrow to the engine brush and drops squares it cannot parse', () => {
    const api = createRef<Api>()
    render(
      <Board
        ref={api}
        fen={START}
        arrows={[{ from: 'g1', to: 'f3' }, { from: 'zz', to: 'f3' }]}
      />,
    )
    expect(api.current?.state.drawable.autoShapes).toEqual([
      { orig: 'g1', dest: 'f3', brush: 'accent' },
    ])
  })

  it('recolours chessground’s own brushes to the design palette', () => {
    const api = createRef<Api>()
    render(<Board ref={api} fen={START} />)
    // The coach's four named colours come straight off the classification palette; the
    // board's own arrows come from the quieter `--bb-arrow-*` family instead, so a calmer
    // board never drags the app's accent down with it.
    expect(api.current?.state.drawable.brushes.red?.color).toBe('var(--bb-blunder)')
    expect(api.current?.state.drawable.brushes.accent?.color).toBe('var(--bb-arrow-engine)')
    expect(api.current?.state.drawable.brushes.maia?.color).toBe('var(--bb-arrow-maia)')
    expect(api.current?.state.drawable.brushes.played?.color).toBe('var(--bb-arrow-played)')
  })

  it('puts a custom highlight class on the square it names', () => {
    render(<Board fen={AFTER_E4} squares={[{ square: 'e4', className: 'bb-blunder' }]} />)
    expect(board().querySelectorAll('square.bb-blunder')).toHaveLength(1)
  })

  it('is view-only by default and manipulable when a move handler is given', () => {
    const { rerender } = render(<Board fen={START} />)
    expect(board()).not.toHaveClass('manipulable')
    rerender(<Board fen={START} viewOnly={false} onMove={() => {}} />)
    expect(board()).toHaveClass('manipulable')
  })

  it('does not let the reader draw unless the surface asks for it', () => {
    const api = createRef<Api>()
    render(<Board ref={api} fen={START} viewOnly={false} onMove={() => {}} />)
    expect(api.current?.state.drawable.enabled).toBe(false)
  })

  it('rebuilds the board when `drawable` changes, because chessground only reads it once', () => {
    // `bindBoard` binds the board's `contextmenu` listener from `drawable.enabled` at
    // creation and never looks again, so a reconfigure would leave the browser menu on a
    // board that is supposed to be drawable.
    const seen: (boolean | undefined)[] = []
    const record = (api: Api | null) => {
      if (api) seen.push(api.state.drawable.enabled)
    }
    const { rerender } = render(
      <Board ref={record} fen={START} viewOnly={false} onMove={() => {}} />,
    )
    rerender(<Board ref={record} fen={START} viewOnly={false} onMove={() => {}} drawable />)
    expect(seen).toEqual([false, true])
  })

  it('keeps the app’s own shapes when the reader is allowed to draw', () => {
    // The reader's shapes live in `drawable.shapes`; everything this app draws goes through
    // `setAutoShapes`, which is a separate list.
    const api = createRef<Api>()
    render(
      <Board
        ref={api}
        fen={START}
        viewOnly={false}
        onMove={() => {}}
        drawable
        arrows={[{ from: 'e2', to: 'e4' }]}
      />,
    )
    expect(api.current?.state.drawable.enabled).toBe(true)
    expect(api.current?.state.drawable.autoShapes).toEqual([
      { orig: 'e2', dest: 'e4', brush: 'accent' },
    ])
  })

  it('tears chessground down on unmount and clears the ref', () => {
    const api = createRef<Api>()
    const { unmount } = render(<Board ref={api} fen={START} />)
    expect(api.current).not.toBeNull()
    unmount()
    expect(document.querySelector('cg-board')).toBeNull()
    expect(api.current).toBeNull()
  })
})

describe('parseLastMove', () => {
  it('reads a UCI move, promotion suffix and all', () => {
    expect(parseLastMove('e2e4')).toEqual(['e2', 'e4'])
    expect(parseLastMove('e7e8q')).toEqual(['e7', 'e8'])
  })

  it('accepts an explicit pair', () => {
    expect(parseLastMove(['g1', 'f3'])).toEqual(['g1', 'f3'])
  })

  it('drops anything that is not two squares', () => {
    expect(parseLastMove(null)).toBeUndefined()
    expect(parseLastMove(undefined)).toBeUndefined()
    expect(parseLastMove('')).toBeUndefined()
    expect(parseLastMove('z9z9')).toBeUndefined()
    expect(parseLastMove('e2')).toBeUndefined()
  })
})

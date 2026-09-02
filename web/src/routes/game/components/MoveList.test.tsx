import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MoveRow } from '@/lib/api/types'

import { pairMoves } from '../gameModel'
import { MoveList, type MoveListVariation } from './MoveList'

function move(ply: number, san: string, extra: Partial<MoveRow> = {}): MoveRow {
  return { ply, move_number: Math.floor(ply / 2) + 1, san, uci: 'e2e4', ...extra }
}

/** 21 quiet moves, then an inaccuracy on Black's 21st — the design's own situation. */
function longGame(): MoveRow[] {
  const moves: MoveRow[] = []
  for (let ply = 0; ply < 41; ply += 1) moves.push(move(ply, `m${ply}`))
  moves.push(move(41, 'Qc7', { classification: 'inaccuracy' }))
  return moves
}

function renderList(moves: MoveRow[], props: Partial<Parameters<typeof MoveList>[0]> = {}) {
  const onSelectPly = vi.fn()
  const onSelectVariationMove = vi.fn()
  const onSelectKeptMove = vi.fn()
  const view = render(
    <MoveList
      pairs={pairMoves(moves)}
      cursor={-1}
      collapsedThrough={null}
      annotation={null}
      flaggedCount={0}
      plyCount={moves.length}
      onSelectPly={onSelectPly}
      onSelectVariationMove={onSelectVariationMove}
      onSelectKeptMove={onSelectKeptMove}
      {...props}
    />,
  )
  return { onSelectPly, onSelectVariationMove, onSelectKeptMove, ...view }
}

const ROW_HEIGHT = 28
const VIEWPORT = 100

/**
 * jsdom has no layout, so the box metrics the scroll effect reads are stood up by hand:
 * every element is `ROW_HEIGHT` tall, stacked in order inside its parent, in a `VIEWPORT`
 * of visible height. `scrollTop` is given a backing store so a write can be read back.
 */
function stubLayout(): () => void {
  const scrolled = new WeakMap<Element, number>()
  const original = {
    offsetTop: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop'),
    offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
    clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
    scrollTop: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop'),
  }
  Object.defineProperties(HTMLElement.prototype, {
    offsetTop: {
      configurable: true,
      get(this: HTMLElement) {
        const parent = this.parentElement
        return parent ? [...parent.children].indexOf(this) * ROW_HEIGHT : 0
      },
    },
    offsetHeight: { configurable: true, get: () => ROW_HEIGHT },
    clientHeight: { configurable: true, get: () => VIEWPORT },
  })
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get(this: Element) {
      return scrolled.get(this) ?? 0
    },
    set(this: Element, value: number) {
      scrolled.set(this, value)
    },
  })
  return () => {
    for (const [name, descriptor] of Object.entries(original)) {
      const proto = name === 'scrollTop' ? Element.prototype : HTMLElement.prototype
      if (descriptor) Object.defineProperty(proto, name, descriptor)
      else delete (proto as unknown as Record<string, unknown>)[name]
    }
  }
}

let restoreLayout: (() => void) | null = null

afterEach(() => {
  restoreLayout?.()
  restoreLayout = null
})

describe('MoveList', () => {
  it('shows the collapsed-opening affordance and opens it on click', async () => {
    const user = userEvent.setup()
    renderList(longGame(), { collapsedThrough: 18 })

    expect(screen.getByText('moves 1–18 collapsed')).toBeInTheDocument()
    expect(screen.queryByText('m0')).not.toBeInTheDocument()
    expect(screen.getByText('m38')).toBeInTheDocument() // move 20, inside the run-up

    await user.click(screen.getByText('moves 1–18 collapsed'))
    expect(screen.getByText('m0')).toBeInTheDocument()
    expect(screen.queryByText('moves 1–18 collapsed')).not.toBeInTheDocument()
  })

  it('unfolds the opening when the cursor is inside it', () => {
    renderList(longGame(), { collapsedThrough: 18, cursor: 4 })
    expect(screen.getByText('m0')).toBeInTheDocument()
    expect(screen.queryByText('moves 1–18 collapsed')).not.toBeInTheDocument()
  })

  it('badges a flagged move and leaves an ordinary one bare', () => {
    renderList([move(0, 'e4', { classification: 'good' }), move(1, 'Nf6', { classification: 'blunder' })])
    expect(screen.getByLabelText('blunder')).toHaveTextContent('??')
    expect(screen.queryByLabelText('good')).not.toBeInTheDocument()
  })

  it('reports the ply of the move that was clicked', async () => {
    const user = userEvent.setup()
    const { onSelectPly } = renderList([move(0, 'e4'), move(1, 'd5')])
    await user.click(screen.getByText('d5'))
    expect(onSelectPly).toHaveBeenCalledWith(1)
  })

  it('puts the inline annotation under the move it is about, and names that move', () => {
    renderList([move(0, 'e4'), move(1, 'Nxe4', { classification: 'blunder' })], {
      annotation: {
        ply: 1,
        san: 'Nxe4',
        classification: 'blunder',
        before: { cp: 18 },
        after: { cp: 296 },
        winLoss: 31.2,
        bestSan: 'Rfe8',
      },
    })
    expect(screen.getByText('Rfe8')).toBeInTheDocument()
    expect(screen.getByText('−31.2%')).toBeInTheDocument()
    expect(screen.getByText('+2.96')).toBeInTheDocument()
    // The note hangs under a two-move row, so it says which of the two it is about.
    expect(screen.getByText(/1… Nxe4\?\?/)).toBeInTheDocument()
  })

  it('filters to the flagged moves on the second tab', async () => {
    const user = userEvent.setup()
    renderList(
      [move(0, 'e4'), move(1, 'd5'), move(2, 'Nc3', { classification: 'mistake' })],
      { flaggedCount: 1 },
    )
    await user.click(screen.getByRole('button', { name: /Flagged/ }))
    expect(screen.getByText('Nc3')).toBeInTheDocument()
    expect(screen.queryByText('e4')).not.toBeInTheDocument()
  })

  it('says so when a game has nothing flagged', async () => {
    const user = userEvent.setup()
    renderList([move(0, 'e4'), move(1, 'd5')])
    await user.click(screen.getByRole('button', { name: /Flagged/ }))
    expect(screen.getByText('Nothing flagged in this game.')).toBeInTheDocument()
  })

  it('copies the game from the tab row’s PGN affordance', async () => {
    const writeText = vi.fn(async () => {})
    const user = userEvent.setup()
    // `userEvent.setup()` installs its own clipboard stub, so this replaces it after.
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    renderList([move(0, 'e4')], { pgn: '[Event "?"]\n\n1. e4 *\n' })

    await user.click(screen.getByRole('button', { name: 'PGN' }))
    expect(writeText).toHaveBeenCalledWith('[Event "?"]\n\n1. e4 *\n')
    expect(await screen.findByText('copied')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('scrolls its own box to the cursor and never the page around it', () => {
    // `scrollIntoView` scrolls every scrollable ancestor, the studio's columns and the
    // window included, so the row is brought into view by hand instead.
    const scrollIntoView = vi.fn()
    const previous = Element.prototype.scrollIntoView
    const undoLayout = stubLayout()
    restoreLayout = () => {
      undoLayout()
      Element.prototype.scrollIntoView = previous
    }
    Element.prototype.scrollIntoView = scrollIntoView

    // Move 21 of 21: the 21st row, below a 100px viewport of 28px rows.
    const { container } = renderList(longGame(), { cursor: 41 })
    const scroller = container.querySelector('.overflow-y-auto')!
    expect(scroller.scrollTop).toBe(20 * ROW_HEIGHT + ROW_HEIGHT - VIEWPORT)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('leaves the cursor’s row alone while it is already in view', () => {
    restoreLayout = stubLayout()
    // Move 2 of 21 sits inside the first viewport, so nothing moves.
    const { container } = renderList(longGame(), { cursor: 2 })
    expect(container.querySelector('.overflow-y-auto')!.scrollTop).toBe(0)
  })

  it('draws the active variation under the move it hangs off', () => {
    // 1.e4 d5, and a line played off the position after 1.e4 — so it hangs under move 1.
    renderList([move(0, 'e4'), move(1, 'd5'), move(2, 'exd5'), move(3, 'Qxd5')], {
      cursor: 0,
      variations: [{ id: null, base: 1, sans: ['c6', 'd4', 'Nf6'], cursor: 2 }],
    })

    const line = screen.getByTestId('move-variation')
    // The gaps are flex, not text: the row reads `(1…c6 2.d4 Nf6)` on screen.
    expect(line).toHaveTextContent('(1…c62.d4Nf6)')
    // It is drawn inside the row of the move it left from, not appended to the table.
    const row = screen.getByText('1.').closest('div')!.parentElement!
    expect(row.contains(line)).toBe(true)
  })

  it('lights the move the board is standing on, and only that one', () => {
    const { rerender } = renderList([move(0, 'e4'), move(1, 'd5')], {
      cursor: 0,
      variations: [{ id: null, base: 1, sans: ['c6', 'd4'], cursor: 1 }],
    })
    const lit = () =>
      within(screen.getByTestId('move-variation'))
        .getAllByRole('button')
        .filter((button) => button.className.includes('bg-brilliant'))
        .map((button) => button.textContent)

    expect(lit()).toEqual(['c6'])

    rerender(
      <MoveList
        pairs={pairMoves([move(0, 'e4'), move(1, 'd5')])}
        cursor={0}
        collapsedThrough={null}
        annotation={null}
        flaggedCount={0}
        plyCount={2}
        variations={[{ id: null, base: 1, sans: ['c6', 'd4'], cursor: 2 }]}
        onSelectPly={vi.fn()}
      />,
    )
    expect(lit()).toEqual(['d4'])

    // At the head of the line the board is on the game position, so nothing in it is lit.
    rerender(
      <MoveList
        pairs={pairMoves([move(0, 'e4'), move(1, 'd5')])}
        cursor={0}
        collapsedThrough={null}
        annotation={null}
        flaggedCount={0}
        plyCount={2}
        variations={[{ id: null, base: 1, sans: ['c6', 'd4'], cursor: 0 }]}
        onSelectPly={vi.fn()}
      />,
    )
    expect(lit()).toEqual([])
  })

  it('moves the cursor to the variation move that was clicked', async () => {
    const user = userEvent.setup()
    const { onSelectVariationMove } = renderList([move(0, 'e4'), move(1, 'd5')], {
      cursor: 0,
      variations: [{ id: null, base: 1, sans: ['c6', 'd4'], cursor: 1 }],
    })

    await user.click(within(screen.getByTestId('move-variation')).getByRole('button', { name: 'd4' }))
    expect(onSelectVariationMove).toHaveBeenCalledWith(1)
  })

  it('keeps a line off the starting position at the top of the table', () => {
    renderList([move(0, 'e4'), move(1, 'd5')], {
      variations: [{ id: null, base: 0, sans: ['d4', 'd5'], cursor: 1 }],
    })
    const line = screen.getByTestId('move-variation')
    expect(line).toHaveTextContent('(1.d4d5)')
    // There is no move it can hang under, so it leads the list rather than vanishing.
    expect(
      line.compareDocumentPosition(screen.getByText('e4')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('stacks the kept lines under their anchors, in the order they were walked', () => {
    // Two lines off the position after 1.e4 and one off the position after 1.e4 d5: the
    // first two hang under move 1, the third under move 1 as well (ply 2 - 1 = 1).
    renderList([move(0, 'e4'), move(1, 'd5'), move(2, 'exd5'), move(3, 'Qxd5')], {
      cursor: 3,
      variations: [
        { id: 1, base: 1, sans: ['c6', 'd4'], cursor: null },
        { id: 2, base: 1, sans: ['e5'], cursor: null },
        { id: 3, base: 3, sans: ['Nc3', 'Qa5'], cursor: null },
      ],
    })

    const lines = screen.getAllByTestId('kept-variation')
    expect(lines.map((line) => line.textContent)).toEqual([
      '(1…c62.d4)',
      '(1…e5)',
      '(2…Nc33.Qa5)',
    ])
    // Under move 1 for the first two, under move 2 for the third — each inside the row of
    // the move that produced the position it left from.
    const rowOf = (san: string) =>
      screen.getByRole('button', { name: san }).closest('div')!.parentElement!
    expect(rowOf('e4').contains(lines[0]!)).toBe(true)
    expect(rowOf('e4').contains(lines[1]!)).toBe(true)
    expect(rowOf('exd5').contains(lines[2]!)).toBe(true)
  })

  it('draws the walked line and the kept ones together, each once', () => {
    renderList([move(0, 'e4'), move(1, 'd5')], {
      cursor: 0,
      variations: [
        { id: 1, base: 1, sans: ['c6', 'd4'], cursor: 1 },
        { id: 2, base: 1, sans: ['e5'], cursor: null },
      ],
    })

    // The line being walked keeps its lit move; the kept one is beside it, quiet and with
    // nothing lit.
    expect(screen.getByTestId('move-variation')).toHaveTextContent('(1…c62.d4)')
    const quiet = screen.getByTestId('kept-variation')
    expect(quiet).toHaveTextContent('(1…e5)')
    expect(
      within(quiet)
        .getAllByRole('button')
        .some((button) => button.className.includes('bg-brilliant')),
    ).toBe(false)
  })

  it('holds every line in the order it was walked, whichever one the board is in', () => {
    // Three lines off the position after 1.e4, walked in this order; the board is standing
    // in the middle one, which is where it was walked and where it stays.
    const lines: MoveListVariation[] = [
      { id: 1, base: 1, sans: ['c6', 'd4'], cursor: null },
      { id: 2, base: 1, sans: ['e5'], cursor: 1 },
      { id: 3, base: 1, sans: ['Nf6'], cursor: null },
    ]
    const { rerender } = renderList([move(0, 'e4'), move(1, 'd5')], { cursor: 0, variations: lines })

    const rows = () =>
      screen.getAllByTestId(/-variation$/).map((row) => [row.dataset.testid, row.textContent])
    expect(rows()).toEqual([
      ['kept-variation', '(1…c62.d4)'],
      ['move-variation', '(1…e5)'],
      ['kept-variation', '(1…Nf6)'],
    ])

    // The board walks into the oldest of them: the hot styling moves to its row, and not
    // the row itself.
    rerender(
      <MoveList
        pairs={pairMoves([move(0, 'e4'), move(1, 'd5')])}
        cursor={0}
        collapsedThrough={null}
        annotation={null}
        flaggedCount={0}
        plyCount={2}
        variations={lines.map((entry) => ({
          ...entry,
          cursor: entry.id === 1 ? 2 : null,
        }))}
        onSelectPly={vi.fn()}
      />,
    )
    expect(rows()).toEqual([
      ['move-variation', '(1…c62.d4)'],
      ['kept-variation', '(1…e5)'],
      ['kept-variation', '(1…Nf6)'],
    ])
    expect(
      within(screen.getByTestId('move-variation')).getByRole('button', { name: 'd4' }).className,
    ).toContain('bg-brilliant')
  })

  it('draws a line the store has not seen yet after the ones it has', () => {
    renderList([move(0, 'e4'), move(1, 'd5')], {
      cursor: 0,
      variations: [
        { id: 1, base: 1, sans: ['c6'], cursor: null },
        { id: 2, base: 1, sans: ['e5'], cursor: null },
        { id: null, base: 1, sans: ['Nf6', 'd4'], cursor: 1 },
      ],
    })

    expect(
      screen.getAllByTestId(/-variation$/).map((row) => [row.dataset.testid, row.textContent]),
    ).toEqual([
      ['kept-variation', '(1…c6)'],
      ['kept-variation', '(1…e5)'],
      ['move-variation', '(1…Nf62.d4)'],
    ])
  })

  it('orders the lines with no move to hang under the same way', () => {
    // Off the starting position there is no anchor row, so they lead the table — in the
    // order they were walked, with the newest of them last there too.
    renderList([move(0, 'e4'), move(1, 'd5')], {
      variations: [
        { id: 1, base: 0, sans: ['d4'], cursor: null },
        { id: null, base: 0, sans: ['c4'], cursor: 1 },
      ],
    })

    const rows = screen.getAllByTestId(/-variation$/)
    expect(rows.map((row) => [row.dataset.testid, row.textContent])).toEqual([
      ['kept-variation', '(1.d4)'],
      ['move-variation', '(1.c4)'],
    ])
    expect(
      rows[1]!.compareDocumentPosition(screen.getByText('e4')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('names the kept line a click landed in, and which of its moves', async () => {
    const user = userEvent.setup()
    const { onSelectKeptMove } = renderList([move(0, 'e4'), move(1, 'd5')], {
      cursor: 0,
      variations: [{ id: 9, base: 1, sans: ['c6', 'd4'], cursor: null }],
    })

    await user.click(
      within(screen.getByTestId('kept-variation')).getByRole('button', { name: 'd4' }),
    )
    expect(onSelectKeptMove).toHaveBeenCalledWith(9, 1)
  })

  it('walks the line the board is in rather than re-entering it, kept row or not', async () => {
    const user = userEvent.setup()
    const { onSelectVariationMove, onSelectKeptMove } = renderList(
      [move(0, 'e4'), move(1, 'd5')],
      { cursor: 0, variations: [{ id: 7, base: 1, sans: ['c6', 'd4'], cursor: 1 }] },
    )

    await user.click(
      within(screen.getByTestId('move-variation')).getByRole('button', { name: 'd4' }),
    )
    expect(onSelectVariationMove).toHaveBeenCalledWith(1)
    expect(onSelectKeptMove).not.toHaveBeenCalled()
  })

  it('keeps a kept line whose anchor is folded away at the top of the table', () => {
    renderList(longGame(), {
      collapsedThrough: 18,
      variations: [{ id: 1, base: 3, sans: ['Nc3'], cursor: null }],
    })
    // Move 2 is behind the fold, so the line leads the list rather than vanishing with it.
    const line = screen.getByTestId('kept-variation')
    expect(
      line.compareDocumentPosition(screen.getByText('m38')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('leaves the PGN affordance out when there is nothing to copy', () => {
    renderList([move(0, 'e4')])
    expect(screen.queryByRole('button', { name: 'PGN' })).not.toBeInTheDocument()
  })

  it('draws the tab a caller names, and hides the row when the caller owns the tabs', () => {
    // What the phone layout does: the tabs are promoted into a strip of its own
    // (`MobileGameView`), so the table is told which one to draw and its row goes.
    // The filter keeps whole move *pairs*, so the blunder goes in the second pair — with
    // it in the first, "e4" would still be on screen as the white half of a kept row.
    const moves = [
      move(0, 'e4'),
      move(1, 'e5'),
      move(2, 'Nf3'),
      move(3, 'Qh4', { classification: 'blunder' }),
    ]
    const list = (props: Partial<Parameters<typeof MoveList>[0]>) => (
      <MoveList
        pairs={pairMoves(moves)}
        cursor={-1}
        collapsedThrough={null}
        annotation={null}
        flaggedCount={1}
        plyCount={moves.length}
        onSelectPly={vi.fn()}
        {...props}
      />
    )
    const { rerender } = render(list({ tab: 'flagged', showTabRow: false }))
    expect(screen.queryByRole('button', { name: /^Moves/ })).not.toBeInTheDocument()
    // Filtered to the flagged move without anyone having clicked a tab in here.
    expect(screen.getByText('Qh4')).toBeInTheDocument()
    expect(screen.queryByText('e4')).not.toBeInTheDocument()

    rerender(list({ tab: 'moves', showTabRow: false }))
    expect(screen.getByText('e4')).toBeInTheDocument()
  })

  it('offers only Moves and Flagged — notes have a track of their own now', () => {
    renderList([move(0, 'e4'), move(1, 'd5')])
    expect(screen.getByRole('button', { name: /^Moves/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Flagged/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Notes/ })).not.toBeInTheDocument()
    // The plies count and the PGN affordance stay put beside them.
    expect(screen.getByText('2 plies')).toBeInTheDocument()
  })

  describe('the clock column', () => {
    // `clock` on a move is the reading *after* it; what the column shows is the mover's own
    // previous reading, `ply - 2` — the same convention `services/stats.py` counts time
    // trouble by. White starts on 3:00 and burns it; Black barely moves.
    const clocked = () => [
      move(0, 'e4', { clock: 178 }),
      move(1, 'c5', { clock: 179 }),
      move(2, 'Nf3', { clock: 139 }),
      move(3, 'e6', { clock: 175 }),
      move(4, 'd4', { clock: 19 }),
      move(5, 'cxd4', { clock: 170 }),
      move(6, 'Nxd4', { clock: 8 }),
      move(7, 'g6', { clock: 166 }),
    ]

    const clocks = () =>
      screen.getAllByTestId('move-clock').map((cell) => cell.textContent)

    it('shows what the mover had left before playing, not after', () => {
      renderList(clocked())
      // Move 1 has no earlier reading of its own (the row does not carry the initial time),
      // move 2 shows ply 0's 2:58 / ply 1's 2:59, move 3 shows ply 2's 2:19 / ply 3's 2:55.
      expect(clocks()).toEqual(['', '', '2:58', '2:59', '2:19', '2:55', '0:19', '2:50'])
    })

    it('colours a reading under twenty seconds in the mistake token', () => {
      renderList(clocked())
      const cells = screen.getAllByTestId('move-clock')
      // 0:19 is White's fourth move; the 2:50 beside it is not in trouble.
      expect(cells[6]).toHaveTextContent('0:19')
      expect(cells[6]!.className).toContain('text-mistake')
      expect(cells[7]!.className).toContain('text-faint')
    })

    it('draws no column at all for a game played without clocks', () => {
      renderList([move(0, 'e4'), move(1, 'd5')])
      expect(screen.queryAllByTestId('move-clock')).toHaveLength(0)
    })

    it('keeps a reading whose own move is folded away behind the opening', () => {
      // The reading shown against move 11 belongs to move 10, which the fold has taken off
      // screen — it is read off every pair, not the ones left after filtering.
      const moves = longGame().map((row, index) => ({ ...row, clock: 300 - index * 5 }))
      renderList(moves, { collapsedThrough: 10 })
      // Move 11's white cell: ply 20, so ply 18's reading — 300 - 18 * 5 = 210s = 3:30.
      expect(clocks()[0]).toBe('3:30')
    })
  })

  it('marks a noted move with the note icon rather than the old dot', () => {
    renderList([move(0, 'e4'), move(1, 'd5')], { notedMoves: new Set([1]) })
    const cellOf = (san: string) => screen.getByText(san).closest('button')!
    expect(cellOf('d5')).toHaveAttribute('title', '1…d5 — noted')
    expect(cellOf('d5').querySelector('svg')).not.toBeNull()
    expect(cellOf('e4').querySelector('svg')).toBeNull()
  })
})

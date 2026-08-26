import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MoveRow } from '@/lib/api/types'

import { pairMoves } from '../gameModel'
import { MoveList } from './MoveList'

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
  const view = render(
    <MoveList
      pairs={pairMoves(moves)}
      cursor={-1}
      collapsedThrough={null}
      annotation={null}
      flaggedCount={0}
      plyCount={moves.length}
      onSelectPly={onSelectPly}
      {...props}
    />,
  )
  return { onSelectPly, ...view }
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

  it('puts the inline annotation under the move it is about', () => {
    renderList([move(0, 'e4'), move(1, 'Nxe4', { classification: 'blunder' })], {
      annotation: {
        ply: 1,
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

  it('leaves the PGN affordance out when there is nothing to copy', () => {
    renderList([move(0, 'e4')])
    expect(screen.queryByRole('button', { name: 'PGN' })).not.toBeInTheDocument()
  })
})

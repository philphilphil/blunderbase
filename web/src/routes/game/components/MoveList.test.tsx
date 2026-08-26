import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

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
  render(
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
  return { onSelectPly }
}

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

  it('leaves the PGN affordance out when there is nothing to copy', () => {
    renderList([move(0, 'e4')])
    expect(screen.queryByRole('button', { name: 'PGN' })).not.toBeInTheDocument()
  })
})

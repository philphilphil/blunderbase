import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import type { PositionOccurrence } from '@/lib/api/types'

import { GamesInLine } from './GamesInLine'

const GAMES = [
  {
    game: {
      id: 7,
      opponent: 'a-very-long-opponent-handle-that-cannot-fit',
      opponent_rating: 2184,
      played_at: '2016-12-27T19:04:00Z',
      result: '1-0',
      outcome: 'win',
    },
    ply: 6,
    move_san: 'Nbxd7+',
  },
] as unknown as PositionOccurrence[]

function renderList() {
  return render(
    <MemoryRouter>
      <GamesInLine games={GAMES} loading={false} total={1} onOpenLibrary={null} />
    </MemoryRouter>,
  )
}

describe('GamesInLine', () => {
  it('keeps every row on one line', () => {
    renderList()
    const row = screen.getByRole('button')
    expect(row).toHaveClass('whitespace-nowrap')
    // The opponent is the only elastic cell, so it is the one that truncates — and it
    // can only truncate inside a flex row if it may shrink past its content.
    const opponent = screen.getByText('a-very-long-opponent-handle-that-cannot-fit')
    expect(opponent).toHaveClass('min-w-0', 'flex-1', 'truncate')
    for (const cell of Array.from(row.children)) {
      if (cell === opponent) continue
      expect(cell).toHaveClass('flex-none')
    }
  })

  it('gives the date cell room for a game from an earlier year', () => {
    renderList()
    const date = screen.getByRole('button').children[0]
    // `27 Dec 16` — nine mono glyphs at 0.71875rem, which 3.75rem used to wrap.
    expect(date).toHaveTextContent(/^\d+ \w{3} \d{2}$/)
    expect(date).toHaveClass('w-[4.25rem]')
  })
})

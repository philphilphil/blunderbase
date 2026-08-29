/**
 * A smoke test for design 2c's "games in this line".
 *
 * The two tests this file used to hold asserted only Tailwind classes, and the suite runs
 * with `css: false` — so a component that stopped rendering rows altogether would have
 * passed both. What a reader wants off one of these rows is which game it is: who it was
 * against, when, and how it went. That is what is asserted here.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import type { PositionOccurrence } from '@/lib/api/types'

import { GamesInLine } from './GamesInLine'

/** Midday UTC, so the day the row prints is the same one either side of the meridian. */
const GAMES: PositionOccurrence[] = [
  {
    game: {
      id: 7,
      source: 'lichess',
      opponent: 'a-very-long-opponent-handle-that-cannot-fit',
      opponent_rating: 2184,
      played_at: '2016-12-27T12:00:00Z',
      result: '1-0',
      outcome: 'win',
    },
    ply: 6,
    move_san: 'Nbxd7+',
  },
]

describe('GamesInLine', () => {
  it('names the game a row stands for', () => {
    render(
      <MemoryRouter>
        <GamesInLine games={GAMES} loading={false} total={1} onOpenLibrary={null} />
      </MemoryRouter>,
    )

    const row = screen.getByRole('button')
    // A game from an earlier year carries its year; `formatGameDate` owns that rule.
    expect(row).toHaveTextContent('27 Dec 16')
    expect(row).toHaveTextContent('a-very-long-opponent-handle-that-cannot-fit')
    expect(row).toHaveTextContent('2184')
    expect(row).toHaveTextContent('Nbxd7+')
    expect(row).toHaveTextContent('1–0')
  })
})

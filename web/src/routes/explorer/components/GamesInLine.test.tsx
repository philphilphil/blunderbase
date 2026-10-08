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
import { writeDate } from '@/lib/i18n/dateFormat'

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
        <GamesInLine games={GAMES} loading={false} total={1} libraryHref={null} />
      </MemoryRouter>,
    )

    const row = screen.getByRole('button')
    // The date in the reader's format, Automatic here; `formatGameDate` owns how it is written.
    expect(row).toHaveTextContent(writeDate(new Date('2016-12-27T12:00:00Z'), 'auto'))
    expect(row).toHaveTextContent('a-very-long-opponent-handle-that-cannot-fit')
    expect(row).toHaveTextContent('2184')
    expect(row).toHaveTextContent('Nbxd7+')
    expect(row).toHaveTextContent('1–0')
    // No ECO to filter by, so there is nowhere to send the reader.
    expect(screen.queryByRole('link', { name: /Open in Games/ })).not.toBeInTheDocument()
  })

  it('links to the Games page filtered to the line', () => {
    render(
      <MemoryRouter>
        <GamesInLine games={GAMES} loading={false} total={1} libraryHref="/games?eco=C45" />
      </MemoryRouter>,
    )

    // A real link, named for where it goes, so it can be opened in a new tab.
    expect(screen.getByRole('link', { name: /Open in Games/ })).toHaveAttribute(
      'href',
      '/games?eco=C45',
    )
  })
})

import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { Providers } from '@/app/Providers'

import { HelpPage } from './HelpPage'

function renderPage(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </Providers>,
  )
}

/** The cells of the row labelled `of`, in column order: Stockfish, then Maia. */
function row(of: string): string[] {
  const cells = within(screen.getByRole('rowheader', { name: of }).closest('tr')!).getAllByRole(
    'cell',
  )
  return cells.map((cell) => cell.textContent ?? '')
}

describe('HelpPage', () => {
  it('sets the two engines against each other a row at a time', () => {
    renderPage(<HelpPage />)

    expect(screen.getByRole('heading', { name: 'How analysis works' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Stockfish' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Maia' })).toBeInTheDocument()

    // 2000 is the one rating Maia is ever asked at — the number an owner reads off this page
    // before going to change it, so a stale one here is worse than no page at all.
    expect(row('asks')).toEqual(["what's best", 'what a 2000 would play'])
    expect(row('spends')).toEqual(['250k – 2M nodes', 'one look, no search'])
    expect(row('gives')).toEqual(['1 line quick, 4 deep', '5 moves, each with odds'])
  })

  it('sends the lines row down to the answer that explains it', () => {
    renderPage(<HelpPage />)

    const [stockfish, maia] = row('lines?')
    expect(stockfish).toBe('yes')
    expect(maia).toBe('never — why?')
    expect(screen.getByRole('link', { name: 'why?' })).toHaveAttribute('href', '#no-lines')
    expect(
      screen.getByRole('heading', { name: 'Why Maia never shows a line' }).closest('#no-lines'),
    ).not.toBeNull()
  })

  it('answers the three questions, and points at where the numbers are set', () => {
    renderPage(<HelpPage />)

    for (const question of ['Quick vs deep', 'Why Maia never shows a line', 'What a move cost']) {
      expect(screen.getByRole('heading', { name: question })).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
  })
})

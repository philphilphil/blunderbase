import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { GameNote } from '../gameModel'
import type { NoteRow } from '../notesModel'
import type { BookEntry } from './BookPanel'
import { NotesTrack } from './NotesTrack'

const BOOK: BookEntry = {
  games: 9,
  moves: [
    { uci: 'd2d4', san: 'd4', games: 6, wins: 3, draws: 1, losses: 2, avg_win_loss: 9 },
    { uci: 'b1c3', san: 'Nc3', games: 2, wins: 0, draws: 1, losses: 1, avg_win_loss: 16 },
  ],
}

/** A position two of the owner's games reached but neither continued from. */
const NO_BOOK: BookEntry = { games: 2, moves: [] }

function note(id: number, text: string): GameNote {
  return {
    id,
    text,
    tags: [],
    ply: id,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }
}

const NOTES: NoteRow[] = [
  {
    note: note(1, 'Bishop has no future on this diagonal against …e6'),
    anchor: { kind: 'mainline', count: 11 },
    context: '6.Bc4',
    onLine: false,
    source: null,
  },
  {
    note: note(2, 'Time trouble. Stopped counting defenders again.'),
    anchor: { kind: 'mainline', count: 47 },
    context: '24.Nc4',
    onLine: false,
    source: null,
  },
]

const composer = <div data-testid="composer-stub">composer</div>

function renderTrack(props: Partial<Parameters<typeof NotesTrack>[0]> = {}) {
  return render(
    <NotesTrack
      book={BOOK}
      bookPly={4}
      notes={NOTES}
      onSelectNote={vi.fn()}
      composer={composer}
      {...props}
    />,
  )
}

describe('NotesTrack', () => {
  it('opens on Book where the position has one', () => {
    renderTrack()

    expect(screen.getByRole('tab', { name: 'Book' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('book-panel')).toBeInTheDocument()
    // The entry's own count, not the sum of the continuations: one of the nine games ended
    // at this position and still reached it.
    expect(screen.getByText('9 games')).toBeInTheDocument()
  })

  it('drops the Book tab entirely where no book reached this position', () => {
    renderTrack({ book: NO_BOOK })

    // Not an empty Book tab and not a placeholder pane: `0017_explorer_book` counts 452k of
    // 463k positions reached by exactly one game, so an empty state would be the norm.
    expect(screen.queryByRole('tab', { name: 'Book' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('book-panel')).not.toBeInTheDocument()
  })

  it('keeps the composer outside the tabs, and does not move it when they switch', () => {
    renderTrack()

    const before = screen.getByTestId('composer-stub')
    expect(screen.getByRole('tabpanel')).not.toContainElement(before)
    expect(screen.getByTestId('composer-slot')).toContainElement(before)

    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }))

    // The very same DOM node, still in the same slot: a box being typed into cannot be
    // remounted or reflowed by a tab above it.
    expect(screen.getByTestId('composer-stub')).toBe(before)
    expect(screen.getByRole('tabpanel')).not.toContainElement(before)
  })

  it('falls back to Notes out of book, and returns to Book on the way back in', () => {
    const { rerender } = renderTrack()
    const track = (book: BookEntry | null) => (
      <NotesTrack
        book={book}
        bookPly={4}
        notes={NOTES}
        onSelectNote={vi.fn()}
        composer={composer}
      />
    )

    rerender(track(null))
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true')

    // The reader never chose Notes there — the position did — so Book comes back.
    rerender(track(BOOK))
    expect(screen.getByRole('tab', { name: 'Book' })).toHaveAttribute('aria-selected', 'true')
  })

  it('leaves a reader who chose Notes on Notes, book or no book', () => {
    const { rerender } = renderTrack()
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }))
    const track = (book: BookEntry | null) => (
      <NotesTrack
        book={book}
        bookPly={4}
        notes={NOTES}
        onSelectNote={vi.fn()}
        composer={composer}
      />
    )

    rerender(track(null))
    rerender(track(BOOK))
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true')
  })

  it('lists the notes with their move labels and seeks the one that is clicked', () => {
    const onSelectNote = vi.fn()
    renderTrack({ onSelectNote })
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }))

    expect(screen.getByText('2 notes')).toBeInTheDocument()
    // The tabs carry `role="tab"` and the book rows `role="row"`, so the only plain
    // buttons in the track are the note rows themselves.
    const rows = screen.getAllByRole('button')
    expect(rows[0]).toHaveTextContent('6.Bc4')
    expect(rows[0]).toHaveTextContent('Bishop has no future')

    fireEvent.click(rows[0]!)
    expect(onSelectNote).toHaveBeenCalledWith(NOTES[0])
  })

  it('lights the note the composer is standing on', () => {
    renderTrack({ activeNoteId: 2 })
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }))

    // The tabs carry `role="tab"` and the book rows `role="row"`, so the only plain
    // buttons in the track are the note rows themselves.
    const rows = screen.getAllByRole('button')
    expect(rows[0]).not.toHaveClass('bg-row-active')
    expect(rows[1]).toHaveClass('bg-row-active')
  })

  it('says an empty game is empty in one line, without drawing a box for it', () => {
    renderTrack({ book: null, notes: [] })

    expect(screen.getByText('No notes in this game yet.')).toBeInTheDocument()
    expect(screen.getByText('0 notes')).toBeInTheDocument()
    // The Notes tab and the composer are all that is left; there is no note row to click.
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

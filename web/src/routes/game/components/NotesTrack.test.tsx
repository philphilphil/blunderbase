import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
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

/** A row of this game's own, which is what most of them are. */
function row(over: Partial<NoteRow> & { note: GameNote }): NoteRow {
  return {
    anchor: { kind: 'mainline', count: over.note.ply ?? 0 },
    context: null,
    onLine: false,
    elsewhere: false,
    from: null,
    originMove: null,
    originHref: null,
    source: null,
    ...over,
  }
}

const NOTES: NoteRow[] = [
  row({
    note: note(1, 'Bishop has no future on this diagonal against …e6'),
    anchor: { kind: 'mainline', count: 11 },
    context: '6.Bc4',
  }),
  row({
    note: note(2, 'Time trouble. Stopped counting defenders again.'),
    anchor: { kind: 'mainline', count: 47 },
    context: '24.Nc4',
  }),
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
    // A note from another game links to it.
    { wrapper: MemoryRouter },
  )
}

describe('NotesTrack', () => {
  it('opens on Notes, with Notes first on the strip, even where the position has a book', () => {
    renderTrack()

    // Notes lead: they matter at every ply and the composer writes into them, so the game
    // opens on what you wrote rather than on a pane that changes from game to game.
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Notes', 'Book'])
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Book' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.queryByTestId('book-panel')).not.toBeInTheDocument()
    expect(screen.getByText('2 notes')).toBeInTheDocument()
  })

  it('shows the book, with its own game count, when the reader asks for it', async () => {
    const user = userEvent.setup()
    renderTrack()

    await user.click(screen.getByRole('tab', { name: 'Book' }))

    expect(screen.getByRole('tab', { name: 'Book' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('book-panel')).toBeInTheDocument()
    // The entry's own count, not the sum of the continuations: one of the nine games ended
    // at this position and still reached it.
    expect(screen.getByText('9 games')).toBeInTheDocument()
  })

  it('heads the book with the opening name, even where no game reached the position', async () => {
    const user = userEvent.setup()
    renderTrack({ book: null, opening: { eco: 'B90', name: 'Sicilian Defense: Najdorf Variation' } })

    await user.click(screen.getByRole('tab', { name: 'Book' }))

    expect(screen.getByTestId('book-opening')).toHaveTextContent(
      'Sicilian Defense: Najdorf VariationB90',
    )
    expect(screen.getByTestId('book-panel-empty')).toBeInTheDocument()
  })

  it('offers the way out to the explorer on the Book tab, and only there', async () => {
    const user = userEvent.setup()
    const onOpenInExplorer = vi.fn()
    renderTrack({ onOpenInExplorer })

    // The arrow belongs to the book, not to the row: on Notes there is nothing to open.
    expect(
      screen.queryByRole('button', { name: 'Open this position in the explorer' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Book' }))
    await user.click(screen.getByRole('button', { name: 'Open this position in the explorer' }))
    expect(onOpenInExplorer).toHaveBeenCalledTimes(1)
  })

  it('keeps the Book tab where no book reached this position', () => {
    renderTrack({ book: NO_BOOK })

    // The strip never changes shape — a tab that came and went moved the Notes tab under
    // the pointer every time the game left book.
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(screen.getByRole('tab', { name: 'Book' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('book-panel')).not.toBeInTheDocument()
  })

  it('shows the empty book when the reader asks for it there', async () => {
    const user = userEvent.setup()
    renderTrack({ book: NO_BOOK })

    await user.click(screen.getByRole('tab', { name: 'Book' }))

    expect(screen.getByTestId('book-panel-empty')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Book' })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps the composer outside the tabs, and does not move it when they switch', () => {
    renderTrack()

    const before = screen.getByTestId('composer-stub')
    expect(screen.getByRole('tabpanel')).not.toContainElement(before)
    expect(screen.getByTestId('composer-slot')).toContainElement(before)

    fireEvent.click(screen.getByRole('tab', { name: 'Book' }))

    // The very same DOM node, still in the same slot: a box being typed into cannot be
    // remounted or reflowed by a tab above it.
    expect(screen.getByTestId('composer-stub')).toBe(before)
    expect(screen.getByRole('tabpanel')).not.toContainElement(before)
  })

  it('leaves a reader who chose Book on Book as the board steps out of book and back in', () => {
    const { rerender } = renderTrack()
    fireEvent.click(screen.getByRole('tab', { name: 'Book' }))
    const track = (book: BookEntry | null) => (
      <NotesTrack
        book={book}
        bookPly={4}
        notes={NOTES}
        onSelectNote={vi.fn()}
        composer={composer}
      />
    )

    // The open tab is the reader's, not the position's: it does not flip to Notes when the
    // game leaves book, and the empty book is itself an answer.
    rerender(track(null))
    expect(screen.getByRole('tab', { name: 'Book' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('book-panel-empty')).toBeInTheDocument()

    rerender(track(BOOK))
    expect(screen.getByRole('tab', { name: 'Book' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('book-panel')).toBeInTheDocument()
  })

  it('lists the notes with their move labels and seeks the one that is clicked', () => {
    const onSelectNote = vi.fn()
    renderTrack({ onSelectNote })

    expect(screen.getByText('2 notes')).toBeInTheDocument()
    // The tabs carry `role="tab"` and the book rows `role="row"`, so the only plain
    // buttons in the track are the note rows themselves.
    const rows = screen.getAllByRole('button')
    expect(rows[0]).toHaveTextContent('6.Bc4')
    expect(rows[0]).toHaveTextContent('Bishop has no future')

    fireEvent.click(rows[0]!)
    expect(onSelectNote).toHaveBeenCalledWith(NOTES[0])
  })

  it('says which rows were written somewhere else, and where', () => {
    renderTrack({
      notes: [
        row({
          note: note(3, 'Kasparov spent twenty minutes on this.'),
          context: '6.Bc4',
          elsewhere: true,
          from: 'Kasparov vs Karpov',
          originMove: '6. Bg5',
          originHref: '/games/77?ply=11',
        }),
        row({
          note: note(4, 'The move order matters more than the moves.'),
          context: '4…Nf6',
          elsewhere: true,
          source: 'web',
          originHref: '/explorer?fen=x',
        }),
        row({
          note: note(5, 'Engine says the knight belongs on d7.'),
          context: '5.O-O',
          elsewhere: true,
          source: 'mcp',
          originHref: '/explorer?fen=y',
        }),
        NOTES[0]!,
        row({
          note: {
            ...note(6, 'Carlsen keeps the tension here.'),
            game: { id: 88, white: 'Carlsen', black: 'Caruana', is_owner_game: false },
          } as GameNote,
          context: '7.Re1',
          elsewhere: true,
          from: 'Carlsen vs Caruana',
          originHref: '/games/88?ply=13',
        }),
      ],
    })
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }))

    // A model game says it is one, as the explorer's notes do.
    expect(screen.getByRole('link', { name: /from the model game Carlsen vs Caruana/ })).toHaveAttribute(
      'href',
      '/games/88?ply=13',
    )

    // Named where there is a game to name — with the move it was written on *there*, which
    // is not this game's move at the ply the row is filed under.
    expect(screen.getByText(/from Kasparov vs Karpov/)).toBeInTheDocument()
    expect(screen.getByText(/6\. Bg5/)).toBeInTheDocument()
    // …and that line is a way over there, opened at that move — a link beside the row's
    // button, not inside it, so clicking the row still only moves this board.
    const over = screen.getByRole('link', { name: /from Kasparov vs Karpov/ })
    expect(over).toHaveAttribute('href', '/games/77?ply=11')
    expect(over.closest('button')).toBeNull()
    // A note on a bare position names what wrote it there, and links to that position.
    expect(screen.getByRole('link', { name: /from the explorer/ })).toHaveAttribute(
      'href',
      '/explorer?fen=x',
    )
    expect(screen.getByRole('link', { name: /via MCP/ })).toHaveAttribute('href', '/explorer?fen=y')
    // This game's own note says nothing: it is the unmarked case, and marking it would
    // make the mark meaningless.
    const rows = screen.getAllByRole('button')
    expect(rows[3]).not.toHaveTextContent(/^from /)
    expect(rows[3]!.parentElement!.querySelector('a')).toBeNull()
  })

  it('lights the note the composer is standing on', () => {
    renderTrack({ activeNoteId: 2 })
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }))

    // The tabs carry `role="tab"` and the book rows `role="row"`, so the only plain
    // buttons in the track are the note rows themselves.
    const rows = screen.getAllByRole('button')
    // The light is on the row's box, which holds the button and any origin line under it.
    expect(rows[0]!.parentElement).not.toHaveClass('bg-row-active')
    expect(rows[1]!.parentElement).toHaveClass('bg-row-active')
  })

  it('heads the list with a game row to write on while the game has no note about itself', () => {
    const onWriteGameNote = vi.fn()
    const { rerender } = renderTrack({ notes: [], onWriteGameNote })

    // The stub stands in for the empty line: there is always somewhere to start.
    expect(screen.queryByText('No notes in this game yet.')).not.toBeInTheDocument()
    const stub = screen.getByTestId('game-note-stub')
    expect(stub).toHaveTextContent('game')
    fireEvent.click(stub)
    expect(onWriteGameNote).toHaveBeenCalledTimes(1)

    // It lights while the composer is on the game, like the row of a note it is on.
    rerender(
      <NotesTrack
        bookPly={4}
        notes={NOTES}
        onSelectNote={vi.fn()}
        onWriteGameNote={onWriteGameNote}
        gameNoteActive
        composer={composer}
      />,
    )
    expect(screen.getAllByRole('button')[0]).toBe(screen.getByTestId('game-note-stub'))
    expect(screen.getByTestId('game-note-stub')).toHaveClass('bg-row-active')

    // Once the game has its note, the note is the first row and the stub is gone.
    const own = row({ note: { ...note(9, 'Played on no sleep.'), ply: null }, anchor: { kind: 'loose' } })
    rerender(
      <NotesTrack
        bookPly={4}
        notes={[own, ...NOTES]}
        onSelectNote={vi.fn()}
        onWriteGameNote={onWriteGameNote}
        composer={composer}
      />,
    )
    expect(screen.queryByTestId('game-note-stub')).not.toBeInTheDocument()
  })

  it('hands the way back to the screen its origin link opens', async () => {
    const user = userEvent.setup()
    function Arrived() {
      const state = useLocation().state as { from?: string; label?: string } | null
      return <p data-testid="arrived">{`${state?.from} | ${state?.label}`}</p>
    }
    const track = (
      <NotesTrack
        bookPly={4}
        notes={[
          row({
            note: note(3, 'Kasparov spent twenty minutes on this.'),
            context: '6.Bc4',
            elsewhere: true,
            from: 'Kasparov vs Karpov',
            originHref: '/games/77?ply=11',
          }),
        ]}
        onSelectNote={vi.fn()}
        originState={{ from: '/games/14?ply=11', label: 'phib — Hubert2001' }}
        composer={composer}
      />
    )
    render(
      <MemoryRouter initialEntries={['/games/14']}>
        <Routes>
          <Route path="/games/14" element={track} />
          <Route path="/games/77" element={<Arrived />} />
        </Routes>
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('link', { name: /from Kasparov vs Karpov/ }))
    expect(screen.getByTestId('arrived')).toHaveTextContent('/games/14?ply=11 | phib — Hubert2001')
  })

  it('draws no game row where the game cannot be written on', () => {
    renderTrack()
    expect(screen.queryByTestId('game-note-stub')).not.toBeInTheDocument()
  })

  it('says an empty game is empty in one line, without drawing a box for it', () => {
    renderTrack({ book: null, notes: [] })

    expect(screen.getByText('No notes in this game yet.')).toBeInTheDocument()
    expect(screen.getByText('0 notes')).toBeInTheDocument()
    // The Notes tab and the composer are all that is left; there is no note row to click.
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

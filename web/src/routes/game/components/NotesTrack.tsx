/**
 * The right column's second track: Book and Notes behind a tab, with the note composer
 * pinned underneath both of them.
 *
 * THE COMPOSER IS NOT IN THE TAB PANE, and that is the whole point of this component. It
 * belongs to the position on the board, not to what the reader is looking up, so it stays
 * put under either tab and switching tabs never moves the box somebody is typing in. It is
 * rendered after an explicit spacer rather than merely last, so it is at the bottom of the
 * track at every height the track can be.
 *
 * Book and Notes share one pane because they answer the same question at two scopes — what
 * happened here before, and what you wrote about it — and because they are never both
 * wanted at once: Book is an opening-phase panel and notes matter everywhere.
 *
 * BOTH TABS ARE ALWAYS ON THE STRIP (owner's decision, 2026-09-01). Which one is *open*
 * still follows the position until the reader picks one, and is their pick from then on.
 *
 * This reverses an earlier call, and the reasoning it reversed is worth keeping because the
 * numbers behind it have not changed. `0017_explorer_book`'s own figures: of 463k positions
 * in the owner's tree, 452k are reached by exactly one game and only ~1.1k by ten or more.
 * So "None of your games reached this position" is what the Book tab says for most of most
 * games, and that was the argument for hiding the tab entirely.
 *
 * What outweighed it: a tab that comes and goes as the board steps is a control that moves
 * under the pointer — the Notes tab slid sideways every time the game left book — and the
 * emptiness is itself the answer to "have I been here before?", which vanishing cannot say.
 * A fixed strip is worth more than a saved row.
 *
 * There is deliberately no coach card and no per-move prose here. One was built and cut.
 */
import { useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

import type { NoteRow } from '../notesModel'
import { BookPanel, type BookEntry, type BookMove } from './BookPanel'

export interface NotesTrackProps {
  /**
   * The owner's own tree from the position on the board — `GameDetail.book[bookPly]`, passed
   * straight through. Absent, or carrying no continuations, is the common case and the Book
   * tab says so; see the note above.
   */
  book?: BookEntry | null
  /** The half-move count on the board: the key `book` was taken from, and the moves' label. */
  bookPly: number
  onPlayBookMove?: (move: BookMove) => void
  /** Preview a continuation on the board without selecting it; `null` restores. */
  onPreviewBookMove?: (continuation: string[] | null) => void

  /** This game's notes in reading order (`notesModel.noteRows`). */
  notes: readonly NoteRow[]
  /** The note the composer is currently on, which is the row that lights up. */
  activeNoteId?: number | null
  /** Clicking a row seeks the board to where that note hangs. */
  onSelectNote: (row: NoteRow) => void

  /** The `<NoteComposer/>` for the position on the board. Rendered, never wrapped in a tab. */
  composer: ReactNode
  className?: string
}

/**
 * The composer's slot, as a definite height.
 *
 * `NoteComposer` is written to be sized by its slot — its text box takes what is left under
 * the one row that must stay reachable — so it needs a container with a height rather than
 * one derived from its own contents, or the textarea's `flex-1` has nothing to resolve
 * against. A fixed slot is also what guarantees the promise this component makes: the box
 * cannot move when the tab above it changes, because nothing above it can change its size.
 */
const COMPOSER_SLOT = 'h-[9rem]'

/**
 * The pane's title strip, in the same 35-design-pixel chrome band every other pane on the
 * game screen wears — so the Maia band's headers, the move table's tabs and this row all sit
 * on one line across the workspace.
 */
const TAB_ROW = 'flex h-[2.1875rem] flex-none items-stretch border-b border-line bg-panel pr-2.5'

const TAB =
  'relative flex h-full items-center gap-1.5 px-3 text-xs text-dim transition-colors hover:text-body-3'
/** The selected tab is the pane's surface pushed into the strip — see `MoveList`'s `Tab`. */
const TAB_ON =
  'bg-surface font-medium text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-surface'

export function NotesTrack({
  book,
  bookPly,
  onPlayBookMove,
  onPreviewBookMove,
  notes,
  activeNoteId = null,
  onSelectNote,
  composer,
  className,
}: NotesTrackProps) {
  // Null until the reader picks one, and their pick from then on.
  const [chosen, setChosen] = useState<'book' | 'notes' | null>(null)

  const moves = book?.moves ?? []
  const hasBook = moves.length > 0
  // Both tabs are always on the strip; which one is *open* still follows the position until
  // somebody says otherwise. Opening on Book would mean opening on "none of your games
  // reached this position" for most of most games (see the ratio above), and opening on
  // Notes would bury the book for the opening, where it is the whole point. So: the
  // position chooses until the reader does, and after that the reader's choice stands.
  const active = chosen ?? (hasBook ? 'book' : 'notes')
  // The entry's own count, which includes games that *ended* here and so is not the sum of
  // the continuations. Falling back to that sum keeps the tab honest either way.
  const games = book?.games ?? moves.reduce((total, move) => total + (move.games ?? 0), 0)

  return (
    <section
      data-testid="notes-track"
      className={cn('flex min-h-0 min-w-0 flex-col', className)}
    >
      <div role="tablist" aria-label="Book and notes" className={TAB_ROW}>
        <button
          type="button"
          role="tab"
          id="notes-track-tab-book"
          aria-selected={active === 'book'}
          aria-controls="notes-track-pane"
          onClick={() => setChosen('book')}
          className={cn(TAB, active === 'book' && TAB_ON)}
        >
          Book
        </button>
        <button
          type="button"
          role="tab"
          id="notes-track-tab-notes"
          aria-selected={active === 'notes'}
          aria-controls="notes-track-pane"
          onClick={() => setChosen('notes')}
          className={cn(TAB, active === 'notes' && TAB_ON)}
        >
          Notes
        </button>
        <span className="flex-1" />
        {/* The count belongs to whichever pane is open, in the quietest type on the row. */}
        <span className="flex items-center font-mono text-[0.625rem] text-faint tabular">
          {active === 'book'
            ? `${games} ${games === 1 ? 'game' : 'games'}`
            : `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}
        </span>
      </div>

      {/*
        The pane shrinks and scrolls; it never grows. What takes the room the panes do not
        want is the spacer below, which is what keeps the composer on the floor of the track
        rather than floating up under a short list.
      */}
      <div
        role="tabpanel"
        id="notes-track-pane"
        aria-labelledby={active === 'book' ? 'notes-track-tab-book' : 'notes-track-tab-notes'}
        className="min-h-0 overflow-y-auto"
      >
        {active === 'book' ? (
          <BookPanel
            moves={moves}
            ply={bookPly}
            onPlay={onPlayBookMove}
            onPreview={onPreviewBookMove}
          />
        ) : (
          <NoteList notes={notes} activeNoteId={activeNoteId} onSelect={onSelectNote} />
        )}
      </div>

      <div className="min-h-0 flex-1" />

      {/*
        No rule above the composer: the mockup draws one because its composer is a bare
        stack of fields, and `NoteComposer` brings its own bordered surface. Two lines a few
        pixels apart would read as a mistake.

        `[&>*]` hands the slot's height to whatever composer is passed in, which is the
        contract `NoteComposer` is written to — see `COMPOSER_SLOT`.
      */}
      <div
        data-testid="composer-slot"
        className={cn(
          'flex flex-none flex-col px-1.5 pt-1.5 pb-2 [&>*]:min-h-0 [&>*]:flex-1',
          COMPOSER_SLOT,
        )}
      >
        {composer}
      </div>
    </section>
  )
}

/**
 * This game's notes, one row each: where it hangs, then its text clamped to two lines.
 *
 * Two lines rather than one elided one because a note is a sentence, and the first eight
 * words of one are rarely the point. The row for the note the composer is on lights up, so
 * the list and the box under it are visibly about the same note.
 *
 * An empty game gets one quiet line and not a dashed box: there is a composer directly
 * below saying how to fix it, and a box around "no notes yet" is furniture for a state that
 * every game starts in.
 */
function NoteList({
  notes,
  activeNoteId,
  onSelect,
}: {
  notes: readonly NoteRow[]
  activeNoteId: number | null
  onSelect: (row: NoteRow) => void
}) {
  if (notes.length === 0) {
    return <p className="px-3 py-4 text-[0.71875rem] text-faint">No notes in this game yet.</p>
  }

  return (
    <div data-testid="game-notes" className="flex flex-col px-1.5 pt-1 pb-2">
      {notes.map((row) => (
        <button
          key={row.note.id}
          type="button"
          onClick={() => onSelect(row)}
          className={cn(
            'flex items-baseline gap-2.5 rounded-[0.3125rem] px-1.5 py-1.5 text-left transition-colors',
            row.note.id === activeNoteId ? 'bg-row-active' : 'hover:bg-elevated',
          )}
        >
          <span
            // A note on a pinned variation and a note on the game both label themselves
            // with a move, and `1…c6` on a detour is not the `1…c6` of the game. The old
            // panel said which by printing the word "variation" beside it; this row is a
            // quarter of that width, so it says it in the colour instead — the same
            // brilliant the variation's own moves are drawn in — and spells it out in the
            // title for anyone the colour does not reach.
            className={cn(
              'w-14 flex-none font-mono text-[0.6875rem] tabular',
              row.onLine ? 'text-brilliant' : 'text-dim',
            )}
            title={row.onLine ? 'On a pinned variation' : 'On the game'}
          >
            {/* A note that names no position is about the game entire; it still needs a
                label, and "game" is what it is. */}
            {row.context ?? 'game'}
          </span>
          <span className="line-clamp-2 min-w-0 flex-1 text-xs leading-[1.45] text-soft-2">
            {row.note.text}
          </span>
        </button>
      ))}
    </div>
  )
}

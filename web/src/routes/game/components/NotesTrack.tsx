/**
 * The right column's second track: Notes and Book behind a tab.
 *
 * THE NOTE COMPOSER IS NOT IN THE TAB PANE. It belongs to the position on the board, not to
 * what the reader is looking up, so switching tabs never moves the box somebody is typing
 * in. On the desktop it is not in this track at all: it sits at the foot of the move table
 * (#45), so the book and the notes have the track's whole height. On the phone, where the
 * moves are a tab of their own, this is the Notes tab and the composer is passed in and
 * docked at its floor (`./composerDock`), one line until it is used.
 *
 * Book and Notes share one pane because they answer the same question at two scopes — what
 * happened here before, and what you wrote about it — and because they are never both
 * wanted at once: Book is an opening-phase panel and notes matter everywhere.
 *
 * BOTH TABS ARE ALWAYS ON THE STRIP (owner's decision, 2026-09-01), NOTES FIRST AND OPEN
 * BY DEFAULT (owner's decision, 2026-09-13). The reader's pick, once made, stands for the
 * rest of the visit.
 *
 * Notes lead because they are the track's reason to exist: they matter at every ply, the
 * composer under the strip writes into them, and a game opened to read what you wrote
 * should show it without a click. The book used to open itself when the position had one,
 * which meant the first thing on screen changed from game to game and hid the notes on
 * exactly the games with an opening worth annotating.
 *
 * The strip is fixed for the same reason it was before: `0017_explorer_book`'s figures say
 * that of 463k positions in the owner's tree, 452k are reached by exactly one game, so
 * "None of your games reached this position" is what the Book tab says for most of most
 * games — and a tab that came and went as the board stepped moved the Notes tab under the
 * pointer. The emptiness is itself the answer to "have I been here before?".
 *
 * There is deliberately no coach card and no per-move prose here. One was built and cut.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { ArrowUpRight, Library, SlidersHorizontal } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { PickerSelect } from '@/components/ui/native-select'
import { cn } from '@/lib/utils'
import { SOURCES, type ExplorerSource } from '@/routes/explorer/reference'

import { bookSource, useBookFilters } from '../bookSource'
import type { NoteRow } from '../notesModel'
import { BookFiltersDialog } from './BookFiltersDialog'
import { BookPanel, type BookEntry, type BookMove } from './BookPanel'
import { DOCK, DOCK_CLEARANCE } from './composerDock'
import { ComposerSlot } from './ComposerSlot'
import { PANE_TOOL, STRIP_FACTS, STRIP_RULE, TAB_ROW } from './paneTabs'
import { PaneTab, PaneTabList } from './PaneTabList'
import { ReferenceBook } from './ReferenceBook'

/** The Book's three sources as its picker names them. */
const SOURCE_NAMES: Record<ExplorerSource, MessageDescriptor> = {
  mine: msg`My games`,
  masters: msg`Masters`,
  lichess: msg({ message: 'Lichess', comment: 'The site’s own name — keep it as it is.' }),
}

export type NotesTrackTab = 'book' | 'notes'

export interface NotesTrackProps {
  /**
   * The owner's own tree from the position on the board — `GameDetail.book[bookPly]`, passed
   * straight through. Absent, or carrying no continuations, is the common case and the Book
   * tab says so; see the note above.
   */
  book?: BookEntry | null
  /** The half-move count on the board: the key `book` was taken from, and the moves' label. */
  bookPly: number
  /** What the opening book calls the line the board is in (`gameModel.openingAt`). */
  opening?: { eco: string; name: string } | null
  /**
   * The position on the board, which is what the masters and Lichess books are asked about
   * (`ReferenceBook`). The owner's own book arrives ready in `book`; theirs is fetched.
   */
  fen?: string | null
  onPlayBookMove?: (move: BookMove) => void
  /**
   * Open the position on the board in `/explorer`, where the same tree has the whole screen
   * — a table of continuations, the reference books beside it and the games in the line.
   * Offered as a small arrow on the Book tab's own row; without it the row is just the
   * count it always was.
   */
  onOpenInExplorer?: () => void
  /** Preview a continuation on the board without selecting it; `null` restores. */
  onPreviewBookMove?: (continuation: string[] | null) => void

  /** This game's notes in reading order (`notesModel.noteRows`). */
  notes: readonly NoteRow[]
  /** The note the composer is currently on, which is the row that lights up. */
  activeNoteId?: number | null
  /** Clicking a row seeks the board to where that note hangs. */
  onSelectNote: (row: NoteRow) => void
  /**
   * Point the composer at the game entire — what the *game* row does while this game has
   * no note of its own yet. Absent (a game nobody can write on), there is no such row.
   */
  onWriteGameNote?: () => void
  /** Whether the composer is on the game entire, which is when the *game* row lights up. */
  gameNoteActive?: boolean
  /**
   * Router state for the links to where a note was written — the position the board is on,
   * so the game or explorer they open offers the way back to exactly here, and who played
   * this game, which another game names that way back with.
   */
  originState?: { from: string; label?: string }

  /**
   * What the Notes tab says when it has no rows, in place of "No notes in this game yet." —
   * a game nobody can write on says *why*, which the one-line composer slot only has room
   * to hint at.
   */
  emptyNotes?: string
  /**
   * The `<NoteComposer/>` for the position on the board, docked at the track's floor and
   * never wrapped in a tab — the phone's. The desktop docks it under the move table instead
   * and passes none.
   */
  composer?: ReactNode
  /** The open tab, when the page holds it. */
  tab?: NotesTrackTab
  onTabChange?: (tab: NotesTrackTab) => void
  className?: string
}

export function NotesTrack({
  book,
  bookPly,
  opening = null,
  fen = null,
  onPlayBookMove,
  onPreviewBookMove,
  onOpenInExplorer,
  notes,
  activeNoteId = null,
  onSelectNote,
  onWriteGameNote,
  gameNoteActive = false,
  originState,
  emptyNotes,
  composer,
  tab,
  onTabChange,
  className,
}: NotesTrackProps) {
  const { t, i18n } = useLingui()
  // Notes until the reader picks one, and their pick from then on. Deliberately not a
  // function of the position: a default that follows the board is a pane that changes
  // behind the reader's back (see the note above). The game view holds the pick so `B`
  // can make it; left uncontrolled, the track keeps its own.
  const [ownActive, setOwnActive] = useState<NotesTrackTab>('notes')
  const active = tab ?? ownActive
  const setActive = (next: NotesTrackTab) =>
    onTabChange ? onTabChange(next) : setOwnActive(next)

  const moves = book?.moves ?? []
  // The entry's own count, which includes games that *ended* here and so is not the sum of
  // the continuations. Falling back to that sum keeps the tab honest either way.
  const games = book?.games ?? moves.reduce((total, move) => total + (move.games ?? 0), 0)
  const noteCount = notes.length

  // Which book the tab reads, and the Lichess filters (`../bookSource`): per browser, the
  // owner's own games until they pick another. The filters dialog is the Book's alone.
  const source = bookSource.use()
  const filters = useBookFilters()
  const [filtering, setFiltering] = useState(false)
  const reference = source !== 'mine'

  return (
    <section
      data-testid="notes-track"
      className={cn('flex min-h-0 min-w-0 flex-col', composer !== undefined && DOCK, className)}
    >
      <div className={cn(TAB_ROW, '@container')}>
        <PaneTabList label={t`Book and notes`}>
          <PaneTab
            id="notes-track-tab-notes"
            controls="notes-track-pane"
            selected={active === 'notes'}
            onSelect={() => setActive('notes')}
          >
            <Trans>Notes</Trans>
          </PaneTab>
          <PaneTab
            id="notes-track-tab-book"
            controls="notes-track-pane"
            selected={active === 'book'}
            onSelect={() => setActive('book')}
          >
            <Trans>Book</Trans>
          </PaneTab>
        </PaneTabList>
        <span className="flex-1" />
        {/* Which book, on the Book tab: a value picked from a list, so a strip picker — no
            face at rest among the strip's quiet facts — and beside it, for Lichess only, the
            way into its filters. Masters is one book with nothing to filter. */}
        {active === 'book' ? (
          <PickerSelect
            label={t`Book`}
            hideLabel
            size="strip"
            value={source}
            options={SOURCES.map((value) => ({ value, label: i18n._(SOURCE_NAMES[value]) }))}
            onChange={(value) => bookSource.set(value as ExplorerSource)}
            title={`${i18n._(SOURCE_NAMES[source])}: ${t`Which games the book is drawn from`}`}
            leading={<Library className="size-3.5 flex-none text-soft" aria-hidden />}
            // In a narrow track the name gives way to the icon and ⇅ (the line preview's
            // picker does the same), so the filters and the explorer arrow stay on the row.
            className="flex-none self-center @max-[17rem]:[&>span.font-medium]:sr-only"
          />
        ) : null}
        {active === 'book' && source === 'lichess' ? (
          <button
            type="button"
            onClick={() => setFiltering(true)}
            aria-label={t`Lichess filters`}
            title={t`Lichess filters — speed and rating`}
            className={cn(PANE_TOOL, 'ml-0.5 self-center')}
          >
            <SlidersHorizontal className="size-3.5" aria-hidden />
          </button>
        ) : null}
        {/* The count belongs to whichever pane is open: a fact of the strip, in the quietest
            type on the row — and it is the part that leaves when the track is too narrow for
            it and the explorer arrow both, since the arrow is the only way out of this pane.
            A reference book has no count here: its numbers are in the table, by the thousand. */}
        {active === 'book' && reference ? null : (
          <span
            className={cn('ml-2 flex items-center font-mono', STRIP_FACTS, '@max-[13rem]:hidden')}
          >
            {active === 'book' ? (
              <Plural value={games} one="# game" other="# games" />
            ) : (
              <Plural value={noteCount} one="# note" other="# notes" />
            )}
          </span>
        )}
        {/*
          The way out to the full explorer, on the Book tab only: this pane is four columns
          of a seven-column table and has no room for the reference books, the line summary
          or the games in the line. An arrow rather than a word — the row is 35 design pixels
          with two tabs and a count already on it — and the explorer it opens carries the way
          back to this game, so following it is not leaving the game behind.
        */}
        {active === 'book' && onOpenInExplorer ? (
          <span aria-hidden className={cn(STRIP_RULE, 'ml-2 self-center @max-[17rem]:hidden')} />
        ) : null}
        {active === 'book' && onOpenInExplorer ? (
          <button
            type="button"
            onClick={onOpenInExplorer}
            aria-label={t`Open this position in the explorer`}
            title={t`Open this position in the explorer`}
            className={cn(PANE_TOOL, 'ml-1 self-center')}
          >
            <ArrowUpRight className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>

      {/*
        The pane shrinks and scrolls; it never grows. What takes the room the panes do not
        want is the spacer below, which is what keeps a docked composer on the floor of the
        track rather than floating up under a short list.
      */}
      <div
        role="tabpanel"
        id="notes-track-pane"
        aria-labelledby={active === 'book' ? 'notes-track-tab-book' : 'notes-track-tab-notes'}
        className={cn('min-h-0 overflow-y-auto', composer !== undefined && DOCK_CLEARANCE)}
      >
        {active === 'book' && reference ? (
          fen ? (
            <ReferenceBook
              source={source}
              fen={fen}
              ply={bookPly}
              speeds={filters.speeds}
              ratings={filters.ratings}
              onPlay={onPlayBookMove}
              onPreview={onPreviewBookMove}
            />
          ) : null
        ) : active === 'book' ? (
          <>
            {/* The name heads the pane rather than sitting on the tab row: that row is 35
                design pixels with two tabs, a count and the explorer arrow already on it,
                and an opening name is as long as "Sicilian Defense: Najdorf Variation". */}
            {opening ? (
              <div
                data-testid="book-opening"
                title={opening.name}
                className="flex items-baseline gap-2 px-3 pt-2 pb-1"
              >
                <span className="truncate text-data font-semibold text-ink">
                  {opening.name}
                </span>
                <span className="flex-none font-mono text-meta text-dim">{opening.eco}</span>
              </div>
            ) : null}
            <BookPanel
              moves={moves}
              ply={bookPly}
              onPlay={onPlayBookMove}
              onPreview={onPreviewBookMove}
            />
          </>
        ) : (
          <NoteList
            notes={notes}
            activeNoteId={activeNoteId}
            onSelect={onSelectNote}
            onWriteGameNote={onWriteGameNote}
            gameNoteActive={gameNoteActive}
            empty={emptyNotes}
            originState={originState}
          />
        )}
      </div>

      <div className="min-h-0 flex-1" />

      {composer !== undefined ? <ComposerSlot composer={composer} /> : null}

      {filtering ? <BookFiltersDialog onClose={() => setFiltering(false)} /> : null}
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
 * **Not every row is this game's.** A note pinned to a position turns up under every game
 * that reaches it, which is the point of pinning it — but an unmarked paragraph under a
 * game the reader is working through reads as being about the moves in front of them, and
 * for a note written on somebody else's game that is false. So those rows say where they
 * came from, on a line of their own under the words: the game and the move it was written
 * on, or, where there is no game to name, what wrote it on the bare position — the explorer,
 * the live board or MCP (`Origin`).
 * They are also the rows the composer will not rewrite (`notesModel.ownNote`), so the mark
 * doubles as the reason the pencil does nothing for them.
 *
 * That line is a link to where the note was written (owner's ask, 2026-09-24): the game at
 * the move, or the explorer at the position — "from phib vs maia" is exactly the moment
 * somebody wants to go and look. It sits beside the row's button, never inside it, because
 * clicking the row still means "take this board there" and the two must not be one click.
 *
 * **The first row is always the game's own**, when the game can be written on: its note on
 * the game entire, or a quiet stub offering one. That stub is how a note about the whole
 * game gets written — clicking it points the composer at the game — and it replaced a
 * Position / Game switch on the composer that asked the question in the wrong place (see
 * `NoteComposer`). A game that has a note about itself shows that note instead, and a game
 * with several (from MCP, or the correspondence journal) shows them all and no stub.
 *
 * With nothing to show and no stub, the tab gets one quiet line and not a dashed box: a box
 * around "no notes yet" is furniture for a state that every game starts in.
 */
function NoteList({
  notes,
  activeNoteId,
  onSelect,
  onWriteGameNote,
  gameNoteActive,
  empty,
  originState,
}: {
  notes: readonly NoteRow[]
  activeNoteId: number | null
  onSelect: (row: NoteRow) => void
  onWriteGameNote?: () => void
  gameNoteActive: boolean
  empty?: string
  originState?: { from: string; label?: string }
}) {
  const { t } = useLingui()
  const gameLabel = t({
    message: 'game',
    comment: 'Label on a note that hangs on the whole game rather than one move',
  })
  const stub =
    onWriteGameNote && !notes.some((row) => row.anchor.kind === 'loose' && !row.elsewhere)

  if (notes.length === 0 && !stub) {
    return (
      <p className="px-3 py-4 text-data text-dim">
        {empty ?? <Trans>No notes in this game yet.</Trans>}
      </p>
    )
  }

  return (
    <div data-testid="game-notes" className="flex flex-col px-1.5 pt-1 pb-2">
      {stub ? (
        <button
          type="button"
          data-testid="game-note-stub"
          onClick={onWriteGameNote}
          className={cn(ROW, 'py-1.5', gameNoteActive ? 'bg-row-active' : 'hover:bg-raised')}
        >
          <span className={cn(LABEL, 'text-dim')} title={t`On the game`}>
            {gameLabel}
          </span>
          <span className="min-w-0 flex-1 text-data text-dim">
            <Trans>What was this game about? Click to write.</Trans>
          </span>
        </button>
      ) : null}
      {notes.map((row) => {
        // Named, because they are the placeholders a translator sees in "Open … at …".
        const from = row.from
        const move = row.originMove
        return (
          <div
            key={row.note.id}
            className={cn(
              'flex flex-col rounded-md transition-colors',
              row.note.id === activeNoteId ? 'bg-row-active' : 'hover:bg-raised',
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(row)}
              className={cn(ROW, row.elsewhere ? 'pt-1.5 pb-0.5' : 'py-1.5')}
            >
              <span
                // A note on a pinned variation and a note on the game both label themselves
                // with a move, and `1…c6` on a detour is not the `1…c6` of the game. The old
                // panel said which by printing the word "variation" beside it; this row is a
                // quarter of that width, so it says it in the colour instead — the same
                // brilliant the variation's own moves are drawn in — and spells it out in the
                // title for anyone the colour does not reach. A note from somewhere else gets
                // the quietest of the three: the label is still where *this* game reaches the
                // position, which is where clicking the row goes.
                className={cn(
                  LABEL,
                  row.elsewhere ? 'text-dim-2' : row.onLine ? 'text-brilliant' : 'text-dim',
                )}
                title={
                  row.elsewhere
                    ? t`Written elsewhere, about a position this game reached`
                    : row.onLine
                      ? t`On a pinned variation`
                      : t`On the game`
                }
              >
                {/* A note that names no position is about the game entire; it still needs a
                    label, and "game" is what it is. */}
                {row.context ?? gameLabel}
              </span>
              <span
                className={cn(
                  'line-clamp-2 min-w-0 flex-1 text-data',
                  row.elsewhere ? 'text-dim' : 'text-body',
                )}
              >
                {row.note.text}
              </span>
            </button>
            {row.elsewhere ? (
              // Indented to the text column: the row's padding, the label's width, the gap.
              <span className="flex min-w-0 pr-1.5 pb-1.5 pl-[4.5rem] text-meta text-dim-2">
                {row.originHref ? (
                  <Link
                    to={row.originHref}
                    state={originState}
                    title={
                      from
                        ? move
                          ? t`Open ${from} at ${move}`
                          : t`Open ${from}`
                        : t`Open this position in the explorer`
                    }
                    className="flex min-w-0 items-center gap-1 transition-colors hover:text-accent-teal"
                  >
                    <span className="truncate">
                      <Origin row={row} />
                    </span>
                    <ArrowUpRight className="size-2.5 flex-none" aria-hidden />
                  </Link>
                ) : (
                  <span className="truncate">
                    <Origin row={row} />
                  </span>
                )}
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Where a note from elsewhere was written, in a few words: the game and its move, or — for
 * a note that names no game — the surface that wrote it on the bare position. The note's
 * `source` tells those apart: a web note with no game can only have come from the explorer,
 * since every other screen that writes one writes it on a game.
 */
function Origin({ row }: { row: NoteRow }) {
  // Named, because it is the placeholder a translator sees in "from …".
  const origin = row.from
  if (origin) {
    return (
      <>
        {/* A model game is somebody else's game, as the explorer's notes say too. */}
        {row.note.game?.is_owner_game === false ? (
          <Trans>from the model game {origin}</Trans>
        ) : (
          <Trans>from {origin}</Trans>
        )}
        {row.originMove ? <span className="font-mono"> · {row.originMove}</span> : null}
      </>
    )
  }
  if (row.source === 'mcp') return <Trans>via MCP</Trans>
  if (row.source === 'live') return <Trans>from the live board</Trans>
  return <Trans>from the explorer</Trans>
}

/** A Notes-tab row's button: the label column, then the words. */
const ROW = 'flex w-full items-baseline gap-2.5 rounded-md px-1.5 text-left'
/** The label column — `6.Bc4`, `game` — whose width the origin line indents past. */
const LABEL = 'w-14 flex-none font-mono text-label'

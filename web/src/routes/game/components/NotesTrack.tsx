/**
 * The right column's second track: Notes and Book behind a tab, with the note composer
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
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { ArrowUpRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'

import type { NoteRow } from '../notesModel'
import { BookPanel, type BookEntry, type BookMove } from './BookPanel'
import { TAB, TAB_ON, TAB_ROW } from './paneTabs'

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

  /** The `<NoteComposer/>` for the position on the board. Rendered, never wrapped in a tab. */
  composer: ReactNode
  /** The open tab, when the page holds it. */
  tab?: NotesTrackTab
  onTabChange?: (tab: NotesTrackTab) => void
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


export function NotesTrack({
  book,
  bookPly,
  opening = null,
  onPlayBookMove,
  onPreviewBookMove,
  onOpenInExplorer,
  notes,
  activeNoteId = null,
  onSelectNote,
  onWriteGameNote,
  gameNoteActive = false,
  originState,
  composer,
  tab,
  onTabChange,
  className,
}: NotesTrackProps) {
  const { t } = useLingui()
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

  return (
    <section
      data-testid="notes-track"
      className={cn('flex min-h-0 min-w-0 flex-col', className)}
    >
      <div role="tablist" aria-label={t`Book and notes`} className={cn(TAB_ROW, '@container')}>
        <button
          type="button"
          role="tab"
          id="notes-track-tab-notes"
          aria-selected={active === 'notes'}
          aria-controls="notes-track-pane"
          onClick={() => setActive('notes')}
          className={cn(TAB, active === 'notes' && TAB_ON)}
        >
          <Trans>Notes</Trans>
        </button>
        <button
          type="button"
          role="tab"
          id="notes-track-tab-book"
          aria-selected={active === 'book'}
          aria-controls="notes-track-pane"
          onClick={() => setActive('book')}
          className={cn(TAB, active === 'book' && TAB_ON)}
        >
          <Trans>Book</Trans>
        </button>
        <span className="flex-1" />
        {/* The count belongs to whichever pane is open, in the quietest type on the row —
            and it is the part that leaves when the track is too narrow for it and the
            explorer arrow both, since the arrow is the only way out of this pane. */}
        <span className="flex items-center font-mono text-[0.625rem] text-faint tabular @max-[13rem]:hidden">
          {active === 'book' ? (
            <Plural value={games} one="# game" other="# games" />
          ) : (
            <Plural value={noteCount} one="# note" other="# notes" />
          )}
        </span>
        {/*
          The way out to the full explorer, on the Book tab only: this pane is four columns
          of a seven-column table and has no room for the reference books, the line summary
          or the games in the line. An arrow rather than a word — the row is 35 design pixels
          with two tabs and a count already on it — and the explorer it opens carries the way
          back to this game, so following it is not leaving the game behind.
        */}
        {active === 'book' && onOpenInExplorer ? (
          <button
            type="button"
            onClick={onOpenInExplorer}
            aria-label={t`Open this position in the explorer`}
            title={t`Open this position in the explorer`}
            className="ml-1.5 flex flex-none items-center rounded-sm border border-edge bg-elevated px-1 py-px text-dim transition-colors hover:border-edge-hover hover:text-ink"
          >
            <ArrowUpRight className="size-3" aria-hidden />
          </button>
        ) : null}
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
                <span className="truncate text-[0.75rem] font-semibold text-ink">
                  {opening.name}
                </span>
                <span className="flex-none font-mono text-[0.625rem] text-dim">{opening.eco}</span>
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
            originState={originState}
          />
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
  originState,
}: {
  notes: readonly NoteRow[]
  activeNoteId: number | null
  onSelect: (row: NoteRow) => void
  onWriteGameNote?: () => void
  gameNoteActive: boolean
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
      <p className="px-3 py-4 text-[0.71875rem] text-faint">
        <Trans>No notes in this game yet.</Trans>
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
          className={cn(ROW, 'py-1.5', gameNoteActive ? 'bg-row-active' : 'hover:bg-elevated')}
        >
          <span className={cn(LABEL, 'text-dim')} title={t`On the game`}>
            {gameLabel}
          </span>
          <span className="min-w-0 flex-1 text-xs leading-[1.45] text-faint">
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
              'flex flex-col rounded-[0.3125rem] transition-colors',
              row.note.id === activeNoteId ? 'bg-row-active' : 'hover:bg-elevated',
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
                  row.elsewhere ? 'text-faint' : row.onLine ? 'text-brilliant' : 'text-dim',
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
                  'line-clamp-2 min-w-0 flex-1 text-xs leading-[1.45]',
                  row.elsewhere ? 'text-dim' : 'text-soft-2',
                )}
              >
                {row.note.text}
              </span>
            </button>
            {row.elsewhere ? (
              // Indented to the text column: the row's padding, the label's width, the gap.
              <span className="flex min-w-0 pr-1.5 pb-1.5 pl-[4.5rem] text-[0.625rem] text-faint">
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
const ROW = 'flex w-full items-baseline gap-2.5 rounded-[0.3125rem] px-1.5 text-left'
/** The label column — `6.Bc4`, `game` — whose width the origin line indents past. */
const LABEL = 'w-14 flex-none font-mono text-[0.6875rem] tabular'

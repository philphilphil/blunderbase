/**
 * What has been written about *this* position, and where the owner writes it.
 *
 * It began as design 2c's "Where this line goes wrong" card, read-only, because notes
 * arrived over MCP and nowhere else. They are the explorer's own annotations now — the move
 * table's `Note` column shows each continuation's newest one — so this is the one place in
 * the app where a note about a position is authored rather than a note about a game. It sits
 * under the board rather than beside the tree because that is what it is about, and it
 * renders even with nothing to show: an empty card is the invitation to write the first one.
 *
 * Provenance stays visible. A note the coach wrote over MCP keeps the amber left edge and
 * the `note via MCP` chip; one the owner typed here carries neither, because a conclusion
 * the coach reached and a reminder they left themselves should not look identical.
 *
 * **Writing is a native `<textarea>` that saves itself when it loses focus** — there is no
 * Save button, because the one failure a notes box does not get to have is losing what
 * somebody typed, and a button is a thing to forget to press. The rules that makes safe:
 *
 * - Text that did not change writes nothing. A focus and a blur is not an edit, and a
 *   `PATCH` per glance would put a write in the log for every click on the board.
 * - An empty box that had no note behind it writes nothing either: `POST /notes` requires
 *   text (`min_length=1`) and would answer 422 to the act of opening a box and closing it.
 * - **Clearing an existing note to empty leaves the note alone.** Blur is not a decision —
 *   a select-all and a stray keystroke would otherwise destroy a note with no way back — so
 *   deleting stays the explicit button it has always been, and the box simply reverts.
 * - One write at a time, in the order they were made: saves are chained, so an edit made
 *   while an earlier save is still in flight is queued rather than dropped or raced.
 * - Escape abandons what is in the box and closes it.
 *
 * With no button to press, the confirmation is a `saved` mark beside the card's title for a
 * couple of seconds — small, in the good-news colour, never over the text.
 *
 * Tags are deliberately not here: the game page's composer is where a note is filed
 * properly, and a position note is the cheap kind, written in the middle of walking a line.
 *
 * `POST /notes` with a FEN creates the position row if no game ever reached it, so a note
 * can be left on a position the owner has only browsed to. Every write invalidates the
 * explorer as well as `['notes']` (`lib/api/queries`, `lib/events/invalidation`), since the
 * tree payload carries these same notes on its rows.
 */
import { Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useDeleteNote, useNotes, useSaveNote, useUpdateNote } from '@/lib/api/queries'
import type { NoteResponse } from '@/lib/api/types'
import { MCP_SERVER_NAME, relative } from '@/lib/mcp/status'
import { cn } from '@/lib/utils'

const LIMIT = 3

/** How long the `saved` mark stays up: long enough to notice, short enough to forget. */
const FLASH_MS = 2000

/**
 * The box that is open — a new note (`id: null`) or one being rewritten. `saved` is the text
 * the server already has, which is what "did this actually change" is measured against.
 */
type Draft = { id: number | null; text: string; saved: string } | null

export function PositionNotes({ fen }: { fen: string }) {
  const notes = useNotes({ fen, limit: LIMIT })
  const save = useSaveNote()
  const update = useUpdateNote()
  const remove = useDeleteNote()
  const [draft, setDraft] = useState<Draft>(null)
  const [flash, setFlash] = useState(0)

  // Escape closes the box by unmounting it, which the browser also reports as a blur; this
  // is how the blur that follows an abandonment knows not to save what was abandoned.
  const abandoned = useRef(false)
  // Writes run one after another. A blur while a save is in flight would otherwise race it
  // or have to be dropped, and dropping it is losing what somebody typed.
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  const found = notes.data ?? []
  const error = save.error ?? update.error ?? remove.error

  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => setFlash(0), FLASH_MS)
    return () => clearTimeout(timer)
  }, [flash])

  function enqueue(write: () => Promise<unknown>) {
    // `.then(write, write)` so one failed save does not strand the ones behind it, and a
    // trailing catch so a rejection the card is already showing is not also unhandled.
    queue.current = queue.current.then(write, write).catch(() => {})
  }

  function open(next: NonNullable<Draft>) {
    abandoned.current = false
    setDraft(next)
  }

  /** Focus left the box: write what changed, if anything did, and close it. */
  function commit(box: NonNullable<Draft>) {
    setDraft(null)
    if (abandoned.current) {
      abandoned.current = false
      return
    }
    const text = box.text.trim()
    // Unchanged, or emptied — neither is a write. See the header for why emptying an
    // existing note is not a delete.
    if (text === box.saved.trim() || text === '') return
    const written = () => setFlash(Date.now())
    const id = box.id
    if (id === null) enqueue(() => save.mutateAsync({ text, fen }).then(written))
    else enqueue(() => update.mutateAsync({ id, body: { text } }).then(written))
  }

  function abandon() {
    abandoned.current = true
    setDraft(null)
  }

  return (
    <div
      data-testid="position-notes"
      className="flex flex-none flex-col gap-[0.4375rem] rounded-[0.5625rem] border border-line bg-panel p-[0.8125rem]"
    >
      <div className="flex items-center gap-2">
        <span className="text-[0.75rem] font-semibold text-ink">Your notes on this position</span>
        {flash ? (
          <span role="status" className="text-[0.625rem] text-good">
            saved
          </span>
        ) : null}
        <div className="flex-1" />
        {draft === null ? (
          <button
            type="button"
            onClick={() => open({ id: null, text: '', saved: '' })}
            className="rounded-md border border-edge px-2 py-[0.1875rem] text-[0.6875rem] text-soft hover:border-edge-hover hover:text-ink"
          >
            Add note
          </button>
        ) : null}
      </div>

      {/*
        The left pane does not scroll — the board holds it open — so the card scrolls inside
        itself rather than pushing "Your results in this line" off the bottom of a short
        window. Three notes is what this list asks the server for in the first place.
      */}
      <div className="flex max-h-[11.5rem] flex-col gap-[0.4375rem] overflow-y-auto">
        {found.map((note) =>
          draft?.id === note.id ? (
            <Composer
              key={note.id}
              draft={draft}
              onChange={(text) => setDraft({ ...draft, text })}
              onCommit={() => commit(draft)}
              onAbandon={abandon}
            />
          ) : (
            <Written
              key={note.id}
              note={note}
              onEdit={() => open({ id: note.id, text: note.text, saved: note.text })}
              onDelete={() => remove.mutate(note.id)}
            />
          ),
        )}

        {draft?.id === null ? (
          <Composer
            draft={draft}
            onChange={(text) => setDraft({ ...draft, text })}
            onCommit={() => commit(draft)}
            onAbandon={abandon}
          />
        ) : null}

        {found.length === 0 && draft === null ? (
          <button
            type="button"
            onClick={() => open({ id: null, text: '', saved: '' })}
            className="rounded-md border border-dashed border-edge-strong px-2.5 py-2.5 text-left text-[0.75rem] text-dim hover:border-edge-hover hover:text-soft"
          >
            Nothing written about this position yet. What is worth remembering here?
          </button>
        ) : null}
      </div>

      {error ? <p className="text-[0.6875rem] text-blunder">{error.message}</p> : null}
    </div>
  )
}

/**
 * One stored note. The amber edge and the chip are the coach's alone, so a note reads as
 * either "what I told myself" or "what the coach concluded" at a glance.
 */
function Written({
  note,
  onEdit,
  onDelete,
}: {
  note: NoteResponse
  onEdit: () => void
  onDelete: () => void
}) {
  const viaMcp = note.source === 'mcp'
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-md bg-elevated px-2 py-1.5',
        viaMcp && 'border-l-2 border-l-mistake',
      )}
    >
      <p className="whitespace-pre-wrap text-[0.78125rem] leading-[1.55] text-body-2">
        {note.text}
      </p>
      <div className="flex items-center gap-2">
        {viaMcp ? (
          <span
            className="inline-flex items-center gap-[0.3125rem] rounded-sm border border-edge px-1.5 py-px text-[0.625rem] text-soft"
            title={`written over MCP by ${MCP_SERVER_NAME}`}
          >
            <span className="size-[0.3125rem] rounded-full bg-good" />
            note via MCP
          </span>
        ) : null}
        <span className="font-mono text-[0.625rem] text-faint">{relative(note.created_at)}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit this note"
          title="Edit this note"
          className="px-0.5 text-faint hover:text-ink"
        >
          <Pencil className="size-3" aria-hidden />
        </button>
        {/* The only thing that destroys a note: a blur never does — see the header. */}
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete this note"
          title="Delete this note"
          className="px-0.5 text-faint hover:text-blunder"
        >
          <Trash2 className="size-3" aria-hidden />
        </button>
      </div>
    </div>
  )
}

function Composer({
  draft,
  onChange,
  onCommit,
  onAbandon,
}: {
  draft: NonNullable<Draft>
  onChange: (text: string) => void
  /** Focus left the box: save what changed and close it. */
  onCommit: () => void
  /** Escape: throw the edit away and close it. */
  onAbandon: () => void
}) {
  return (
    <textarea
      value={draft.text}
      autoFocus
      rows={3}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onAbandon()
        }
      }}
      placeholder="What is worth remembering about this position? It saves when you click away."
      aria-label="Note text"
      className="w-full resize-none rounded-md border border-input bg-raised px-2.5 py-1.5 text-[0.78125rem] leading-[1.5] text-ink outline-none placeholder:text-faint focus-visible:border-accent-teal/50"
    />
  )
}

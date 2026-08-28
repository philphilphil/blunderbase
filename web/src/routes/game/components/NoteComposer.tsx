import { Loader2, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { cn } from '@/lib/utils'

import type { GameNote } from '../gameModel'
import { targetKey, type NoteTarget } from '../notesModel'

export interface NoteComposerProps {
  /** What the note will hang on, already worked out by `noteTarget`. */
  target: NoteTarget
  /** The note that already hangs there, which this composer rewrites (`noteAtTarget`). */
  note?: GameNote | null
  /** Every tag the owner has used, for the tag box's suggestions (`GET /notes/tags`). */
  knownTags?: readonly string[]
  pending?: boolean
  error?: Error | null
  /** `id` names the note being rewritten, or is null where the save writes a new one. */
  onSave: (text: string, tags: string[], id: number | null) => void
  onDelete?: (id: number) => void
  onClose: () => void
  className?: string
}

/** How many suggestions the tag box offers at once — a list, not a catalogue. */
/** The textarea's DOM id: the page focuses it from the Note button and the move list. */
export const COMPOSER_TEXT_ID = 'note-composer-text'

const MAX_SUGGESTIONS = 6

/** What the box was last filled from: a note of this game's, or nothing. */
interface Loaded {
  id: number | null
  text: string
  tags: string[]
}

function loadedFrom(note: GameNote | null | undefined): Loaded {
  return note
    ? { id: note.id, text: note.text, tags: [...(note.tags ?? [])] }
    : { id: null, text: '', tags: [] }
}

function sameTags(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((tag, index) => tag === right[index])
}

/**
 * Writing a note about the position on the board — or rewriting the one already on it.
 *
 * It is deliberately one box and one row under it: the whole point of a note is that it
 * costs nothing to write, and a form with fields for the game, the ply and the FEN would be
 * asking the reader to retype what the board already knows. Where it hangs is stated rather than
 * chosen — "2…d5", "1…c6 (variation)" — and off the game's own line that sentence carries the
 * consequence too, because a note on a variation pins the variation.
 *
 * The board moves under it while it is open, and the note under the board moves with it: a
 * position this game has already been noted on fills the box in and the save rewrites that
 * note (`· edit`) rather than laying a second one on the same square. The one thing that
 * outranks the board is text nobody has saved — a draft follows the reader to wherever they
 * have stepped and is written as a new note there, because silently discarding what somebody
 * typed is the one failure a notes box does not get to have.
 *
 * The composer is sized by its slot rather than by its contents (the eval curve's, on the
 * game page): the text box takes what is left under the one row that must stay reachable, so
 * the tags and the save button are on screen at every height that column can be.
 *
 * Tags are chips: typed with Enter or a comma, offered from what has been used before, and
 * removed by clicking them. Nothing is normalised here beyond trimming and case-folding
 * duplicates away — the backend owns the tag vocabulary, and inventing a second one on this
 * side is how the two drift apart.
 */
export function NoteComposer({
  target,
  note,
  knownTags,
  pending,
  error,
  onSave,
  onDelete,
  onClose,
  className,
}: NoteComposerProps) {
  const [loaded, setLoaded] = useState<Loaded>(() => loadedFrom(note))
  const [text, setText] = useState(loaded.text)
  const [tags, setTags] = useState<string[]>(loaded.tags)
  const [draft, setDraft] = useState('')
  const [tagging, setTagging] = useState(false)

  // Which position, and which note on it, the box is currently filled from.
  const here = `${targetKey(target)}|${note?.id ?? ''}`
  const [filledFor, setFilledFor] = useState(here)
  if (here !== filledFor) {
    // State adjusted during the render that saw the prop move, which is what React asks
    // for here: the alternative is an effect, and an effect would paint the old note's
    // text under the new position's caption for a frame.
    setFilledFor(here)
    const next = loadedFrom(note)
    // Text that matches the note now hanging here is not a draft: it is the note this box
    // just saved, come back from the server with its id. Without this the words typed into
    // an empty box would count as unsaved forever and follow the reader to the next move.
    const saved = text === next.text && sameTags(tags, next.tags)
    const typed =
      !saved && text.trim().length > 0 && (text !== loaded.text || !sameTags(tags, loaded.tags))
    if (typed) {
      // Unsaved text follows the reader. It is a new note where they have arrived — not a
      // rewrite of whatever hangs there, which it would otherwise silently overwrite — and
      // `loaded` keeps the text it was measured against so it stays unsaved until it is
      // saved or cleared.
      setLoaded({ ...loaded, id: null })
    } else {
      setLoaded(next)
      setText(next.text)
      setTags(next.tags)
    }
  }

  /** The note being rewritten, or null while the save would write a new one. */
  const editing = loaded.id

  const suggestions = useMemo(() => {
    const query = draft.trim().toLowerCase()
    const taken = new Set(tags.map((tag) => tag.toLowerCase()))
    return (knownTags ?? [])
      .filter((tag) => !taken.has(tag.toLowerCase()) && tag.toLowerCase().includes(query))
      .slice(0, MAX_SUGGESTIONS)
  }, [draft, knownTags, tags])

  function addTag(value: string) {
    const tag = value.trim()
    if (!tag) return
    setDraft('')
    setTags((current) =>
      current.some((existing) => existing.toLowerCase() === tag.toLowerCase())
        ? current
        : [...current, tag],
    )
  }

  const ready = text.trim().length > 0 && !pending

  function save() {
    if (!ready) return
    // A tag half-typed and never committed is still a tag the reader meant.
    const all = draft.trim() ? [...tags, draft.trim()] : tags
    onSave(text.trim(), all, editing)
  }

  return (
    <section
      data-testid="note-composer"
      className={cn(
        'flex min-h-0 flex-col gap-1.5 overflow-y-auto rounded-md border border-hairline bg-elevated px-3 py-1.5',
        className,
      )}
    >
      <textarea
        id={COMPOSER_TEXT_ID}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
            return
          }
          // ⌘/Ctrl-Enter saves; a bare Enter is a new paragraph, which a note wants.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            save()
          }
        }}
        placeholder="What is worth remembering about this position?"
        aria-label="Note text"
        // The box is what gives way when the column is short: `min-h-0`, so what shrinks is
        // the writing and never the row under it, and no resize handle — the slot decides
        // the height now.
        className="min-h-0 w-full flex-1 resize-none rounded-md border border-input bg-raised px-2.5 py-1.5 text-[0.78125rem] leading-[1.5] text-ink outline-none placeholder:text-faint focus-visible:border-accent-teal/50"
      />

      {/*
        Where the note hangs, its tags and both buttons on one row.

        The slot this composer lives in is a hundred-odd pixels tall at the heights the page
        is actually read at — the board above it is sized by its width and gives up nothing —
        and a caption, a tag row and a button row stacked under the text box do not fit in
        it: what went off the bottom of the viewport was the save button, and before that the
        eval curve. One row fits, and the box above it is what shrinks.

        It is stuck to the bottom rather than merely last, because a text box cannot shrink
        below its own padding: at some height something still has to give, and what gives is
        the writing, which scrolls under a row that stays where it is.
      */}
      <div className="sticky bottom-0 z-10 flex shrink-0 flex-nowrap items-center gap-1.5 bg-elevated">
        {/*
          Suggestions — and a failed save — sit *over* the box rather than in the column, for
          the same reason: a row that only sometimes exists is a row that sometimes pushes
          the buttons out, and the one time an error must be readable is the one time the
          composer is at its fullest. Suggestions are offered while the tag box is being used
          rather than whenever it is empty, because over a text box this short they would be
          covering the note itself.
        */}
        {error ? (
          <p className="absolute inset-x-0 bottom-full mb-1 truncate rounded-md border border-blunder/30 bg-raised px-1.5 py-1 text-[0.6875rem] text-blunder shadow-md">
            {error.message}
          </p>
        ) : null}
        {!error && suggestions.length > 0 && (tagging || draft.trim().length > 0) ? (
          <div
            className="absolute inset-x-0 bottom-full mb-1 flex flex-wrap gap-1 rounded-md border border-hairline bg-raised px-1.5 py-1 shadow-md"
            data-testid="tag-suggestions"
          >
            {suggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                // The blur a click causes would take the strip away before the click had
                // anywhere to land.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addTag(tag)}
                className="rounded-sm border border-hairline px-1.5 py-0.5 font-mono text-[0.6875rem] text-faint hover:text-ink"
              >
                {tag}
              </button>
            ))}
          </div>
        ) : null}

        <h2 className="shrink-0 font-mono text-[0.6875rem] text-dim">
          {/* No "Note on 8.Bc4": the box sits under the board, so the position it is about
              is the one on screen. Only what is not obvious is said. */}
          {/* Only a new note pins anything: a rewrite of one already on this line is a
              `PATCH` of its words, and the line it hangs on was pinned when it was written. */}
          {target.line && editing === null ? (
            <span className="text-brilliant">pins the line</span>
          ) : null}
          {editing === null ? null : <span className="text-accent-teal">edit</span>}
        </h2>

        {tags.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => setTags((current) => current.filter((entry) => entry !== tag))}
            title={`Remove “${tag}”`}
            className="flex items-center gap-1 rounded-sm border border-edge bg-chip-info px-1.5 py-0.5 font-mono text-[0.6875rem] text-soft hover:text-ink"
          >
            {tag}
            <X className="size-2.5" aria-hidden />
          </button>
        ))}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => setTagging(true)}
          onBlur={() => setTagging(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault()
              addTag(draft)
              return
            }
            // Backspace on an empty box takes the last chip back, as a chip list should.
            if (event.key === 'Backspace' && draft === '') setTags((current) => current.slice(0, -1))
          }}
          placeholder="tag…"
          aria-label="Tags"
          className="h-6 w-24 min-w-[4rem] flex-1 rounded-md border border-input bg-raised px-2 font-mono text-[0.6875rem] text-ink outline-none placeholder:text-faint focus-visible:border-accent-teal/50"
        />

        <button
          type="button"
          disabled={!ready}
          onClick={save}
          className={cn(
            'flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-[0.3125rem] text-xs',
            ready
              ? 'border-accent-teal/30 bg-accent-teal/10 text-accent-teal'
              : 'border-edge bg-elevated text-faint-2',
          )}
        >
          {pending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
          Save note
        </button>
        {/* ⌘↵ saves and Escape leaves the box; the box itself is always there, so there is
            no Cancel to press. */}
        {editing !== null && onDelete ? (
          <button
            type="button"
            onClick={() => onDelete(editing)}
            aria-label="Delete this note"
            title="Delete this note"
            className="shrink-0 px-0.5 text-faint hover:text-blunder"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
    </section>
  )
}

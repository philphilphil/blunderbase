/**
 * One note, as this screen draws it: the position it is about on the left, the note itself
 * on the right, and the two things you ever want to do to a note — rewrite it or forget it.
 *
 * Editing happens in place. There is no separate note screen and there should not be: a
 * note is three lines of prose and a handful of tags, and a round trip through a form
 * would be more chrome than content.
 */
import { Check, ExternalLink, Loader2, Pencil, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { MiniBoard } from '@/components/board/MiniBoard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useDeleteNote, useUpdateNote } from '@/lib/api/queries'
import type { NoteResponse } from '@/lib/api/types'
import { relative } from '@/lib/mcp/status'
import { cn } from '@/lib/utils'

import { lineText, noteHref, notePlyLabel, SCOPE_BADGES, scopeOf } from '../grouping'
import { TagEditor } from './TagEditor'

const SOURCE_LABELS: Record<string, string> = { mcp: 'via MCP', live: 'from live' }

export interface NoteCardProps {
  note: NoteResponse
  /** The note `/notes?note=12` asked for: ringed, and scrolled to on arrival. */
  highlighted?: boolean
  /** Every tag in use, for the editor's completion. */
  tagSuggestions?: string[]
  /** Clicking a tag chip filters the list by it. */
  onTagClick?: (tag: string) => void
  /** Set on the resurfaced strip, where a board would crowd the row. */
  compact?: boolean
}

export function NoteCard({
  note,
  highlighted = false,
  tagSuggestions = [],
  onTagClick,
  compact = false,
}: NoteCardProps) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(note.text)
  const [tags, setTags] = useState<string[]>(note.tags)
  const [confirming, setConfirming] = useState(false)
  const host = useRef<HTMLElement>(null)

  const update = useUpdateNote()
  const remove = useDeleteNote()

  // The deep link lands on a page that is already scrolled wherever it was; the note it
  // named has to bring itself into view.
  useEffect(() => {
    if (highlighted) host.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlighted])

  const scope = scopeOf(note)
  const ply = notePlyLabel(note.ply)
  const href = typeof note.game_id === 'number' ? noteHref(note) : null
  const line = note.line ? lineText(note.line) : null
  const source = note.source ? SOURCE_LABELS[note.source] : undefined

  function open() {
    setText(note.text)
    setTags(note.tags)
    setEditing(true)
  }

  function save() {
    const trimmed = text.trim()
    if (!trimmed) return
    update.mutate(
      { id: note.id, body: { text: trimmed, tags } },
      { onSuccess: () => setEditing(false) },
    )
  }

  return (
    <article
      ref={host}
      data-note-id={note.id}
      className={cn(
        'flex gap-3 rounded-lg border bg-panel p-3 transition-shadow',
        highlighted
          ? 'border-accent-teal/45 shadow-[0_0_0_0.0625rem_var(--bb-accent)]'
          : 'border-line',
      )}
    >
      {note.fen && !compact ? (
        <MiniBoard
          fen={note.fen}
          label={ply ? `The position at ${ply}` : 'The position this note is about'}
          size="6.25rem"
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={scope === 'free' ? 'dashed' : 'default'}>{SCOPE_BADGES[scope]}</Badge>
          {ply ? (
            <span className="font-mono text-[0.6875rem] tabular text-soft-2">{ply}</span>
          ) : null}
          {source ? (
            <span className="text-[0.625rem] text-faint" title={`written ${source}`}>
              {source}
            </span>
          ) : null}
          <span className="flex-1" />
          <span
            className="font-mono text-[0.625rem] text-dim-2"
            title={new Date(note.updated_at).toLocaleString()}
          >
            {relative(note.updated_at)}
          </span>
          {href ? (
            <Link
              to={href}
              title={ply ? `Open the game at ${ply}` : 'Open the game'}
              aria-label={ply ? `Open the game at ${ply}` : 'Open the game'}
              className="text-faint transition-colors hover:text-accent-teal"
            >
              <ExternalLink className="size-3.5" aria-hidden />
            </Link>
          ) : null}
          {editing ? null : (
            <>
              <button
                type="button"
                onClick={open}
                aria-label="Rewrite this note"
                title="Rewrite this note"
                className="text-faint transition-colors hover:text-ink"
              >
                <Pencil className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setConfirming((was) => !was)}
                aria-label="Forget this note"
                title="Forget this note"
                className={cn(
                  'transition-colors hover:text-blunder',
                  confirming ? 'text-blunder' : 'text-faint',
                )}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </>
          )}
        </div>

        {line ? (
          <p className="truncate font-mono text-[0.6875rem] text-soft-2" title={line}>
            {line}
          </p>
        ) : null}

        {editing ? (
          <>
            <textarea
              autoFocus
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setEditing(false)
                // ⌘/Ctrl+Enter saves, the way every box that takes prose does.
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) save()
              }}
              aria-label="Note"
              rows={4}
              className="w-full resize-y rounded-md border border-input bg-elevated px-2.5 py-2 text-[0.78125rem] leading-[1.55] text-ink outline-none focus-visible:border-accent-teal/50"
            />
            <TagEditor
              tags={tags}
              onChange={setTags}
              suggestions={tagSuggestions}
              label="This note's tags"
              className="rounded-md border border-input bg-elevated px-1.5 py-1"
            />
            <div className="flex items-center gap-1.5">
              <Button size="sm" onClick={save} disabled={update.isPending || !text.trim()}>
                {update.isPending ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                ) : (
                  <Check className="size-3" aria-hidden />
                )}
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                <X className="size-3" aria-hidden />
                Cancel
              </Button>
              {update.isError ? (
                <span className="text-[0.6875rem] text-blunder">{update.error.message}</span>
              ) : null}
            </div>
          </>
        ) : (
          <p className="whitespace-pre-wrap text-[0.78125rem] leading-[1.55] text-body-2">
            {note.text}
          </p>
        )}

        {!editing && note.tags.length ? (
          <div className="flex flex-wrap gap-1">
            {note.tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => onTagClick?.(tag)}
                disabled={!onTagClick}
                title={onTagClick ? `Show only notes tagged ${tag}` : undefined}
                className="rounded-sm border border-edge bg-elevated px-1.5 py-px text-[0.625rem] text-soft transition-colors enabled:hover:border-accent-teal/40 enabled:hover:text-accent-teal"
              >
                {tag}
              </button>
            ))}
          </div>
        ) : null}

        {confirming ? (
          <div className="flex items-center gap-2 rounded-md border border-blunder/28 bg-blunder/5 px-2 py-1.5">
            <span className="text-[0.6875rem] text-blunder">Forget this note for good?</span>
            <span className="flex-1" />
            <Button
              size="sm"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate(note.id)}
            >
              {remove.isPending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
              Forget it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  )
}

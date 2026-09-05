/**
 * Rewriting a note, and forgetting one — the two write paths, extracted so the boxes and
 * the grid cannot drift apart.
 *
 * They were inside `NoteCard` while the card was the only way to read a note. The table
 * needs exactly the same two things (in an expanded row rather than in the card's body),
 * and a second copy of "what ⌘+Enter does" or "which button is the destructive one" is how
 * two views of the same note end up behaving differently.
 *
 * Both own their own mutation. A note is edited in one place at a time, so there is nothing
 * for a parent to hold on their behalf, and keeping the mutation here is what lets either
 * view drop one in without wiring anything up.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { Check, Loader2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useDeleteNote, useUpdateNote } from '@/lib/api/queries'
import type { NoteResponse } from '@/lib/api/types'
import { useState } from 'react'

import { TagEditor } from './TagEditor'

export interface NoteEditorProps {
  note: NoteResponse
  /** Saved, or cancelled — either way this editor is done and its host should close it. */
  onDone: () => void
  /** Every tag in use, for the editor's completion. */
  tagSuggestions?: string[]
}

/** The box a note is rewritten in: its text, its tags, and the two ways out. */
export function NoteEditor({ note, onDone, tagSuggestions = [] }: NoteEditorProps) {
  const { t } = useLingui()
  const [text, setText] = useState(note.text)
  const [tags, setTags] = useState<string[]>(note.tags)
  const update = useUpdateNote()

  function save() {
    const trimmed = text.trim()
    if (!trimmed) return
    update.mutate({ id: note.id, body: { text: trimmed, tags } }, { onSuccess: onDone })
  }

  return (
    <>
      <textarea
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone()
          // ⌘/Ctrl+Enter saves, the way every box that takes prose does.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) save()
        }}
        aria-label={t`Note`}
        rows={4}
        className="w-full resize-y rounded-md border border-input bg-elevated px-2.5 py-2 text-[0.78125rem] leading-[1.55] text-ink outline-none focus-visible:border-accent-teal/50"
      />
      <TagEditor
        tags={tags}
        onChange={setTags}
        suggestions={tagSuggestions}
        label={t`This note's tags`}
        className="rounded-md border border-input bg-elevated px-1.5 py-1"
      />
      <div className="flex items-center gap-1.5 max-md:flex-wrap max-md:gap-y-1.5">
        <Button size="sm" onClick={save} disabled={update.isPending || !text.trim()}>
          {update.isPending ? (
            <Loader2 className="size-3 animate-spin" aria-hidden />
          ) : (
            <Check className="size-3" aria-hidden />
          )}
          <Trans>Save</Trans>
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          <X className="size-3" aria-hidden />
          <Trans>Cancel</Trans>
        </Button>
        {update.isError ? (
          <span className="text-[0.6875rem] text-blunder">{update.error.message}</span>
        ) : null}
      </div>
    </>
  )
}

/**
 * The second click on a delete. A note is somebody's own thinking and there is no undo, so
 * the trash icon only ever arms this; nothing is destroyed by one press.
 */
export function DeleteConfirm({ noteId, onCancel }: { noteId: number; onCancel: () => void }) {
  const remove = useDeleteNote()
  return (
    <div className="flex items-center gap-2 rounded-md border border-blunder/28 bg-blunder/5 px-2 py-1.5 max-md:flex-wrap max-md:gap-y-1.5">
      <span className="text-[0.6875rem] text-blunder">
        <Trans>Forget this note for good?</Trans>
      </span>
      <span className="flex-1" />
      <Button
        size="sm"
        variant="destructive"
        disabled={remove.isPending}
        onClick={() => remove.mutate(noteId)}
      >
        {remove.isPending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
        <Trans>Forget it</Trans>
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        <Trans>Keep it</Trans>
      </Button>
    </div>
  )
}

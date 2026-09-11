/**
 * The bottom of the right column: what has been written here, and what the books say.
 *
 * *This position* is the notes pinned to the selected node's FEN — the same rows the
 * explorer and the game page show, because a note is pinned to a position and resurfaces
 * wherever that position does. The node's own **comment** sits above them: a comment is the
 * PGN-style remark on the move and travels with the tree into the exported PGN, while a
 * note is a document of the owner's that outlives this game. Both are edited here, and the
 * difference is stated rather than left to be guessed. It is also why finishing the game
 * takes the comment box away and leaves the notes alone: the tree is locked once there is a
 * result, while notes on a game that is over are the point of having them.
 *
 * *This game* is the journal: notes with a game and no ply — what the opponent tends to do,
 * the plan, the deadline arithmetic.
 *
 * *Book* is the third tab and is passed in whole rather than built here: it is the opening
 * reference at the node (`BookPane`), and it shares this strip because it answers the same
 * kind of question as the other two — what is already known about this position — and
 * because a fourth column on a screen that already has three would cost the tree its width.
 *
 * Writing is the composer the rest of the app uses: a textarea that saves when it loses
 * focus, because the one failure a notes box does not get to have is losing what somebody
 * typed. Escape abandons the edit; clearing an existing note to empty leaves it alone.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { useDeleteNote, useNotes, useSaveNote, useUpdateNote } from '@/lib/api/queries'
import type { CorrespondenceTreeNode, NoteResponse } from '@/lib/api/types'
import { relative } from '@/lib/mcp/status'
import { commitsOnEnter } from '@/lib/ui/shortcuts'
import { cn } from '@/lib/utils'

const LIMIT = 8

export type NotesTab = 'position' | 'game' | 'book'

type Draft = { id: number | null; text: string; saved: string } | null

function Composer({
  value,
  placeholder,
  onChange,
  onCommit,
  onAbandon,
}: {
  value: string
  placeholder: string
  onChange: (text: string) => void
  onCommit: () => void
  onAbandon: () => void
}) {
  const { t } = useLingui()
  return (
    <textarea
      value={value}
      autoFocus
      rows={3}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onAbandon()
        }
        // Enter saves; Shift+Enter is the new line — the same in every note box. Blurring
        // the box is what commits it, so the save is one gesture whichever way it comes.
        if (commitsOnEnter(event)) {
          event.preventDefault()
          event.currentTarget.blur()
        }
      }}
      placeholder={placeholder}
      aria-label={t`Note text`}
      className="w-full resize-none rounded-md border border-input bg-raised px-2.5 py-1.5 text-[0.75rem] leading-[1.5] text-ink outline-none placeholder:text-faint focus-visible:border-accent-teal/50"
    />
  )
}

function Written({
  note,
  onEdit,
  onDelete,
}: {
  note: NoteResponse
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useLingui()
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-md bg-elevated px-2 py-1.5',
        note.source === 'mcp' && 'border-l-2 border-l-mistake',
      )}
    >
      <p className="whitespace-pre-wrap text-[0.75rem] leading-[1.55] text-body-2">{note.text}</p>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[0.625rem] text-faint">{relative(note.created_at)}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onEdit}
          aria-label={t`Edit this note`}
          className="px-0.5 text-faint hover:text-ink"
        >
          <Pencil className="size-3" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={t`Delete this note`}
          className="px-0.5 text-faint hover:text-blunder"
        >
          <Trash2 className="size-3" aria-hidden />
        </button>
      </div>
    </div>
  )
}

/**
 * The node's PGN comment. Its own box above the notes because it is a different kind of
 * thing: it belongs to the move, it is what the exported PGN carries in braces, and it is
 * the one of the two that a reader of the tree sees without opening anything.
 */
function CommentBox({
  node,
  pending,
  readOnly,
  onSave,
}: {
  node: CorrespondenceTreeNode
  pending: boolean
  /** A finished game's tree is locked: a write here would come back 409. */
  readOnly: boolean
  onSave: (comment: string) => void
}) {
  const { t } = useLingui()
  const [text, setText] = useState(node.comment)
  const [filledFor, setFilledFor] = useState(node.id)
  if (filledFor !== node.id) {
    setFilledFor(node.id)
    setText(node.comment)
  }
  const dirty = text.trim() !== node.comment.trim()

  // Finished means the tree is read-only, and the service answers a comment on it with a
  // 409 — so the box is not offered at all. What was written while the game ran still
  // reads, because it is part of the tree and of the exported PGN.
  if (readOnly) {
    if (!node.comment.trim()) return null
    return (
      <div className="flex flex-col gap-1 border-b border-hairline px-2.5 py-2">
        <span className="text-[0.625rem] tracking-[0.06em] text-faint uppercase">
          <Trans>Comment on the move</Trans>
        </span>
        <p className="whitespace-pre-wrap text-[0.71875rem] leading-[1.5] text-body-2">
          {node.comment}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 border-b border-hairline px-2.5 py-2">
      <span className="text-[0.625rem] tracking-[0.06em] text-faint uppercase">
        <Trans>Comment on the move</Trans>
      </span>
      <textarea
        value={text}
        rows={2}
        disabled={pending}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => dirty && onSave(text.trim())}
        onKeyDown={(event) => {
          if (commitsOnEnter(event)) {
            event.preventDefault()
            event.currentTarget.blur()
          }
        }}
        placeholder={t`Goes into the PGN beside the move. Enter saves, Shift+Enter breaks the line.`}
        aria-label={t`Comment on the move`}
        className="w-full resize-none rounded-md border border-input bg-raised px-2 py-1 text-[0.71875rem] leading-[1.5] text-ink outline-none placeholder:text-faint focus-visible:border-accent-teal/50"
      />
    </div>
  )
}

export function NotesPane({
  gameId,
  node,
  tab,
  onTabChange,
  onComment,
  commentPending,
  readOnly = false,
  book,
}: {
  gameId: number
  node: CorrespondenceTreeNode | null
  tab: NotesTab
  onTabChange: (tab: NotesTab) => void
  onComment: (nodeId: number, comment: string) => void
  commentPending: boolean
  /**
   * The game is finished, so the tree takes no more writes. Only the move comment is
   * gated: notes are the owner's own documents and stay writable on a game that is over,
   * which is most of what the notes on a correspondence game are for.
   */
  readOnly?: boolean
  /** The opening reference at this node. The Book tab appears only when one is given. */
  book?: ReactNode
}) {
  const { t } = useLingui()
  const fen = node?.fen ?? null
  const position = useNotes({ fen: fen ?? undefined, limit: LIMIT }, { enabled: fen !== null })
  const journal = useNotes({ game_id: gameId, scope: 'game', limit: LIMIT })
  const save = useSaveNote()
  const update = useUpdateNote()
  const remove = useDeleteNote()
  const [draft, setDraft] = useState<Draft>(null)

  const abandoned = useRef(false)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  // A tab change is not an abandonment, but a draft left open on the other tab would write
  // into whichever anchor is showing when it blurs — so it closes with the tab.
  useEffect(() => {
    abandoned.current = true
    setDraft(null)
  }, [tab, fen])

  const list = tab === 'position' ? position : journal
  const notes = list.data ?? []
  const error = save.error ?? update.error ?? remove.error ?? list.error

  function enqueue(write: () => Promise<unknown>) {
    queue.current = queue.current.then(write, write).catch(() => {})
  }

  function commit(box: NonNullable<Draft>) {
    setDraft(null)
    if (abandoned.current) {
      abandoned.current = false
      return
    }
    const text = box.text.trim()
    if (text === box.saved.trim() || text === '') return
    const id = box.id
    if (id !== null) {
      enqueue(() => update.mutateAsync({ id, body: { text } }))
      return
    }
    // A position note names the position and nothing else, exactly as the explorer's card
    // writes one: it is about the position, it resurfaces wherever that position does, and
    // giving it this game as well would file it under the journal too.
    enqueue(() =>
      save.mutateAsync(tab === 'position' ? { text, fen: fen ?? undefined } : { text, game_id: gameId }),
    )
  }

  const tabs: { key: NotesTab; label: string; count: number }[] = [
    { key: 'position', label: t`This position`, count: position.data?.length ?? 0 },
    { key: 'game', label: t`This game`, count: journal.data?.length ?? 0 },
    ...(book !== undefined ? [{ key: 'book' as const, label: t`Book`, count: 0 }] : []),
  ]

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-none items-center gap-1 border-b border-line bg-panel px-2">
        {tabs.map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-pressed={tab === entry.key}
            onClick={() => onTabChange(entry.key)}
            className={cn(
              'h-[2.1875rem] border-b-2 px-2 text-[0.6875rem] transition-colors',
              tab === entry.key
                ? 'border-b-accent-teal text-ink'
                : 'border-b-transparent text-dim hover:text-ink',
            )}
          >
            {entry.label}
            {entry.count > 0 ? (
              <span className="ml-1 font-mono text-[0.625rem] text-dim">{entry.count}</span>
            ) : null}
          </button>
        ))}
        <span className="flex-1" />
        {draft === null && tab !== 'book' ? (
          <button
            type="button"
            onClick={() => {
              abandoned.current = false
              setDraft({ id: null, text: '', saved: '' })
            }}
            className="rounded-md border border-edge px-2 py-px text-[0.625rem] text-soft hover:border-edge-hover hover:text-ink"
          >
            <Trans>Add note</Trans>
          </button>
        ) : null}
      </div>

      {tab === 'position' && node ? (
        <CommentBox
          node={node}
          pending={commentPending}
          readOnly={readOnly}
          onSave={(comment) => onComment(node.id, comment)}
        />
      ) : null}

      {tab === 'book' ? (
        <div className="flex min-h-0 flex-1 flex-col">{book}</div>
      ) : (
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2.5 py-2">
        {notes.map((note) =>
          draft?.id === note.id ? (
            <Composer
              key={note.id}
              value={draft.text}
              placeholder={t`Enter saves, Shift+Enter breaks the line.`}
              onChange={(text) => setDraft({ ...draft, text })}
              onCommit={() => commit(draft)}
              onAbandon={() => {
                abandoned.current = true
                setDraft(null)
              }}
            />
          ) : (
            <Written
              key={note.id}
              note={note}
              onEdit={() => {
                abandoned.current = false
                setDraft({ id: note.id, text: note.text, saved: note.text })
              }}
              onDelete={() => remove.mutate(note.id)}
            />
          ),
        )}
        {draft?.id === null ? (
          <Composer
            value={draft.text}
            placeholder={
              tab === 'position'
                ? t`What is worth remembering about this position?`
                : t`The plan, what this opponent tends to do, the deadline arithmetic.`
            }
            onChange={(text) => setDraft({ ...draft, text })}
            onCommit={() => commit(draft)}
            onAbandon={() => {
              abandoned.current = true
              setDraft(null)
            }}
          />
        ) : null}
        {notes.length === 0 && draft === null ? (
          <p className="py-2 text-[0.71875rem] text-dim">
            {tab === 'position' ? (
              <Trans>Nothing written about this position yet.</Trans>
            ) : (
              <Trans>Nothing written about this game yet.</Trans>
            )}
          </p>
        ) : null}
        {error ? <p className="text-[0.6875rem] text-blunder">{error.message}</p> : null}
      </div>
      )}
    </div>
  )
}

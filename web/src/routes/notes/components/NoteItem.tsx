/**
 * One note, in either of the two shapes this screen draws it in.
 *
 * **Stream** is a wide panel, two to a row: the position on the left, the words beside it,
 * everything about the note under them. It is the reading shape — full text, nothing
 * clipped, a column capped at a readable measure — and it is what the page opens in.
 *
 * **Sheet** is a tile: the position on top at full width, the words clamped under it. It is
 * the browsing shape, and it works because chess memory is visual — you find the note about
 * the Berlin by seeing the Berlin, which no amount of prose does as fast.
 *
 * One component rather than two because the two differ only in the arrangement of the same
 * parts and must never differ in anything else: the same provenance, the same tags, the same
 * editor, the same two-press delete. A note that could be rewritten in one view and not the
 * other would be a bug with a layout for a cause.
 *
 * **The foot is where the note came from and where else it applies**, which is the part a
 * note pinned to a *position* cannot do without. Such a note resurfaces wherever the owner
 * reaches that position again — in the explorer, in the repertoire, in a later game — and a
 * paragraph with no provenance is then a message from a stranger. So it says two things and
 * links both: the move and game it was written on (`gameHref`, which opens that game at that
 * move), and how many games in the library pass through the position (`explorerHref`, which
 * opens the explorer rooted there to show how they went). The variation a note hangs off
 * sits there too, for the same reason: it is about the note, not in it.
 *
 * A note written on a model game rather than one of the owner's says so beside its scope:
 * the same sentence means something different when the game is not theirs.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { Library, Network, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { MiniBoard } from '@/components/board/MiniBoard'
import { Badge } from '@/components/ui/badge'
import type { NoteResponse } from '@/lib/api/types'
import { relative } from '@/lib/mcp/status'
import { cn } from '@/lib/utils'

import {
  explorerHref,
  gameHref,
  gameLabel,
  lineText,
  originLabel,
  reachLabel,
  SCOPE_BADGES,
  scopeOf,
} from '../presentation'
import { DeleteConfirm, NoteEditor } from './NoteEditor'

const SOURCE_LABELS: Record<string, MessageDescriptor> = {
  mcp: msg`via MCP`,
  live: msg`from live`,
}

/**
 * The same two, as the hover says them. A whole sentence apiece rather than "written " with
 * the chip's words appended: the two halves do not necessarily stay in that order.
 */
const SOURCE_TITLES: Record<string, MessageDescriptor> = {
  mcp: msg`written via MCP`,
  live: msg`written from live`,
}

export type NoteLayout = 'stream' | 'sheet'

export interface NoteItemProps {
  note: NoteResponse
  layout: NoteLayout
  /** The note `/notes?note=12` asked for: ringed, and scrolled to on arrival. */
  highlighted?: boolean
  /** Every tag in use, for the editor's completion. */
  tagSuggestions?: string[]
  /** Clicking a tag chip filters the list by it. */
  onTagClick?: (tag: string) => void
}

export function NoteItem({
  note,
  layout,
  highlighted = false,
  tagSuggestions = [],
  onTagClick,
}: NoteItemProps) {
  const { t, i18n } = useLingui()
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const host = useRef<HTMLElement>(null)

  // The deep link lands on a page that is already scrolled wherever it was; the note it
  // named has to bring itself into view.
  useEffect(() => {
    if (highlighted) host.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlighted])

  const scope = scopeOf(note)
  const move = originLabel(note)
  const sheet = layout === 'sheet'
  // Named because the identifier is the placeholder a translator sees in "written {when}".
  const when = new Date(note.created_at).toLocaleString()

  const parts = {
    heads: (
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={scope === 'free' ? 'dashed' : 'default'}>{i18n._(SCOPE_BADGES[scope])}</Badge>
        {note.game?.is_owner_game === false ? (
          <Badge variant="dashed" title={t`Written on a model game, not one of yours`}>
            <Trans>model game</Trans>
          </Badge>
        ) : null}
        {note.source && SOURCE_LABELS[note.source] ? (
          <span
            className="text-[0.625rem] text-faint"
            title={i18n._(SOURCE_TITLES[note.source] ?? SOURCE_LABELS[note.source]!)}
          >
            {i18n._(SOURCE_LABELS[note.source]!)}
          </span>
        ) : null}
        <span className="flex-1" />
        <span
          className="font-mono text-[0.625rem] text-dim-2"
          title={t`written ${when}`}
        >
          {relative(note.created_at)}
        </span>
        {editing ? null : (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label={t`Rewrite this note`}
              title={t`Rewrite this note`}
              className="text-faint transition-colors hover:text-ink"
            >
              <Pencil className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setConfirming((was) => !was)}
              aria-label={t`Forget this note`}
              title={t`Forget this note`}
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
    ),

    body: editing ? (
      <NoteEditor note={note} tagSuggestions={tagSuggestions} onDone={() => setEditing(false)} />
    ) : (
      <p
        className={cn(
          'text-[0.78125rem] leading-[1.55] text-body-2',
          // Clamped in the sheet and never in the stream, and that is the trade the two
          // views are: a tile is a way in, a row is the place you read.
          sheet ? 'line-clamp-5 whitespace-pre-wrap' : 'whitespace-pre-wrap',
        )}
      >
        {note.text}
      </p>
    ),

    tags:
      !editing && note.tags.length ? (
        <div className="flex flex-wrap gap-1">
          {note.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onTagClick?.(tag)}
              disabled={!onTagClick}
              title={onTagClick ? t`Show only notes tagged ${tag}` : undefined}
              className="rounded-sm border border-edge bg-elevated px-1.5 py-px text-[0.625rem] text-soft transition-colors enabled:hover:border-accent-teal/40 enabled:hover:text-accent-teal"
            >
              {tag}
            </button>
          ))}
        </div>
      ) : null,

    foot: <Provenance note={note} move={move} />,

    confirm: confirming ? (
      <DeleteConfirm noteId={note.id} onCancel={() => setConfirming(false)} />
    ) : null,
  }

  const board = note.fen ? (
    <MiniBoard
      fen={note.fen}
      label={move ? t`The position at ${move}` : t`The position this note is about`}
      // `MiniBoard` sets its width inline, so the responsive case has to be part of the
      // value rather than a class over it. In the sheet the board is the tile's whole width
      // and the width comes from the grid, so it is handed 100%.
      size={sheet ? '100%' : 'min(11rem, 24vw)'}
    />
  ) : sheet ? (
    // A tile with no position would otherwise be a hole in the pattern. It says what it is
    // instead, which is also the only honest thing to draw: some notes are about no board.
    <div className="grid aspect-square place-items-center rounded-md border border-dashed border-edge bg-elevated/40 text-[0.6875rem] text-faint">
      <Trans>no position</Trans>
    </div>
  ) : null

  if (sheet) {
    return (
      <article
        ref={host}
        data-note-id={note.id}
        className={cn(
          'flex flex-col gap-2 rounded-lg border bg-panel p-2.5 transition-shadow',
          highlighted
            ? 'border-accent-teal/45 shadow-[0_0_0_0.0625rem_var(--bb-accent)]'
            : 'border-line',
        )}
      >
        {board}
        {parts.heads}
        {parts.body}
        {parts.tags}
        {parts.foot}
        {parts.confirm}
      </article>
    )
  }

  return (
    <article
      ref={host}
      data-note-id={note.id}
      className={cn(
        // Bounded on all four sides rather than ruled off underneath, because the stream
        // runs two to a row: notes of different lengths sitting side by side put a bottom
        // rule at two different heights, which reads as the ragged grid this screen was
        // reworked to get rid of. The panel is the same one the sheet's tiles wear — the
        // two views are one object in two arrangements, not two objects.
        'flex gap-3 rounded-lg border bg-panel px-3 py-2.5 transition-shadow',
        highlighted
          ? 'border-accent-teal/45 shadow-[0_0_0_0.0625rem_var(--bb-accent)]'
          : 'border-line',
      )}
    >
      {board}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {parts.heads}
        {parts.body}
        {parts.tags}
        {parts.foot}
        {parts.confirm}
      </div>
    </article>
  )
}

/**
 * Everything about the note rather than in it — the variation it hangs off, where it was
 * written, where else the position applies — under one hairline at the foot.
 *
 * Below the words rather than above them, and ruled off from them, because the words are
 * what somebody came to the note to read and metadata stacked over them buries the first
 * line under four bands of small grey type. Drawn while the note is being rewritten as
 * well: where a note came from does not change when its text does, and a row that
 * disappears under the editor takes the reader's place with it.
 */
function Provenance({ note, move }: { note: NoteResponse; move: string | null }) {
  const { t } = useLingui()
  const origin = gameHref(note)
  const from = typeof note.game_id === 'number' ? gameLabel(note.game, note.game_id) : null
  const explorer = explorerHref(note.fen)
  const reach = reachLabel(note)
  const line = note.line ? lineText(note.line) : null

  if (!line && !origin && !explorer) return null

  return (
    <div className="flex flex-col gap-1 border-t border-line pt-1.5 text-[0.6875rem]">
      {line ? (
        <p className="truncate font-mono text-soft-2" title={line}>
          {line}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {origin ? (
          <Link
            to={origin}
            title={move ? t`Open ${from} at ${move}` : t`Open ${from}`}
            className="flex min-w-0 items-center gap-1.5 text-dim transition-colors hover:text-accent-teal"
          >
            <Library className="size-3 flex-none" aria-hidden />
            <span className="truncate">
              {move ? (
                <Trans>
                  Written on <span className="font-mono tabular text-soft-2">{move}</span> in {from}
                </Trans>
              ) : (
                <Trans>Written in {from}</Trans>
              )}
            </span>
          </Link>
        ) : null}
        {explorer ? (
          <Link
            to={explorer}
            title={t`Open this position in the opening explorer`}
            className="flex flex-none items-center gap-1.5 text-dim transition-colors hover:text-accent-teal"
          >
            <Network className="size-3" aria-hidden />
            {reach ?? t`In the opening explorer`}
          </Link>
        ) : null}
      </div>
    </div>
  )
}

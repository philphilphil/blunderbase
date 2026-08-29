/**
 * "Worth another look" — the top of the notes screen.
 *
 * `GET /notes/resurface` answers two different things at once and says which is which: a
 * note whose position turned up again in a game imported this month (with the games it
 * turned up in), and a note nobody has touched in three weeks. The first is the useful
 * one and is why the section exists — a note about a position you keep reaching is a
 * lesson you keep not learning.
 */
import { History, Repeat } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { useResurfacedNotes } from '@/lib/api/queries'
import type { ResurfaceItem } from '@/lib/api/types'
import { relative } from '@/lib/mcp/status'
import { cn } from '@/lib/utils'

import { noteHref, notePlyLabel, oneLine } from '../grouping'

/** Enough to be a prompt, not enough to be a second list. */
const LIMIT = 6

export interface ResurfacedNotesProps {
  /** The note the page is highlighting, so the row that points at it reads as current. */
  highlighted?: number | null
  /** Ask the page to highlight and scroll to a note it is already showing. */
  onHighlight: (id: number) => void
}

export function ResurfacedNotes({ highlighted = null, onHighlight }: ResurfacedNotesProps) {
  const resurfaced = useResurfacedNotes(LIMIT)
  const items = resurfaced.data?.items ?? []
  if (items.length === 0) return null

  return (
    <section className="flex flex-col gap-1.5 rounded-xl border border-line border-l-2 border-l-mistake bg-panel p-3">
      <div className="flex items-center gap-2">
        <span className="text-[0.75rem] font-semibold text-ink">Worth another look</span>
        <Badge variant="warn">{items.length}</Badge>
        <span className="flex-1" />
        <span className="text-[0.625rem] text-dim">
          positions that came back, and notes gone quiet
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <Row
            key={item.note.id}
            item={item}
            current={highlighted === item.note.id}
            onHighlight={onHighlight}
          />
        ))}
      </ul>
    </section>
  )
}

function Row({
  item,
  current,
  onHighlight,
}: {
  item: ResurfaceItem
  current: boolean
  onHighlight: (id: number) => void
}) {
  const { note, reason, games } = item
  const recurred = reason === 'recurred'
  const Icon = recurred ? Repeat : History
  const ply = notePlyLabel(note.ply)

  return (
    <li
      className={cn(
        // Five things on one line is a desktop row; below `md` the meta wraps under the
        // note, and the note keeps most of the first line so it is still worth reading.
        'flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors max-md:flex-wrap max-md:gap-y-1 max-md:py-1.5',
        current ? 'bg-raised' : 'hover:bg-raised/60',
      )}
    >
      <Icon
        className={cn('size-3.5 flex-none', recurred ? 'text-mistake' : 'text-faint')}
        aria-hidden
      />
      <button
        type="button"
        onClick={() => onHighlight(note.id)}
        title={recurred ? 'This position came back in a recent game' : 'Untouched for weeks'}
        className="min-w-0 flex-1 truncate text-left text-[0.75rem] text-body-2 transition-colors hover:text-ink max-md:min-w-[60%]"
      >
        {oneLine(note)}
      </button>
      {ply ? (
        <span className="flex-none font-mono text-[0.625rem] tabular text-dim-2">{ply}</span>
      ) : null}
      {recurred && games.length ? (
        <span className="flex flex-none items-center gap-1 text-[0.625rem] text-dim">
          seen in
          {games.slice(0, 3).map((gameId) => (
            <Link
              key={gameId}
              to={`/games/${gameId}`}
              className="font-mono text-accent-teal transition-colors hover:text-accent-link"
            >
              #{gameId}
            </Link>
          ))}
          {games.length > 3 ? <span>+{games.length - 3}</span> : null}
        </span>
      ) : (
        <span className="flex-none font-mono text-[0.625rem] text-dim-2">
          {relative(note.updated_at)}
        </span>
      )}
      {typeof note.game_id === 'number' ? (
        <Link
          to={noteHref(note)}
          className="flex-none text-[0.625rem] text-faint transition-colors hover:text-accent-teal"
        >
          open
        </Link>
      ) : null}
    </li>
  )
}

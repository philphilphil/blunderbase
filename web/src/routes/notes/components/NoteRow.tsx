/**
 * One note as one line — the list view.
 *
 * The stream is for reading and the sheet for finding a note by its position; the list is
 * for finding it by *where it came from*. So a row spends its width on provenance and gives
 * the words one clipped line: when it was written, what it is about and the move, then the
 * game it was written on — who the opponent was, how it went, when it was played — and the
 * tags. Scanning a column of opponents is how "what did I write after losing to him?" gets
 * answered, which neither of the other views can do at a glance.
 *
 * **A row opens in place** into the whole note, drawn by `NoteItem` in the stream's shape,
 * because a view you can only read from is a view you leave (see `NotesPage`): rewriting and
 * forgetting happen in the note, not in a second set of controls on the row. The note a link
 * named arrives open.
 *
 * The opponent and the tags are buttons that narrow the list, the same as a tag chip does
 * in the other two views — a row is where you notice the name, so it is where you click it.
 *
 * The columns are one template (`LIST_COLUMNS`) shared by the header and every row, which is
 * what keeps them aligned across the date rules that split the list into sections. Below
 * `md` there is no table to align: a row wraps into the note's line and one line of what
 * matters about it under it.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { ArrowUpRight, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import type { NoteResponse } from '@/lib/api/types'
import { relative } from '@/lib/mcp/status'
import { cn } from '@/lib/utils'
import { formatGameDate, formatResult, outcomeTone } from '@/routes/games/format'

import { gameLabel, noteHref, oneLine, originLabel, SCOPE_BADGES, scopeOf } from '../presentation'
import { NoteItem } from './NoteItem'

/**
 * Written · note · about · opponent · result · played · tags · open. Played and tags come in
 * at `xl`, where there is room for them without squeezing the note's line to nothing.
 */
export const LIST_COLUMNS =
  'md:grid md:items-center md:gap-x-3 ' +
  'md:grid-cols-[4.5rem_minmax(0,1fr)_10rem_minmax(0,11rem)_2.75rem_1.25rem] ' +
  'xl:grid-cols-[4.5rem_minmax(0,1fr)_10rem_minmax(0,11rem)_2.75rem_4.5rem_minmax(0,9rem)_1.25rem]'

const HEAD = 'text-meta tracking-[0.06em] text-dim-2 uppercase'

/**
 * The column names, once over the whole list. Nothing to align below `md`, so nothing drawn.
 *
 * Held to the panels' own box — the same cap, and a transparent border where theirs is
 * drawn — because the note column is `1fr`: a header even a pixel wider than the rows
 * shifts every column right of it.
 */
export function NoteListHeader() {
  return (
    <div
      className={cn(LIST_COLUMNS, 'max-w-[93rem] border-x border-transparent px-3 pb-0.5 max-md:hidden')}
      aria-hidden
    >
      <span className={HEAD}>
        <Trans>Written</Trans>
      </span>
      <span className={HEAD}>
        <Trans>Note</Trans>
      </span>
      <span className={HEAD}>
        <Trans>About</Trans>
      </span>
      <span className={HEAD}>
        <Trans>Opponent</Trans>
      </span>
      <span className={cn(HEAD, 'text-center')}>
        <Trans>Res</Trans>
      </span>
      <span className={cn(HEAD, 'max-xl:hidden')}>
        <Trans>Played</Trans>
      </span>
      <span className={cn(HEAD, 'max-xl:hidden')}>
        <Trans>Tags</Trans>
      </span>
      <span />
    </div>
  )
}

export interface NoteRowProps {
  note: NoteResponse
  /** The note `/notes?note=12` asked for: opened, and ringed by the note it opens into. */
  highlighted?: boolean
  tagSuggestions?: string[]
  onTagClick?: (tag: string) => void
  /** Clicking the opponent narrows the list to notes on games against them. */
  onOpponentClick?: (name: string) => void
}

export function NoteRow({
  note,
  highlighted = false,
  tagSuggestions = [],
  onTagClick,
  onOpponentClick,
}: NoteRowProps) {
  const { t, i18n } = useLingui()
  const [open, setOpen] = useState(highlighted)
  // And opens when a link names it later, too: ⌘K or a row's ↗ on a note with no game goes
  // to `/notes?note=12` without remounting the rows, so the first render is not the only
  // time a row can become the one asked for.
  const [wasHighlighted, setWasHighlighted] = useState(highlighted)
  if (highlighted !== wasHighlighted) {
    setWasHighlighted(highlighted)
    if (highlighted) setOpen(true)
  }

  const scope = scopeOf(note)
  const move = originLabel(note)
  const game = note.game
  const when = new Date(note.created_at).toLocaleString()
  const line = oneLine(note, 400)

  return (
    <li data-note-row={note.id} className="border-b border-line last:border-b-0">
      <div
        className={cn(
          LIST_COLUMNS,
          'flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 text-data transition-colors hover:bg-raised',
          open && 'bg-raised/40',
        )}
      >
        <span
          className="font-mono text-meta text-dim-2 max-md:order-last max-md:ml-auto"
          title={t`written ${when}`}
        >
          {relative(note.created_at)}
        </span>

        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
          title={open ? t`Close this note` : t`Open this note`}
          className="flex min-w-0 items-center gap-1 text-left text-body-2 transition-colors hover:text-ink max-md:order-first max-md:basis-full"
        >
          <ChevronRight
            className={cn('size-3 flex-none text-faint transition-transform', open && 'rotate-90')}
            aria-hidden
          />
          <span className="truncate">{line}</span>
        </button>

        <span className="flex min-w-0 items-center gap-1.5">
          <Badge variant={scope === 'free' ? 'dashed' : 'default'}>
            {i18n._(SCOPE_BADGES[scope])}
          </Badge>
          {move ? (
            <span className="truncate font-mono text-label tabular text-soft-2">{move}</span>
          ) : null}
        </span>

        <span className="flex min-w-0 items-center gap-1.5">
          {game?.opponent ? (
            <button
              type="button"
              onClick={() => onOpponentClick?.(game.opponent!)}
              disabled={!onOpponentClick}
              title={t`Show only notes on games against ${game.opponent}`}
              className="min-w-0 truncate text-soft transition-colors enabled:hover:text-accent-teal"
            >
              {game.opponent}
            </button>
          ) : typeof note.game_id === 'number' ? (
            // A model game has no opponent: it is somebody else's game, so it is named by
            // both of its players, the way the library names one.
            <span className="truncate text-dim" title={t`Written on a model game, not one of yours`}>
              {gameLabel(game, note.game_id)}
            </span>
          ) : (
            <span className="text-faint max-md:hidden">—</span>
          )}
          {typeof game?.opponent_rating === 'number' ? (
            <span className="flex-none font-mono text-meta tabular text-dim-2">
              {game.opponent_rating}
            </span>
          ) : null}
        </span>

        <span
          className={cn(
            'font-mono font-semibold tabular md:text-center',
            game ? outcomeTone(game.outcome) : 'text-faint max-md:hidden',
          )}
        >
          {game ? formatResult(game.result) : '—'}
        </span>

        <span className="font-mono text-label tabular text-dim max-xl:hidden">
          {game ? formatGameDate(game.date) : '—'}
        </span>

        <span className="flex min-w-0 gap-1 overflow-hidden max-xl:hidden">
          {note.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onTagClick?.(tag)}
              disabled={!onTagClick}
              title={onTagClick ? t`Show only notes tagged ${tag}` : undefined}
              className="flex-none rounded-sm border border-edge bg-elevated px-1.5 py-px text-meta text-soft transition-colors enabled:hover:bg-raised enabled:hover:text-ink"
            >
              {tag}
            </button>
          ))}
        </span>

        <Link
          to={noteHref(note)}
          aria-label={t`Open where this note was written`}
          title={t`Open where this note was written`}
          className="text-faint transition-colors hover:text-accent-teal max-md:hidden"
        >
          <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      </div>

      {open ? (
        <div className="px-3 pt-0.5 pb-2.5 md:pl-[5.75rem]">
          <NoteItem
            note={note}
            layout="stream"
            highlighted={highlighted}
            tagSuggestions={tagSuggestions}
            onTagClick={onTagClick}
          />
        </div>
      ) : null}
    </li>
  )
}

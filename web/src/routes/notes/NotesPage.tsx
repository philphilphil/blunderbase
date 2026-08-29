/**
 * `/notes` — everything written down, in one place.
 *
 * The screen the coach's memory needs and the game page cannot be: notes are written
 * against a game, a variation, a bare position or nothing at all, and the ones that matter
 * most are the ones about a position you keep reaching. So the top of the page is
 * `GET /notes/resurface` (why you should read anything at all today) and the body is the
 * filtered list, grouped by game, with the loose notes last.
 *
 * Filters live in the URL, like the library's, so a cut of the notes is a link — and so is
 * one note: `/notes?note=12` is where the command palette sends a note that has no game to
 * open, and the card rings itself and scrolls into view.
 */
import { Download, FileText, Loader2, StickyNote } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { saveDownload } from '@/lib/api/client'
import { useExportNotes, useNote, useNoteTags, useNotes } from '@/lib/api/queries'
import type { NoteExportFormat } from '@/lib/api/types'

import { NoteCard } from './components/NoteCard'
import { NoteFilterBar } from './components/NoteFilterBar'
import { ResurfacedNotes } from './components/ResurfacedNotes'
import {
  filterCount,
  filtersFromParams,
  paramsFromFilters,
  toNoteExportQuery,
  toNoteQuery,
  type NoteFilters,
} from './filters'
import { countNotes, groupNotes } from './grouping'

/** One page of notes. The backend caps a page at 200; this is what the screen can be read at. */
const LIMIT = 120

export function NotesPage() {
  const [params, setParams] = useSearchParams()

  const filters = useMemo(() => filtersFromParams(params), [params])
  const highlighted = Number(params.get('note')) || null

  const notes = useNotes(toNoteQuery(filters, LIMIT))
  const tags = useNoteTags()
  const groups = useMemo(() => groupNotes(notes.data ?? []), [notes.data])
  const total = countNotes(groups)

  // The note a link named may well be outside the current cut — a position note reached
  // from the palette while the list is filtered to one game. It is then shown on its own
  // above the list rather than silently not being there.
  const listed = useMemo(
    () => (notes.data ?? []).some((note) => note.id === highlighted),
    [notes.data, highlighted],
  )
  const linked = useNote(highlighted ?? 0, {
    enabled: highlighted !== null && !listed && notes.isSuccess,
  })

  const setFilters = useCallback(
    (next: NoteFilters) => {
      setParams(paramsFromFilters(next, { note: highlighted }), { replace: true })
    },
    [setParams, highlighted],
  )

  const highlight = useCallback(
    (id: number) => {
      setParams(paramsFromFilters(filters, { note: id }), { replace: true })
    },
    [setParams, filters],
  )

  const suggestions = useMemo(() => (tags.data ?? []).map((row) => row.tag), [tags.data])
  const addTag = useCallback(
    (tag: string) => {
      const current = filters.tags ?? []
      if (current.includes(tag)) return
      setFilters({ ...filters, tags: [...current, tag] })
    },
    [filters, setFilters],
  )

  return (
    <PageBody>
      <SetPageChrome breadcrumb={[{ label: 'Notes' }]} />

      <PageHeader
        title="Notes"
        description={
          notes.isSuccess
            ? total === 0
              ? filterCount(filters) > 0
                ? 'Nothing written matches that.'
                : 'Nothing written down yet.'
              : `${total} note${total === 1 ? '' : 's'}${total === LIMIT ? ' (the newest page)' : ''}`
            : 'What you and the coach have written down.'
        }
        actions={<ExportButtons filters={filters} disabled={total === 0} />}
      />

      <NoteFilterBar filters={filters} onChange={setFilters} />

      <ResurfacedNotes highlighted={highlighted} onHighlight={highlight} />

      {notes.isPending ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-[6.5rem] w-full rounded-lg" />
          ))}
        </div>
      ) : notes.isError ? (
        <div className="rounded-xl border border-blunder/28 bg-blunder/5 px-4 py-5">
          <p className="text-[0.78125rem] text-blunder">The notes could not be read.</p>
          <p className="mt-1 font-mono text-[0.6875rem] text-blunder/80">{notes.error.message}</p>
        </div>
      ) : (
        <>
          {linked.data ? (
            <section className="flex flex-col gap-1.5">
              <GroupHeading title="The note you followed" subtitle="outside the filters below" />
              <NoteCard
                note={linked.data}
                highlighted
                tagSuggestions={suggestions}
                onTagClick={addTag}
              />
            </section>
          ) : null}

          {groups.length === 0 ? <Empty filtered={filterCount(filters) > 0} /> : null}

          {groups.map((group) => (
            <section key={group.key} className="flex flex-col gap-1.5">
              <GroupHeading
                title={group.title}
                subtitle={group.subtitle}
                href={group.href}
                count={group.notes.length}
              />
              {group.notes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  highlighted={note.id === highlighted}
                  tagSuggestions={suggestions}
                  onTagClick={addTag}
                />
              ))}
            </section>
          ))}
        </>
      )}
    </PageBody>
  )
}

function GroupHeading({
  title,
  subtitle,
  href,
  count,
}: {
  title: string
  subtitle?: string | null
  href?: string | null
  count?: number
}) {
  return (
    // Two long usernames and a result do not share a phone's line; the result and date go
    // under them rather than squeezing the names into one word each.
    <div className="flex items-baseline gap-2 pt-1 max-md:flex-wrap max-md:gap-y-0.5">
      {href ? (
        <Link
          to={href}
          className="text-[0.78125rem] font-semibold text-ink transition-colors hover:text-accent-teal"
        >
          {title}
        </Link>
      ) : (
        <span className="text-[0.78125rem] font-semibold text-ink">{title}</span>
      )}
      {subtitle ? (
        <span className="font-mono text-[0.6875rem] text-dim-2">{subtitle}</span>
      ) : null}
      <span className="flex-1" />
      {count === undefined ? null : (
        <span className="font-mono text-[0.625rem] tabular text-dim-2">{count}</span>
      )}
    </div>
  )
}

function Empty({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-edge-strong bg-panel/60 p-10 text-center max-md:p-6">
      <StickyNote className="size-5 text-faint" aria-hidden />
      <p className="max-w-md text-[0.78125rem] leading-relaxed text-dim">
        {filtered
          ? 'No note matches those filters. Clear one and try again.'
          : 'Nothing here yet. Write a note from a game, or ask your assistant to — anything it saves over MCP lands on this page.'}
      </p>
    </div>
  )
}

/**
 * Markdown for a person, PGN for a board program — both over exactly the filters on
 * screen, so what is exported is what is being read.
 */
function ExportButtons({ filters, disabled }: { filters: NoteFilters; disabled: boolean }) {
  const exporting = useExportNotes({ onSuccess: (download) => saveDownload(download) })
  const pending = exporting.isPending ? exporting.variables?.format : undefined

  const run = (format: NoteExportFormat) => {
    exporting.mutate({ format, query: toNoteExportQuery(filters) })
  }

  return (
    <div className="flex items-center gap-1.5 max-md:flex-wrap max-md:gap-y-1">
      {exporting.isError ? (
        <span className="max-w-[16rem] truncate text-[0.6875rem] text-blunder max-md:max-w-full max-md:basis-full">
          {exporting.error.message}
        </span>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || exporting.isPending}
        onClick={() => run('md')}
        title="Every note these filters show, as Markdown"
      >
        {pending === 'md' ? (
          <Loader2 className="size-3 animate-spin" aria-hidden />
        ) : (
          <FileText className="size-3" aria-hidden />
        )}
        Markdown
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || exporting.isPending}
        onClick={() => run('pgn')}
        title="The same notes as PGN comments and variations"
      >
        {pending === 'pgn' ? (
          <Loader2 className="size-3 animate-spin" aria-hidden />
        ) : (
          <Download className="size-3" aria-hidden />
        )}
        PGN
      </Button>
    </div>
  )
}

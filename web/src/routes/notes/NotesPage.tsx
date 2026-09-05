/**
 * `/notes` — everything written down, in one place.
 *
 * The screen the coach's memory needs and the game page cannot be: notes are written
 * against a game, a variation, a bare position or nothing at all.
 *
 * **The list is flat** (owner's call, 2026-09-02, after `docs/design/prototypes/notes-screen.html`).
 * It used to be grouped by game, and that was the wrong axis three ways over: a game is
 * where a note was *written* rather than what it is about, `/games` is already the index of
 * games, and the notes that carry the most — the ones pinned to a position, which resurface
 * in every game that reaches them — were swept into a leftovers bin at the bottom. It was
 * also what made the columns look broken: a heading forces a row break, and at 1.5 notes
 * per noted game most rows were two-thirds hole.
 *
 * What orders it now is time, cut by `ageBuckets` into rules that cost a line rather than a
 * row. Nothing is re-sorted here — the API answers newest-first and the rules follow it.
 *
 * **Two views, and the reader picks.** *Stream* is two notes to a row, board beside the
 * words, with the whole of every note and no clipping; *Sheet* is a denser grid of tiles,
 * board on top, text clamped, for finding a note by seeing its position. Both are the same notes under the same filters and
 * both can rewrite and forget one — a view you can only read from is a view you leave. Which
 * is showing is a per-browser preference (`viewMode.ts`), not a URL parameter: it is how
 * somebody reads, not which notes they are looking at, so a shared link arrives in the
 * recipient's own shape.
 *
 * Filters live in the URL, like the library's, so a cut of the notes is a link — and so is
 * one note: `/notes?note=12` is where the command palette sends a note that has no game to
 * open, and it rings itself and scrolls into view.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg, plural } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { Download, FileText, LayoutGrid, Loader2, Rows3, StickyNote } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { saveDownload } from '@/lib/api/client'
import { useExportNotes, useNote, useNoteTags, useNotes } from '@/lib/api/queries'
import type { NoteExportFormat, NoteResponse } from '@/lib/api/types'
import { cn } from '@/lib/utils'

import { NoteFilterBar } from './components/NoteFilterBar'
import { NoteItem } from './components/NoteItem'
import {
  filterCount,
  filtersFromParams,
  paramsFromFilters,
  toNoteExportQuery,
  toNoteQuery,
  type NoteFilters,
} from './filters'
import { ageBuckets } from './presentation'
import { setNoteView, useNoteView, type NoteView } from './viewMode'

/** One page of notes. The backend caps a page at 200; this is what the screen can be read at. */
const LIMIT = 120

/**
 * The stream: two notes to a row above `lg`, one below it.
 *
 * The cap is on the *column*, not on the page. 46rem is about ninety characters at the
 * app's scale — the outside of comfortable, and enough to leave the board beside the words
 * room to be 176px — so one column stops there and two stop at twice that plus the gap.
 * Widening the column instead of adding a second is what produced the sentence a head-turn
 * wide that started this rework; adding a second column spends a wide monitor without
 * spending it on line length.
 *
 * `items-start` rather than stretched rows: notes are honestly different lengths, and a
 * short one padded out to match the paragraph beside it is the dead space that made the old
 * grid look wrong.
 */
const STREAM = 'grid items-start gap-2.5 max-w-[46rem] lg:max-w-[93rem] lg:grid-cols-2'

/**
 * The sheet's columns. Sized so a tile holds a board at a legible size with four or five
 * lines of text under it, and so nothing is left alone in a row at the widths the app is
 * actually read at.
 */
const SHEET = 'grid items-start gap-2.5 sm:grid-cols-2 xl:grid-cols-3 min-[110rem]:grid-cols-4'

export function NotesPage() {
  const { t } = useLingui()
  const [params, setParams] = useSearchParams()

  const filters = useMemo(() => filtersFromParams(params), [params])
  const highlighted = Number(params.get('note')) || null

  const view = useNoteView()
  const notes = useNotes(toNoteQuery(filters, LIMIT))
  const tags = useNoteTags()
  const rows = useMemo<NoteResponse[]>(() => notes.data ?? [], [notes.data])
  const buckets = useMemo(() => ageBuckets(rows), [rows])
  const total = rows.length

  // The note a link named may well be outside the current cut — a position note reached
  // from the palette while the list is filtered to one game. It is then shown on its own
  // above the list rather than silently not being there.
  const listed = useMemo(() => rows.some((note) => note.id === highlighted), [rows, highlighted])
  const linked = useNote(highlighted ?? 0, {
    enabled: highlighted !== null && !listed && notes.isSuccess,
  })

  const setFilters = useCallback(
    (next: NoteFilters) => {
      setParams(paramsFromFilters(next, { note: highlighted }), { replace: true })
    },
    [setParams, highlighted],
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

  const list = view === 'sheet' ? SHEET : STREAM

  // A full page is worth saying so, and it is one sentence rather than a count with a
  // parenthesis appended: the two are different things to translate.
  const counted =
    total === LIMIT
      ? t`${plural(total, { one: '# note', other: '# notes' })} (the newest page)`
      : t`${plural(total, { one: '# note', other: '# notes' })}`

  return (
    <PageBody>
      <SetPageChrome breadcrumb={[{ label: t`Notes` }]} />

      <PageHeader
        title={t`Notes`}
        description={
          notes.isSuccess
            ? total === 0
              ? filterCount(filters) > 0
                ? t`Nothing written matches that.`
                : t`Nothing written down yet.`
              : counted
            : t`What you and the coach have written down.`
        }
        actions={<ExportButtons filters={filters} disabled={total === 0} />}
      />

      {/*
        The view selector leads the filter row rather than sitting in the header's actions:
        it belongs to the list under it, not to the page's verbs. `basis-[20rem]` on the bar
        is what makes that behave on a phone — there is no room for a 20rem filter bar beside
        the selector on a 375px screen, so the bar takes the next line whole.
      */}
      <div data-tour="notes" className="flex flex-wrap items-center gap-2">
        <ViewToggle view={view} />
        <NoteFilterBar
          filters={filters}
          onChange={setFilters}
          className="min-w-0 flex-1 basis-[20rem]"
        />
      </div>

      {notes.isPending ? (
        <div className={list}>
          {[0, 1, 2, 3, 4, 5].map((cell) => (
            <Skeleton
              key={cell}
              className={cn('w-full rounded-lg', view === 'sheet' ? 'h-[15rem]' : 'h-[9rem]')}
            />
          ))}
        </div>
      ) : notes.isError ? (
        <div className="rounded-xl border border-blunder/28 bg-blunder/5 px-4 py-5">
          <p className="text-[0.78125rem] text-blunder">
            <Trans>The notes could not be read.</Trans>
          </p>
          <p className="mt-1 font-mono text-[0.6875rem] text-blunder/80">{notes.error.message}</p>
        </div>
      ) : (
        <>
          {/*
            The note a link named, when the filters do not show it. Drawn in whichever view
            is open, so following a link does not also change the shape of the page.
          */}
          {linked.data ? (
            <section className="flex flex-col gap-1.5">
              <DateRule label={t`The note you followed`} note={t`outside the filters below`} />
              <div className={list}>
                <NoteItem
                  note={linked.data}
                  layout={view}
                  highlighted
                  tagSuggestions={suggestions}
                  onTagClick={addTag}
                />
              </div>
            </section>
          ) : null}

          {total === 0 ? <Empty filtered={filterCount(filters) > 0} /> : null}

          {buckets.map((bucket) => (
            <section key={bucket.key} className="flex flex-col gap-1.5">
              <DateRule label={bucket.label} count={bucket.notes.length} />
              <div className={list}>
                {bucket.notes.map((note) => (
                  <NoteItem
                    key={note.id}
                    note={note}
                    layout={view}
                    highlighted={note.id === highlighted}
                    tagSuggestions={suggestions}
                    onTagClick={addTag}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </PageBody>
  )
}

const VIEWS: {
  id: NoteView
  label: MessageDescriptor
  icon: typeof Rows3
  hint: MessageDescriptor
}[] = [
  { id: 'stream', label: msg`Stream`, icon: Rows3, hint: msg`One column, every note in full` },
  {
    id: 'sheet',
    label: msg`Sheet`,
    icon: LayoutGrid,
    hint: msg`A grid of positions, text clamped`,
  },
]

/**
 * Stream or sheet, as one segmented control rather than two buttons.
 *
 * A pair of radios in `aria` terms, because that is what it is: two mutually exclusive ways
 * of showing one list, one of which is always on. Labels are hidden below `sm` — the icons
 * carry it on a phone, where the row is already tight.
 */
function ViewToggle({ view }: { view: NoteView }) {
  const { t, i18n } = useLingui()
  return (
    <div
      role="radiogroup"
      aria-label={t`How to show the notes`}
      className="flex items-center rounded-md border border-edge bg-elevated p-px"
    >
      {VIEWS.map((option) => {
        const on = view === option.id
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={on}
            title={i18n._(option.hint)}
            onClick={() => setNoteView(option.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-[0.3125rem] px-2 py-[0.1875rem] text-[0.6875rem] transition-colors',
              on ? 'bg-raised-2 text-ink' : 'text-dim hover:text-soft',
            )}
          >
            <option.icon className="size-3.5" aria-hidden />
            <span className="max-sm:sr-only">{i18n._(option.label)}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * A date rule: the label, a hairline to the end of the row, and the count.
 *
 * A rule rather than a heading, and that is the whole point of it — this is what replaced
 * the game headings. It sits on one line, spans whatever the list is, and cannot break a
 * grid row, because it is not in the grid.
 */
function DateRule({ label, note, count }: { label: string; note?: string; count?: number }) {
  return (
    <div className="flex items-center gap-2.5 pt-1">
      <span className="font-mono text-[0.6875rem] tracking-[0.08em] text-dim-2 uppercase">
        {label}
      </span>
      {note ? <span className="text-[0.6875rem] text-faint">{note}</span> : null}
      <span className="h-px flex-1 bg-hairline" />
      {count === undefined ? null : (
        <span className="font-mono text-[0.625rem] tabular text-faint">{count}</span>
      )}
    </div>
  )
}

function Empty({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-edge-strong bg-panel/60 p-10 text-center max-md:p-6">
      <StickyNote className="size-5 text-faint" aria-hidden />
      <p className="max-w-md text-[0.78125rem] leading-relaxed text-dim">
        {filtered ? (
          <Trans>No note matches those filters. Clear one and try again.</Trans>
        ) : (
          <Trans>
            Nothing here yet. Write a note from a game, or ask your assistant to — anything
            it saves over MCP lands on this page.
          </Trans>
        )}
      </p>
    </div>
  )
}

/**
 * Markdown for a person, PGN for a board program — both over exactly the filters on
 * screen, so what is exported is what is being read.
 */
function ExportButtons({ filters, disabled }: { filters: NoteFilters; disabled: boolean }) {
  const { t } = useLingui()
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
        title={t`Every note these filters show, as Markdown`}
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
        title={t`The same notes as PGN comments and variations`}
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

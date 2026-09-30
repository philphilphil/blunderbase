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
 * **Three views, and the reader picks.** *Stream* is two notes to a row, board beside the
 * words, with the whole of every note and no clipping; *Sheet* is a denser grid of tiles,
 * board on top, text clamped, for finding a note by seeing its position; *List* is one line
 * per note with where it came from beside it — the move, the opponent, how the game went —
 * for finding a note by its game (`NoteRow`). All three are the same notes under the same
 * filters and all three can rewrite and forget one — a view you can only read from is a
 * view you leave; a list row opens in place into the whole note for that. Which
 * is showing is a per-browser preference (`viewMode.ts`), not a URL parameter: it is how
 * somebody reads, not which notes they are looking at, so a shared link arrives in the
 * recipient's own shape.
 *
 * Filters live in the URL, like the library's, so a cut of the notes is a link — and so is
 * one note: `/notes?note=12` is where the command palette sends a note that has no game to
 * open, and it rings itself and scrolls into view.
 */
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { Download, FileDown, FileText, LayoutGrid, List, Loader2, Rows3, StickyNote } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody } from '@/components/shell/PageHeader'
import { ActionMenu } from '@/components/ui/action-menu'
import { Readout } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ViewToggle, type ViewOption } from '@/components/ui/view-toggle'
import { saveDownload } from '@/lib/api/client'
import { useExportNotes, useNote, useNoteTags, useNotes } from '@/lib/api/queries'
import type { NoteExportFormat, NoteResponse } from '@/lib/api/types'
import { cn } from '@/lib/utils'

import { NoteFilterBar } from './components/NoteFilterBar'
import { NoteItem } from './components/NoteItem'
import { NoteListHeader, NoteRow } from './components/NoteRow'
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
 *
 * `grid-cols-1` below `lg` rather than the implicit column: an implicit track is as wide as
 * its widest unbreakable content, and a card's truncated provenance line counts at its full
 * length there, which pushed the cards off the right edge of a phone.
 */
const STREAM =
  'grid grid-cols-1 items-start gap-2.5 max-w-[46rem] lg:max-w-[93rem] lg:grid-cols-2'

/**
 * The sheet's columns. Sized so a tile holds a board at a legible size with four or five
 * lines of text under it, and so nothing is left alone in a row at the widths the app is
 * actually read at.
 */
const SHEET = 'grid grid-cols-1 items-start gap-2.5 sm:grid-cols-2 xl:grid-cols-3 min-[110rem]:grid-cols-4'

/**
 * The list: one bounded panel of rows per date rule, capped where a row stops gaining from
 * width. The columns are `NoteRow`'s, so the sections line up under one header — which
 * carries the same cap (`NoteListHeader`); change one and change the other.
 */
const LIST = 'flex flex-col rounded-lg border border-line bg-panel max-w-[93rem]'

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

  const setOpponent = useCallback(
    (opponent: string) => setFilters({ ...filters, opponent }),
    [filters, setFilters],
  )

  const list = view === 'sheet' ? SHEET : view === 'list' ? LIST : STREAM

  // One note in whichever view is open. The list draws rows in a `ul`; the other two draw
  // the note itself.
  const item = (note: NoteResponse, highlight: boolean) =>
    view === 'list' ? (
      <NoteRow
        key={note.id}
        note={note}
        highlighted={highlight}
        tagSuggestions={suggestions}
        onTagClick={addTag}
        onOpponentClick={setOpponent}
      />
    ) : (
      <NoteItem
        key={note.id}
        note={note}
        layout={view}
        highlighted={highlight}
        tagSuggestions={suggestions}
        onTagClick={addTag}
      />
    )
  const Group = view === 'list' ? 'ul' : 'div'

  return (
    <PageBody>
      {/* The titlebar's crumb is the page's name and carries the exports; an empty list says
          so itself (`Empty`), and a full page says so under its last note. */}
      <SetPageChrome
        breadcrumb={[{ label: t`Notes` }]}
        manual="guide/notes"
        actions={<ExportMenu filters={filters} disabled={total === 0} />}
      />

      {/*
        The view selector leads the filter row rather than sitting in the titlebar's actions:
        it belongs to the list under it, not to the page's verbs. A hairline rule ends it, as
        after Games' Mine/Others/All, so the switch does not read as the first of the filters.
        `basis-[20rem]` on the bar is what makes that behave on a phone — there is no room
        for a 20rem filter bar beside the selector on a 375px screen, so the bar takes the
        next line whole (and the rule, with nothing after it on its line, goes). Hung from
        the top, so when the bar wraps the switch stays on the first line rather than
        floating between the two.
      */}
      <div data-tour="notes" className="flex flex-wrap items-start gap-2">
        <ViewToggle
          views={VIEWS}
          value={view}
          onChange={setNoteView}
          label={t`How to show the notes`}
        />
        <span aria-hidden className="mt-1.5 h-4 w-px flex-none bg-hairline max-md:hidden" />
        <NoteFilterBar
          filters={filters}
          onChange={setFilters}
          className="min-w-0 flex-1 basis-[20rem]"
        />
      </div>

      {notes.isPending ? (
        <div className={view === 'list' ? 'flex max-w-[93rem] flex-col gap-1' : list}>
          {[0, 1, 2, 3, 4, 5].map((cell) => (
            <Skeleton
              key={cell}
              className={cn(
                'w-full rounded-lg',
                view === 'sheet' ? 'h-[15rem]' : view === 'list' ? 'h-7' : 'h-[9rem]',
              )}
            />
          ))}
        </div>
      ) : notes.isError ? (
        <div className="rounded-xl border border-blunder/28 bg-blunder/5 px-4 py-5">
          <p className="text-data text-blunder">
            <Trans>The notes could not be read.</Trans>
          </p>
          <p className="mt-1 font-mono text-label text-blunder/80">{notes.error.message}</p>
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
              <Group className={list}>{item(linked.data, true)}</Group>
            </section>
          ) : null}

          {total === 0 ? <Empty filtered={filterCount(filters) > 0} /> : null}

          {view === 'list' && total > 0 ? <NoteListHeader /> : null}

          {buckets.map((bucket) => (
            <section key={bucket.key} className="flex flex-col gap-1.5">
              <DateRule label={bucket.label} count={bucket.notes.length} />
              <Group className={list}>
                {bucket.notes.map((note) => item(note, note.id === highlighted))}
              </Group>
            </section>
          ))}

          {total === LIMIT ? (
            <p className="text-label text-dim">
              <Trans>These are the newest {LIMIT} notes. Narrow the filters to reach older ones.</Trans>
            </p>
          ) : null}
        </>
      )}
    </PageBody>
  )
}

const VIEWS: readonly ViewOption<NoteView>[] = [
  { id: 'stream', label: msg`Stream`, icon: Rows3, hint: msg`One column, every note in full` },
  {
    id: 'sheet',
    label: msg`Sheet`,
    icon: LayoutGrid,
    hint: msg`A grid of positions, text clamped`,
  },
  {
    id: 'list',
    label: msg`List`,
    icon: List,
    hint: msg`One line per note, with the game it was written on`,
  },
]

/**
 * A date rule: the label, a hairline to the end of the row, and the count.
 *
 * A rule rather than a heading, and that is the whole point of it — this is what replaced
 * the game headings. It sits on one line, spans whatever the list is, and cannot break a
 * grid row, because it is not in the grid.
 *
 * Sentence case in sans, not mono caps: it is a heading over a group, and caps are kept for
 * column heads (the list's) and mono for figures, so a rule in either read as the wrong kind
 * of thing (docs/design/README.md, clarity pass). The count at the end is a figure, so it
 * keeps its mono.
 */
function DateRule({ label, note, count }: { label: string; note?: string; count?: number }) {
  return (
    <div className="flex items-center gap-2.5 pt-1">
      <span className="text-label font-medium text-dim">{label}</span>
      {note ? <span className="text-label text-faint">{note}</span> : null}
      <span className="h-px flex-1 bg-hairline" />
      {count === undefined ? null : (
        <span className="font-mono text-meta tabular text-faint">{count}</span>
      )}
    </div>
  )
}

function Empty({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-edge-strong bg-panel/60 p-10 text-center max-md:p-6">
      <StickyNote className="size-5 text-faint" aria-hidden />
      <p className="max-w-md text-data leading-relaxed text-dim">
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
 *
 * One "Export ⌄" menu rather than two boxes reading "Markdown" and "PGN": the pair named
 * formats, not an action, and sat in the bar looking like two more views or filters. The
 * menu's trigger says the verb, its items say the format, and each item's hint says what
 * comes out of it. While a file is being made, and when making it failed, a readout beside
 * the trigger says so: the menu has closed by then, so it cannot.
 */
function ExportMenu({ filters, disabled }: { filters: NoteFilters; disabled: boolean }) {
  const { t } = useLingui()
  const exporting = useExportNotes({ onSuccess: (download) => saveDownload(download) })

  const run = (format: NoteExportFormat) => {
    exporting.mutate({ format, query: toNoteExportQuery(filters) })
  }

  return (
    <div className="flex items-center gap-2 max-md:flex-wrap max-md:gap-y-1">
      {exporting.isPending ? (
        <Readout className="inline-flex items-center gap-1">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          <Trans>Exporting…</Trans>
        </Readout>
      ) : exporting.isError ? (
        <span className="max-w-[16rem] truncate text-label text-blunder max-md:max-w-full max-md:basis-full">
          {exporting.error.message}
        </span>
      ) : null}
      <ActionMenu
        label={t`Export`}
        icon={FileDown}
        align="end"
        disabled={disabled || exporting.isPending}
        title={
          disabled ? t`No notes to export under these filters` : t`Export every note these filters show`
        }
        items={[
          {
            label: t`Markdown`,
            icon: FileText,
            hint: '.md',
            onSelect: () => run('md'),
          },
          {
            label: t`PGN`,
            icon: Download,
            hint: t`comments and variations`,
            onSelect: () => run('pgn'),
          },
        ]}
      />
    </div>
  )
}

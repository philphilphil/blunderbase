/**
 * One 40px row of design 2b. The row is set in Geist at the data size, and every number
 * that has to line up down a column — date, ratings, result, clock, moves, the drop — is
 * mono and tabular. The two names are a step larger (`text-lead`), because they are what
 * a row is looked up by.
 *
 * Routine metadata is text, and only exceptions are badges. Where the game came from and
 * that an import pass ran over it are true of nearly every row, so the Source and Analysis
 * cells say it in plain words (a coloured dot for the source) rather than in fifty tinted
 * chips; a run somebody asked for keeps its purple as text. The flag badges stay badges,
 * because a blunder is the exception a row is scanned for.
 *
 * The row states are the app's row grammar (`ui/row.ts`): hover is `raised`, a selected row
 * is `bg-selected` with the accent bar on its left edge and does not change under the
 * pointer, and keyboard focus is the global ring drawn inside the row, never a fill (a
 * focus fill had read as a second hover). The tick is the app's `Checkbox`. The dim
 * metadata in a selected row (the ECO, "Analysed", the phone's date) rises to `soft` there,
 * since `dim` on the selected blue falls under AA.
 *
 * Below `md` the same cells are re-laid as a two-line card on the grid `columns.ts`
 * describes, rather than as a line that would need 800px to be read. Nothing is rendered
 * per breakpoint: every cell is in the DOM at both sizes and the breakpoint only decides
 * where it sits, so the row stays one thing to reason about — and to test. (`Worst` and
 * `Collections` come and go with their columns, `columnsFor`, at every size alike.)
 *
 * The cells are drawn from the table's column list rather than written out in order: each
 * column id has a renderer (`CELLS`), and the row walks `columns`, so the header, the rows
 * and the skeleton agree on which cells there are and in what order by construction — the
 * list can drop, add or reorder a column without the row knowing. Every cell says which
 * column it is (`data-col`) and is a `role="cell"`, so a row reads as one to assistive
 * technology too. The row's delete is the tail of whichever cell is last (`Cell`).
 */
import { useLingui } from '@lingui/react/macro'
import { EyeOff, Trash2 } from 'lucide-react'
import type * as React from 'react'
import { memo } from 'react'

import { preloadRoute } from '@/app/lazyRoutes'
import { ClassificationBadge } from '@/components/badges/ClassificationBadge'
import { CollectionChips } from '@/components/collections/CollectionChip'
import { SourceBadge } from '@/components/badges/SourceBadge'
import { RunBadge } from '@/components/badges/RunBadge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ROW, ROW_SELECTED } from '@/components/ui/row'
import type { GameCard } from '@/lib/api/types'
import { cn } from '@/lib/utils'

import {
  analysisOf,
  dropTone,
  flagCounts,
  formatDrop,
  formatGameDate,
  formatResult,
  formatTimeControl,
  moveCount,
  outcomeTone,
  worstDrop,
} from '../format'
import {
  cellClass,
  PHONE_CARD,
  ROW_HEIGHT,
  ROW_SUBGRID,
  type ColumnId,
  type LaidColumn,
} from './columns'

/** The column ids a row has a cell for: every column in `COLUMNS`, the checkbox included. */
type CellId = ColumnId | 'select'

/**
 * What one cell is made of, apart from where it sits (`cellClass`): its own layout and type,
 * its hover title and its content. Where it sits belongs to the column, and changes with
 * whether it is last; what it says belongs to the game.
 */
interface CellParts {
  className?: string
  title?: string
  testId?: string
  body: React.ReactNode
}

/**
 * Everything about the row that the cells read, worked out once per render. The words are
 * translated by the row and handed in, because the `t` macro is only rewritten where
 * `useLingui` was called — a renderer out here calling it would ship untranslated and
 * never reach the catalog.
 */
interface CellContext {
  game: GameCard
  selected: boolean
  /** The tone of dim metadata: `dim` on a plain row, `soft` on a selected one. */
  meta: string
  /** This row's verdict is held back (⇧E, or this one game imported with it held back). */
  quiet: boolean
  analysis: ReturnType<typeof analysisOf>
  inCollections: boolean
  ownerSide: GameCard['color'] | null
  /** "In queue", or the Analyse button, for a game no pass has looked at. */
  queueState: React.ReactNode
  collectionNames: ReadonlyMap<number, string>
  onToggle: (id: number, event: React.MouseEvent) => void
  words: { select: string; unknownOpening: string; heldBack: string; sourceLink: string }
}

/**
 * A player's name. The owner's side is set bold under its column, which is how the row says
 * which side was theirs — the same fact the old `Col` disc carried, now told by the name it
 * belongs to.
 */
function nameClass({ ownerSide, selected }: CellContext, side: 'white' | 'black') {
  return cn(
    'truncate text-lead',
    ownerSide === side ? 'font-semibold text-ink' : selected ? 'text-bright' : 'text-ink-2',
  )
}

/** One renderer per column id; the row draws whichever of them its column list names. */
const CELLS: Record<CellId, (ctx: CellContext) => CellParts> = {
  select: ({ game, selected, onToggle, words }) => ({
    className: 'flex items-center',
    body: (
      <Checkbox
        checked={selected}
        aria-label={words.select}
        onCheckedChange={(_next, event) => {
          event.stopPropagation()
          onToggle(game.id, event)
        }}
        // The row's Enter and Space open the game; on the box they tick it instead.
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
        }}
      />
    ),
  }),

  date: ({ game, selected, inCollections }) => ({
    className: cn(
      'font-mono tabular text-body max-md:flex max-md:min-w-0 max-md:items-center max-md:gap-2',
      selected ? 'max-md:text-soft' : 'max-md:text-dim',
    ),
    body: (
      <>
        {formatGameDate(game.played_at)}
        {/* The phone card's copy of the chips (see the Collections cell for why there are two). */}
        {inCollections ? <CollectionChips ids={game.collections} className="md:hidden" /> : null}
      </>
    ),
  }),

  white: (ctx) => ({
    className: nameClass(ctx, 'white'),
    title: ctx.game.white ?? undefined,
    body: ctx.game.white ?? '—',
  }),

  white_rating: ({ game }) => ({
    className: 'text-right font-mono tabular text-body',
    body: game.white_rating ?? '—',
  }),

  black: (ctx) => ({
    className: nameClass(ctx, 'black'),
    title: ctx.game.black ?? undefined,
    body: ctx.game.black ?? '—',
  }),

  black_rating: ({ game }) => ({
    className: 'text-right font-mono tabular text-body',
    body: game.black_rating ?? '—',
  }),

  opening: ({ game, meta, words }) => ({
    className: 'truncate text-body',
    title: [game.opening, game.eco].filter(Boolean).join(' · ') || undefined,
    body: (
      <>
        {game.opening ?? words.unknownOpening}{' '}
        {game.eco ? <span className={cn('font-mono', meta)}>{game.eco}</span> : null}
      </>
    ),
  }),

  result: ({ game }) => ({
    className: cn('text-center font-mono font-semibold tabular', outcomeTone(game.outcome)),
    body: formatResult(game.result),
  }),

  // Capped (`columns.ts`), so a long correspondence clock ends in "…" and is whole here.
  time: ({ game }) => ({
    className: 'truncate font-mono tabular text-soft',
    title: formatTimeControl(game),
    body: formatTimeControl(game),
  }),

  moves: ({ game }) => ({
    className: 'text-right font-mono tabular text-soft',
    body: moveCount(game.ply_count),
  }),

  // Under ⇧E the table has no Worst column at all (`columnsFor`), so a quiet row here is
  // one game imported with its engine held back: the cell marks it rather than going blank.
  worst: ({ game, meta, quiet, words }) => {
    if (quiet) {
      return {
        className: cn('flex items-center justify-end', meta),
        body: <EyeOff className="size-3" role="img" aria-label={words.heldBack} />,
      }
    }
    const drop = worstDrop(game)
    return {
      className: cn('text-right font-mono tabular', dropTone(drop)),
      body: formatDrop(drop),
    }
  },

  source: ({ game, words }) => ({
    className: 'flex items-center',
    // A dot and the site's name, a link to the game there where it has one; the click stops
    // in the link rather than also opening the row (`SourceBadge`).
    body: (
      <SourceBadge
        source={game.source}
        variant="plain"
        size="sm"
        href={game.url}
        title={game.url ? words.sourceLink : undefined}
      />
    ),
  }),

  // Whether a pass has run, and where none has, the way to get one: the button (or "In
  // queue") stands in the column that answers "analysed?", rather than in Flags, which is
  // about what a pass found. The phone card drops this column, so it keeps a copy in its
  // Flags slot — or, while ⇧E takes Flags away, takes that slot itself.
  tier: ({ analysis, selected, queueState }) => ({
    className: 'flex items-center gap-2',
    body: analysis ? (
      <RunBadge
        run={analysis}
        plain
        className={selected && !analysis.requested ? 'text-soft' : undefined}
      />
    ) : (
      queueState
    ),
  }),

  flags: ({ game, analysis, quiet, meta, queueState, words }) => ({
    className: 'flex items-center gap-1 overflow-hidden',
    body:
      analysis && quiet ? (
        // One game held back while the rest of the table shows its flags: an empty cell
        // here would read as a game without a mistake in it. (Under ⇧E the column is gone
        // altogether, so the eye only ever marks a game hidden on its own.)
        <span
          role="img"
          aria-label={words.heldBack}
          title={words.heldBack}
          className={cn('flex items-center', meta)}
        >
          <EyeOff className="size-3.5" aria-hidden />
        </span>
      ) : analysis ? (
        flagCounts(game).map((flag) => (
          <ClassificationBadge
            key={flag.glyph}
            glyph={flag.glyph}
            count={flag.count}
            size="sm"
            className="shrink-0 px-[0.3125rem]"
          />
        ))
      ) : (
        // The phone card's copy: it has no Analysis column, and this is its one slot on the
        // second line (see the Analysis cell).
        <span className="flex min-w-0 items-center md:hidden">{queueState}</span>
      ),
  }),

  // How many notes were written on this game — its own, not the ones it meets from other
  // games at a shared position (`note_count`). A 0 is printed, quieter than a count: a
  // blank would read as "not known" in a column that always knows.
  notes: ({ game, meta }) => ({
    className: cn('text-right font-mono tabular', (game.note_count ?? 0) > 0 ? 'text-soft' : meta),
    testId: 'game-note-count',
    body: game.note_count ?? null,
  }),

  // The desktop copy of the game's collections, as names. The phone card has no column for
  // it, so there the chips ride on the date's line, which spans most of the card.
  collections: ({ game, inCollections, collectionNames }) => ({
    className: 'flex items-center gap-2 text-soft',
    body: inCollections ? (
      <CollectionNames ids={game.collections ?? []} names={collectionNames} />
    ) : null,
  }),
}

/**
 * One cell: the column's place (`cellClass`) around the renderer's parts.
 *
 * The last cell carries the row's delete as its tail, and splits in two to do it: the outer
 * span is the cell — its place, and from `md` up a flex line holding the content and the
 * bin — and the inner span carries the content's own layout, exactly as it would if the
 * column were not last. So a cell's look never depends on where it falls: Flags keeps its
 * badges in its own flex box, the date keeps its chips, and on a phone (where the bin is
 * hidden and the outer span is a plain box) the card renders as it always does. The inner
 * span takes the phone slot's classes too: their placement half is inert on a span that is
 * not a grid item, and their alignment half (Flags' `justify-end`) is only something the
 * inner span, being the flex box, can act on.
 *
 * The inner span is a block at every size unless its renderer makes it a flex box (`block`
 * comes before the renderer's classes, so their `flex` wins). Not being a grid or flex item
 * on a phone, it would otherwise stay inline, and an inline box can neither truncate nor
 * align its text: a long name made last would run over the Elo beside it in the card, and a
 * last Worst would stop lining up under Black's Elo.
 *
 * `contain:inline-size` keeps the last cell's content out of its own minimum width. The
 * last track is the space the others leave, down to a floor (`tracksFor`), and a grid item's
 * automatic minimum is its content: without it a game in five long-named collections would
 * push its cell past the track and the pane's edge instead of truncating the list.
 */
function Cell({ column, parts, tail }: { column: LaidColumn; parts: CellParts; tail?: React.ReactNode }) {
  if (tail === undefined) {
    return (
      <span
        role="cell"
        data-col={column.id}
        data-testid={parts.testId}
        title={parts.title}
        className={cn(cellClass(column), parts.className)}
      >
        {parts.body}
      </span>
    )
  }
  return (
    <span
      role="cell"
      data-col={column.id}
      data-testid={parts.testId}
      className={cn(cellClass(column), 'md:flex md:items-center md:gap-2 md:[contain:inline-size]')}
    >
      <span title={parts.title} className={cn(column.phone, 'block', parts.className, 'md:min-w-0 md:flex-1')}>
        {parts.body}
      </span>
      {tail}
    </span>
  )
}

function hasCell(id: string): id is CellId {
  return Object.hasOwn(CELLS, id)
}

/**
 * A game's collections as plain names, comma-separated, in the collections list's order.
 * Text rather than chips: most of a table's rows are in one or two collections, and a
 * row of tinted chips at the end of every line competed with the flags for the eye. The
 * full list is in the title, for a cell too narrow to show it. The names come from the
 * table (`GamesTable`), which reads the collections list once for every row.
 */
function CollectionNames({
  ids,
  names: byId,
  className,
}: {
  ids: readonly number[]
  names: ReadonlyMap<number, string>
  className?: string
}) {
  const names = [...byId.entries()]
    .filter(([id]) => ids.includes(id))
    .map(([, name]) => name)
    .join(', ')
  if (!names) return null
  return (
    <span className={cn('min-w-0 truncate', className)} title={names}>
      {names}
    </span>
  )
}

export interface GameRowProps {
  game: GameCard
  selected: boolean
  onToggle: (id: number, event: React.MouseEvent) => void
  onOpen: (id: number) => void
  onAnalyse: (id: number) => void
  /** Delete this one game, through the same confirmation a selection goes through. */
  onDelete: (id: number) => void
  analysing: boolean
  /** An analysis run over the game is queued or running: the row says so instead of Analyse. */
  queued?: boolean
  /**
   * The engine is hidden (⇧E, `lib/ui/engineVisibility`), so this row says nothing about
   * how the game was played: no `Worst` and no `Flags` cell — the table has dropped both
   * columns and their headers (`columnsFor`). What stays is what the engine did not
   * decide: the Analysis cell (a pass happened, and whether one was asked for), the
   * "analyse" affordance where none has, and the delete button at the end of the row.
   */
  engineHidden?: boolean
  /** The table's columns (`columnsFor`), worked out once by the table for every row. */
  columns: readonly LaidColumn[]
  /** Every collection's name by id, in the collections list's order, for the Collections cell. */
  collectionNames: ReadonlyMap<number, string>
}

export const GameRow = memo(function GameRow({
  game,
  selected,
  onToggle,
  onOpen,
  onAnalyse,
  onDelete,
  analysing,
  queued = false,
  engineHidden = false,
  columns,
  collectionNames,
}: GameRowProps) {
  const { t } = useLingui()
  const id = game.id
  const analysis = analysisOf(game)
  // What reads `dim` on a plain row reads `soft` on a selected one (see the doc above).
  const meta = selected ? 'text-soft' : 'text-dim'
  // A game no pass has looked at: "In queue" once one is asked for, here or by the import
  // (the button would only queue it a second time), else the command that asks — a small
  // tool button, since accent text is a link.
  const queueState = queued ? (
    <span className={cn('truncate', meta)} title={t`Waiting in the analysis queue`}>
      {t`In queue`}
    </span>
  ) : (
    <Button
      type="button"
      variant="secondary"
      size="xs"
      onClick={(event) => {
        event.stopPropagation()
        onAnalyse(game.id)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
      }}
      disabled={analysing}
      title={analysing ? t`Already on its way to the queue` : t`Queue the analysis pass for this game`}
    >
      {analysing ? t`Queueing…` : t`Analyse`}
    </Button>
  )
  const ctx: CellContext = {
    game,
    selected,
    meta,
    // This row's verdict is held back either because the engine is hidden everywhere (⇧E,
    // which also takes the Worst column out of the table) or because this one game was
    // imported with it held back (`engine_hidden`, cleared on the game itself). The second
    // keeps the column and marks the cell instead, so the row says *why* it is quiet.
    quiet: engineHidden || game.engine_hidden === true,
    analysis,
    // Most rows are in no collection; those never render the phone's chips at all.
    inCollections: (game.collections?.length ?? 0) > 0,
    // The owner's side, or null: a game added from the reference books has none, and a
    // game of theirs whose side is not yet known has none either.
    ownerSide: game.is_owner_game === false ? null : (game.color ?? null),
    queueState,
    collectionNames,
    onToggle,
    words: {
      select: t`Select game ${id}`,
      unknownOpening: t`Unknown opening`,
      heldBack: t`Engine hidden on this game until you show it`,
      sourceLink: t`Open this game on the site it came from`,
    },
  }

  return (
    <div
      role="row"
      tabIndex={0}
      data-games-row
      aria-selected={selected}
      // The game screen is its own chunk; a pointer over a row is about to ask for it.
      onPointerEnter={() => preloadRoute(`/games/${game.id}`)}
      onClick={() => onOpen(game.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(game.id)
        }
      }}
      className={cn(
        // `select-none`: a shift-click extends the selection of rows, and must not also
        // paint a run of text blue from the last row clicked to this one.
        'group cursor-pointer items-center border-t border-hairline px-5 font-sans text-data select-none',
        ROW_SUBGRID,
        ROW_HEIGHT,
        PHONE_CARD,
        'max-md:gap-x-2 max-md:gap-y-1 max-md:px-3 max-md:py-2',
        ROW,
        selected && ROW_SELECTED,
      )}
    >
      {columns.map((column) =>
        // A column this build has no cell for draws nothing rather than throwing the page
        // of rows away; `COLUMNS` and `CELLS` are kept to the same ids.
        hasCell(column.id) ? (
          <Cell
            key={column.id}
            column={column}
            parts={CELLS[column.id](ctx)}
            // The row's delete sits at its end, in whichever cell that is (`columnsFor`).
            tail={column.last ? <DeleteGameButton id={id} onDelete={onDelete} /> : undefined}
          />
        ) : null,
      )}
    </div>
  )
})

/**
 * Deleting one game, at the end of the row it belongs to — in whichever cell is last: a
 * ghost icon, as every action inside a table row is, tinting to the blunder red under the
 * pointer. Kept out of the way until the row is pointed at or focused, because it sits
 * beside a click target that opens the game and a permanently visible bin on forty rows
 * reads as a page about deleting games. It confirms first, like every other delete here —
 * and it is desktop-only: the phone card has no room for a hover affordance, and a
 * selection plus the footer's Delete… is the same act with a bigger target. It needs no
 * margin to reach the end: the last cell's content takes the spare width (`Cell`).
 */
function DeleteGameButton({ id, onDelete }: { id: number; onDelete: (id: number) => void }) {
  const { t } = useLingui()
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={t`Delete game ${id}`}
      title={t`Delete this game`}
      onClick={(event) => {
        event.stopPropagation()
        onDelete(id)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
      }}
      className="flex-none opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:not-disabled:text-blunder focus-visible:opacity-100 max-md:hidden"
    >
      <Trash2 className="size-3.5" aria-hidden />
    </Button>
  )
}

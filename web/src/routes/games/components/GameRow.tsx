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
import { useCollections } from '@/lib/api/queries'
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
import { cellClass, cellStyle, columnsFor, PHONE_CARD, ROW_HEIGHT, type Column } from './columns'

/**
 * The `style` and `className` one cell carries: its width, its place, and its own look.
 * Read off the row's own column list, since Flags is fixed or flexible depending on whether
 * the table has a Collections column after it (`columnsFor`).
 */
function cellOf(columns: readonly Column[], id: string, className?: string) {
  const found = columns.find((entry) => entry.id === id)
  if (!found) throw new Error(`unknown column ${id}`)
  return { style: cellStyle(found), className: cn(cellClass(found), className) }
}

/**
 * A game's collections as plain names, comma-separated, in the collections list's order.
 * Text rather than chips: most of a table's rows are in one or two collections, and a
 * row of tinted chips at the end of every line competed with the flags for the eye. The
 * full list is in the title, for a cell too narrow to show it.
 */
function CollectionNames({ ids, className }: { ids: readonly number[]; className?: string }) {
  const { data } = useCollections()
  const wanted = new Set(ids)
  const names = (data?.collections ?? [])
    .filter((collection) => wanted.has(collection.id))
    .map((collection) => collection.name)
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
  /** Whether the table has its Collections column (it drops it while there are none). */
  collectionsColumn?: boolean
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
  collectionsColumn = true,
}: GameRowProps) {
  const { t } = useLingui()
  const columns = columnsFor(engineHidden, collectionsColumn)
  const cell = (id: string, className?: string) => cellOf(columns, id, className)
  const has = (id: string) => columns.some((column) => column.id === id)
  // The row's delete sits at its end, in whichever cell that is (`columnsFor`).
  const last = columns.at(-1)?.id
  const analysis = analysisOf(game)
  const drop = worstDrop(game)
  const flags = flagCounts(game)
  // This row's verdict is held back either because the engine is hidden everywhere (⇧E,
  // which also takes the Worst column out of the table) or because this one game was
  // imported with it held back (`engine_hidden`, cleared on the game itself). The second
  // keeps the column and marks the cell instead, so the row says *why* it is quiet.
  const quiet = engineHidden || game.engine_hidden === true
  // Most rows are in no collection; those never subscribe to the collections list at all.
  const inCollections = (game.collections?.length ?? 0) > 0
  // The owner's side, or null: a game added from the reference books has none, and a
  // game of theirs whose side is not yet known has none either. Their name is set bold
  // under its column, which is how the row says which side was theirs — the same fact
  // the old `Col` disc carried, now told by the name it belongs to.
  const id = game.id
  const ownerSide = game.is_owner_game === false ? null : (game.color ?? null)
  const nameClass = (side: 'white' | 'black') =>
    cn(
      'truncate text-lead',
      ownerSide === side ? 'font-semibold text-ink' : selected ? 'text-bright' : 'text-ink-2',
    )
  // What reads `dim` on a plain row reads `soft` on a selected one (see the doc above).
  const meta = selected ? 'text-soft' : 'text-dim'
  const remove = <DeleteGameButton id={id} onDelete={onDelete} />
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
        'group flex cursor-pointer items-center gap-2.5 border-t border-hairline px-5 font-sans text-data select-none',
        ROW_HEIGHT,
        PHONE_CARD,
        'max-md:gap-x-2 max-md:gap-y-1 max-md:px-3 max-md:py-2',
        ROW,
        selected && ROW_SELECTED,
      )}
    >
      <span {...cell('select', 'flex items-center')}>
        <Checkbox
          checked={selected}
          aria-label={t`Select game ${id}`}
          onCheckedChange={(_next, event) => {
            event.stopPropagation()
            onToggle(game.id, event)
          }}
          // The row's Enter and Space open the game; on the box they tick it instead.
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
          }}
        />
      </span>

      <span
        {...cell(
          'date',
          cn(
            'font-mono tabular text-body max-md:flex max-md:min-w-0 max-md:items-center max-md:gap-2',
            selected ? 'max-md:text-soft' : 'max-md:text-dim',
          ),
        )}
      >
        {formatGameDate(game.played_at)}
        {/* The phone card's copy of the chips (see the Collections cell for why there are two). */}
        {inCollections ? <CollectionChips ids={game.collections} className="md:hidden" /> : null}
      </span>

      <span {...cell('white', nameClass('white'))} title={game.white ?? undefined}>
        {game.white ?? '—'}
      </span>

      <span {...cell('white_rating', 'text-right font-mono tabular text-body')}>
        {game.white_rating ?? '—'}
      </span>

      <span {...cell('black', nameClass('black'))} title={game.black ?? undefined}>
        {game.black ?? '—'}
      </span>

      <span {...cell('black_rating', 'text-right font-mono tabular text-body')}>
        {game.black_rating ?? '—'}
      </span>

      <span
        {...cell('opening', 'truncate text-body')}
        title={[game.opening, game.eco].filter(Boolean).join(' · ') || undefined}
      >
        {game.opening ?? t`Unknown opening`}{' '}
        {game.eco ? <span className={cn('font-mono', meta)}>{game.eco}</span> : null}
      </span>

      <span
        {...cell('result', cn('text-center font-mono font-semibold tabular', outcomeTone(game.outcome)))}
      >
        {formatResult(game.result)}
      </span>

      <span {...cell('time', 'truncate font-mono tabular text-soft')}>{formatTimeControl(game)}</span>

      <span {...cell('moves', 'text-right font-mono tabular text-soft')}>
        {moveCount(game.ply_count)}
      </span>

      {engineHidden ? null : quiet ? (
        <span {...cell('worst', cn('flex items-center justify-end', meta))}>
          <EyeOff
            className="size-3"
            role="img"
            aria-label={t`Engine hidden on this game until you show it`}
          />
        </span>
      ) : (
        <span {...cell('worst', cn('text-right font-mono tabular', dropTone(drop)))}>
          {formatDrop(drop)}
        </span>
      )}

      <span {...cell('source', 'flex items-center')}>
        {/* A dot and the site's name, a link to the game there where it has one; the click
            stops in the link rather than also opening the row (`SourceBadge`). */}
        <SourceBadge
          source={game.source}
          variant="plain"
          size="sm"
          href={game.url}
          title={game.url ? t`Open this game on the site it came from` : undefined}
        />
      </span>

      {/* Whether a pass has run, and where none has, the way to get one: the button (or
          "In queue") stands in the column that answers "analysed?", rather than in Flags,
          which is about what a pass found. The phone card drops this column, so it keeps
          a copy in its Flags slot — or, while ⇧E takes Flags away, takes that slot itself. */}
      <span {...cell('tier', 'flex items-center gap-2')}>
        {analysis ? (
          <RunBadge
            run={analysis}
            plain
            className={selected && !analysis.requested ? 'text-soft' : undefined}
          />
        ) : (
          queueState
        )}
        {last === 'tier' ? remove : null}
      </span>

      {has('flags') ? (
        <span {...cell('flags', 'flex items-center gap-1 overflow-hidden')}>
          {analysis && quiet ? (
            // One game held back while the rest of the table shows its flags: an empty cell
            // here would read as a game without a mistake in it. (Under ⇧E the column is
            // gone altogether, so the eye only ever marks a game hidden on its own.)
            <span
              role="img"
              aria-label={t`Engine hidden on this game until you show it`}
              title={t`Engine hidden on this game until you show it`}
              className={cn('flex items-center', meta)}
            >
              <EyeOff className="size-3.5" aria-hidden />
            </span>
          ) : analysis ? (
            flags.map((flag) => (
              <ClassificationBadge
                key={flag.glyph}
                glyph={flag.glyph}
                count={flag.count}
                size="sm"
                className="shrink-0 px-[0.3125rem]"
              />
            ))
          ) : (
            // The phone card's copy: it has no Analysis column, and this is its one slot on
            // the second line (see the Analysis cell).
            <span className="flex min-w-0 items-center md:hidden">{queueState}</span>
          )}
          {last === 'flags' ? remove : null}
        </span>
      ) : null}

      {has('collections') ? (
        <span {...cell('collections', 'flex items-center gap-2 text-soft')}>
          {/* The desktop copy. The phone card has no column for it, so there the chips ride
              on the date's line, which spans most of the card. */}
          {inCollections ? <CollectionNames ids={game.collections ?? []} /> : null}
          {last === 'collections' ? remove : null}
        </span>
      ) : null}
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
 * selection plus the footer's Delete… is the same act with a bigger target.
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
      className="ml-auto flex-none opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:not-disabled:text-blunder focus-visible:opacity-100 max-md:hidden"
    >
      <Trash2 className="size-3.5" aria-hidden />
    </Button>
  )
}

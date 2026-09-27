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
 * A selected row is `bg-selected` with the accent bar on its left edge, the one selected
 * idiom for list rows. The dim metadata in it (the ECO, "Analysed", the phone's date)
 * rises to `soft` there, since `dim` on the selected blue falls under AA.
 *
 * Below `md` the same 13 cells are re-laid as a two-line card on the grid `columns.ts`
 * describes, rather than as a line that would need 800px to be read. Nothing is
 * conditionally rendered: every cell is in the DOM at both sizes and the breakpoint only
 * decides where it sits, so the row stays one thing to reason about — and to test.
 */
import { useLingui } from '@lingui/react/macro'
import { EyeOff, X } from 'lucide-react'
import type * as React from 'react'
import { memo } from 'react'

import { preloadRoute } from '@/app/lazyRoutes'
import { ClassificationBadge } from '@/components/badges/ClassificationBadge'
import { SourceBadge } from '@/components/badges/SourceBadge'
import { RunBadge, UnanalysedBadge } from '@/components/badges/RunBadge'
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
import { cellClass, cellStyle, COLUMNS, PHONE_CARD, ROW_HEIGHT } from './columns'

/** The `style` and `className` one cell carries: its width, its place, and its own look. */
function cell(id: string, className?: string) {
  const found = COLUMNS.find((entry) => entry.id === id)
  if (!found) throw new Error(`unknown column ${id}`)
  return { style: cellStyle(found), className: cn(cellClass(found), className) }
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
  /**
   * The engine is hidden (⇧E, `lib/ui/engineVisibility`), so this row says nothing about
   * how the game was played: no `Worst` cell — the table has dropped that column and the
   * header with it — and no flag badges. What stays is what the engine did not decide: the
   * Analysis cell (a pass happened, and whether one was asked for), the "analyse" affordance
   * where none has, and the delete button that shares the flags cell.
   */
  engineHidden?: boolean
}

export const GameRow = memo(function GameRow({
  game,
  selected,
  onToggle,
  onOpen,
  onAnalyse,
  onDelete,
  analysing,
  engineHidden = false,
}: GameRowProps) {
  const { t } = useLingui()
  const analysis = analysisOf(game)
  const drop = worstDrop(game)
  const flags = flagCounts(game)
  // This row's verdict is held back either because the engine is hidden everywhere (⇧E,
  // which also takes the Worst column out of the table) or because this one game was
  // imported with it held back (`engine_hidden`, cleared on the game itself). The second
  // keeps the column and marks the cell instead, so the row says *why* it is quiet.
  const quiet = engineHidden || game.engine_hidden === true
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
        'group flex cursor-pointer items-center gap-2.5 border-t border-hairline px-5 font-sans text-data outline-none select-none',
        ROW_HEIGHT,
        PHONE_CARD,
        'max-md:gap-x-2 max-md:gap-y-1 max-md:px-3 max-md:py-2',
        selected
          ? 'bg-selected shadow-[inset_0.125rem_0_0_var(--bb-accent)]'
          : 'hover:bg-raised focus-visible:bg-raised',
      )}
    >
      <span {...cell('select', 'flex items-center')}>
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={t`Select game ${id}`}
          onClick={(event) => {
            event.stopPropagation()
            onToggle(game.id, event)
          }}
          className={cn(
            // Large enough to distinguish from the row around it as a click target. The
            // whole visible square is the button, so a near-hit selects instead of opening.
            'size-[1.125rem] rounded-sm border transition-colors',
            selected
              ? 'border-accent-teal bg-accent-teal'
              : 'border-edge-strong hover:border-edge-hover',
          )}
        />
      </span>

      <span
        {...cell('date', cn('font-mono tabular text-body', selected ? 'max-md:text-soft' : 'max-md:text-dim'))}
      >
        {formatGameDate(game.played_at)}
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

      <span {...cell('tier', 'flex items-center')}>
        {analysis ? (
          <RunBadge
            run={analysis}
            plain
            className={selected && !analysis.requested ? 'text-soft' : undefined}
          />
        ) : (
          <UnanalysedBadge plain className={selected ? 'text-soft' : undefined} />
        )}
      </span>

      <span {...cell('flags', 'flex items-center gap-1 overflow-hidden')}>
        {analysis && quiet ? null : analysis ? (
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
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onAnalyse(game.id)
            }}
            disabled={analysing}
            className="text-label text-accent-teal hover:text-accent-link disabled:text-dim max-md:rounded-md max-md:border max-md:border-edge max-md:px-2 max-md:py-1"
          >
            {analysing ? t`queueing…` : t`analyse`}
          </button>
        )}

        {/* Deleting one game, at the end of the row it belongs to. Kept out of the way
            until the row is pointed at or focused, because it sits beside a click target
            that opens the game and a permanently visible ✕ on forty rows reads as a page
            about deleting games. It confirms first, like every other delete here — and it
            is desktop-only: the phone card has no room for a hover affordance, and a
            selection plus the footer's Delete is the same act with a bigger target. */}
        <button
          type="button"
          aria-label={t`Delete game ${id}`}
          title={t`Delete this game`}
          onClick={(event) => {
            event.stopPropagation()
            onDelete(game.id)
          }}
          className="ml-auto shrink-0 rounded-sm p-0.5 text-soft opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-blunder focus-visible:opacity-100 max-md:hidden"
        >
          <X className="size-3" aria-hidden />
        </button>
      </span>
    </div>
  )
})

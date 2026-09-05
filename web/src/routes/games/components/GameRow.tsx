/**
 * One 40px row of design 2b: mono and tabular throughout, with the two name columns set in
 * Geist so they read as prose next to the numbers.
 *
 * Below `md` the same 13 cells are re-laid as a two-line card on the grid `columns.ts`
 * describes, rather than as a line that would need 800px to be read. Nothing is
 * conditionally rendered: every cell is in the DOM at both sizes and the breakpoint only
 * decides where it sits, so the row stays one thing to reason about — and to test.
 */
import { useLingui } from '@lingui/react/macro'
import { X } from 'lucide-react'
import type * as React from 'react'
import { memo } from 'react'

import { ClassificationBadge } from '@/components/badges/ClassificationBadge'
import { SourceBadge } from '@/components/badges/SourceBadge'
import { TierBadge, UnanalysedBadge } from '@/components/badges/TierBadge'
import type { GameCard } from '@/lib/api/types'
import { cn } from '@/lib/utils'

import {
  dropTone,
  flagCounts,
  formatDrop,
  formatGameDate,
  formatResult,
  formatTimeControl,
  moveCount,
  outcomeTone,
  tierOf,
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
}

export const GameRow = memo(function GameRow({
  game,
  selected,
  onToggle,
  onOpen,
  onAnalyse,
  onDelete,
  analysing,
}: GameRowProps) {
  const { t } = useLingui()
  const tier = tierOf(game)
  const drop = worstDrop(game)
  const flags = flagCounts(game)
  // The owner's side, or null: a game added from the reference books has none, and a
  // game of theirs whose side is not yet known has none either. Their name is set bold
  // under its column, which is how the row says which side was theirs — the same fact
  // the old `Col` disc carried, now told by the name it belongs to.
  const id = game.id
  const ownerSide = game.is_owner_game === false ? null : (game.color ?? null)
  const nameClass = (side: 'white' | 'black') =>
    cn(
      'truncate font-sans text-[0.78125rem]',
      ownerSide === side ? 'font-semibold text-ink' : selected ? 'text-bright' : 'text-body',
    )

  return (
    <div
      role="row"
      tabIndex={0}
      data-games-row
      aria-selected={selected}
      onClick={() => onOpen(game.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(game.id)
        }
      }}
      className={cn(
        'group flex cursor-pointer items-center gap-2.5 border-t border-raised px-5 font-mono text-[0.71875rem] tabular outline-none',
        ROW_HEIGHT,
        PHONE_CARD,
        'max-md:gap-x-2 max-md:gap-y-1 max-md:px-3 max-md:py-2',
        selected
          ? 'bg-accent-teal/8 shadow-[inset_0.125rem_0_0_var(--bb-accent)]'
          : 'hover:bg-elevated-2 focus-visible:bg-elevated-2',
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
            'size-[1.125rem] rounded-[0.1875rem] border transition-colors',
            selected
              ? 'border-accent-teal bg-accent-teal'
              : 'border-edge-strong hover:border-edge-hover',
          )}
        />
      </span>

      <span {...cell('date', 'text-body max-md:text-dim')}>{formatGameDate(game.played_at)}</span>

      <span {...cell('white', nameClass('white'))} title={game.white ?? undefined}>
        {game.white ?? '—'}
      </span>

      <span {...cell('white_rating', 'text-right text-soft')}>{game.white_rating ?? '—'}</span>

      <span {...cell('black', nameClass('black'))} title={game.black ?? undefined}>
        {game.black ?? '—'}
      </span>

      <span {...cell('black_rating', 'text-right text-soft')}>{game.black_rating ?? '—'}</span>

      <span
        {...cell('opening', 'truncate font-sans text-[0.78125rem] text-body')}
        title={[game.opening, game.eco].filter(Boolean).join(' · ') || undefined}
      >
        {game.opening ?? t`Unknown opening`}{' '}
        {game.eco ? <span className="font-mono text-dim">{game.eco}</span> : null}
      </span>

      <span {...cell('result', cn('text-center font-semibold', outcomeTone(game.outcome)))}>
        {formatResult(game.result)}
      </span>

      <span {...cell('time', 'truncate text-soft')}>{formatTimeControl(game)}</span>

      <span {...cell('moves', 'text-right text-soft')}>{moveCount(game.ply_count)}</span>

      <span {...cell('worst', cn('text-right', dropTone(drop)))}>{formatDrop(drop)}</span>

      <span {...cell('source')}>
        <SourceBadge source={game.source} size="sm" />
      </span>

      <span {...cell('tier')}>
        {tier ? (
          <TierBadge tier={tier} className="px-1.5 py-px text-[0.625rem]" />
        ) : (
          <UnanalysedBadge className="px-1.5 py-px text-[0.625rem]" />
        )}
      </span>

      <span {...cell('flags', 'flex items-center gap-1 overflow-hidden')}>
        {tier ? (
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
            className="text-[0.65625rem] text-accent-teal hover:text-accent-link disabled:text-dim max-md:rounded-md max-md:border max-md:border-edge max-md:px-2 max-md:py-1"
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
          className="ml-auto shrink-0 rounded-[0.1875rem] p-0.5 text-dim-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-blunder focus-visible:opacity-100 max-md:hidden"
        >
          <X className="size-3" aria-hidden />
        </button>
      </span>
    </div>
  )
})

/**
 * One 40px row of design 2b: mono and tabular throughout, with the two name columns set in
 * Geist so they read as prose next to the numbers.
 */
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
import { cellStyle, COLUMNS, ROW_HEIGHT } from './columns'

function column(id: string) {
  const found = COLUMNS.find((entry) => entry.id === id)
  if (!found) throw new Error(`unknown column ${id}`)
  return cellStyle(found)
}

export interface GameRowProps {
  game: GameCard
  selected: boolean
  onToggle: (id: number, event: React.MouseEvent) => void
  onOpen: (id: number) => void
  onAnalyse: (id: number) => void
  analysing: boolean
}

export const GameRow = memo(function GameRow({
  game,
  selected,
  onToggle,
  onOpen,
  onAnalyse,
  analysing,
}: GameRowProps) {
  const tier = tierOf(game)
  const drop = worstDrop(game)
  const flags = flagCounts(game)

  return (
    <div
      role="row"
      tabIndex={0}
      aria-selected={selected}
      onClick={() => onOpen(game.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(game.id)
        }
      }}
      style={{ height: ROW_HEIGHT }}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 border-t border-raised px-5 font-mono text-[0.71875rem] tabular outline-none',
        selected
          ? 'bg-accent-teal/8 shadow-[inset_0.125rem_0_0_var(--bb-accent)]'
          : 'hover:bg-elevated-2 focus-visible:bg-elevated-2',
      )}
    >
      <span style={column('select')} className="flex items-center">
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={`Select game ${game.id}`}
          onClick={(event) => {
            event.stopPropagation()
            onToggle(game.id, event)
          }}
          className={cn(
            'size-[0.6875rem] rounded-[0.1875rem] border transition-colors',
            selected
              ? 'border-accent-teal bg-accent-teal'
              : 'border-edge-strong hover:border-edge-hover',
          )}
        />
      </span>

      <span style={column('date')} className="text-body">
        {formatGameDate(game.played_at)}
      </span>

      <span
        style={column('opponent')}
        className={cn('truncate font-sans text-[0.78125rem]', selected ? 'text-bright' : 'text-body')}
        title={game.opponent ?? undefined}
      >
        {game.opponent ?? '—'}
      </span>

      <span style={column('rating')} className="text-right text-soft">
        {game.opponent_rating ?? '—'}
      </span>

      <span style={column('color')} className="flex justify-center">
        <span
          aria-label={game.color ?? 'unknown colour'}
          title={game.color ?? undefined}
          className={cn(
            'size-[0.6875rem] rounded-full',
            game.color === 'white'
              ? 'bg-ink-2'
              : game.color === 'black'
                ? 'border border-edge-hover bg-selected'
                : 'border border-dashed border-faint',
          )}
        />
      </span>

      <span
        style={column('opening')}
        className="truncate font-sans text-[0.78125rem] text-body"
        title={[game.opening, game.eco].filter(Boolean).join(' · ') || undefined}
      >
        {game.opening ?? 'Unknown opening'}{' '}
        {game.eco ? <span className="font-mono text-dim">{game.eco}</span> : null}
      </span>

      <span
        style={column('result')}
        className={cn('text-center font-semibold', outcomeTone(game.outcome))}
      >
        {formatResult(game.result)}
      </span>

      <span style={column('time')} className="truncate text-soft">
        {formatTimeControl(game)}
      </span>

      <span style={column('moves')} className="text-right text-soft">
        {moveCount(game.ply_count)}
      </span>

      <span style={column('worst')} className={cn('text-right', dropTone(drop))}>
        {formatDrop(drop)}
      </span>

      <span style={column('source')}>
        <SourceBadge source={game.source} size="sm" />
      </span>

      <span style={column('tier')}>
        {tier ? (
          <TierBadge tier={tier} className="px-1.5 py-px text-[0.625rem]" />
        ) : (
          <UnanalysedBadge className="px-1.5 py-px text-[0.625rem]" />
        )}
      </span>

      <span style={column('flags')} className="flex items-center gap-1 overflow-hidden">
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
            className="text-[0.65625rem] text-accent-teal hover:text-accent-link disabled:text-dim"
          >
            {analysing ? 'queueing…' : 'analyse'}
          </button>
        )}
      </span>
    </div>
  )
})

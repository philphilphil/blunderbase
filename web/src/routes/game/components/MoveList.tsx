import { useEffect, useRef, useState } from 'react'

import { ClassificationBadge } from '@/components/badges/ClassificationBadge'
import type { Classification, MoveRow } from '@/lib/api/types'
import { GLYPHS, glyphFor, isFlagged } from '@/lib/chess/classification'
import { formatScore, formatWinLoss, type Score } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

import { plyLabel, type MovePair } from '../gameModel'

/** The inline note design 1a puts under a flagged move: what it cost and what was better. */
export interface MoveAnnotation {
  ply: number
  classification: Classification
  before: Score | null
  after: Score | null
  winLoss: number | null
  bestSan: string | null
}

export type MoveTab = 'moves' | 'flagged'

export interface MoveListProps {
  pairs: MovePair[]
  /** The ply last played; `-1` for the starting position. */
  cursor: number
  /** Move number through which the opening is folded away, or null. */
  collapsedThrough: number | null
  annotation: MoveAnnotation | null
  flaggedCount: number
  plyCount: number
  /** The game as PGN, for the tab row's export affordance. Built by `../pgn`. */
  pgn?: string
  onSelectPly: (ply: number) => void
  className?: string
}

/**
 * The paired move table from design 1a: a number column and two move cells, glyph badges
 * on anything the engine flagged, the opening folded behind a "moves 1–18 collapsed" rule,
 * and the moves after the cursor dimmed so the eye stops where the board is.
 *
 * The design's tab row is `Moves / Variations / Book`, with `PGN` pinned right. `PGN` is
 * here; the other two are not, and are not a matter of layout. A game carries one line —
 * `/games/{id}` sends a flat move list with no variation tree, and nothing in the API
 * accepts one — so a `Variations` tab would be an empty room. `Book` is a per-position
 * question the backend answers over `/explorer`, which is a screen of its own with a board
 * to walk; duplicating a slice of it under the move list would be a second, worse explorer.
 * The slot they leave carries `Flagged` instead: the game's mistakes, which is what the
 * whole screen is for and what the design's own eval graph and glyph badges point at.
 */
export function MoveList({
  pairs,
  cursor,
  collapsedThrough,
  annotation,
  flaggedCount,
  plyCount,
  pgn,
  onSelectPly,
  className,
}: MoveListProps) {
  const [tab, setTab] = useState<MoveTab>('moves')
  const [expanded, setExpanded] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const activeRow = useRef<HTMLDivElement>(null)

  const cursorMove = cursor < 0 ? 0 : Math.floor(cursor / 2) + 1
  // Stepping into the folded part of the game opens it rather than stranding the cursor.
  const cursorInFold =
    collapsedThrough !== null && cursor >= 0 && cursorMove <= collapsedThrough
  const folded = tab === 'moves' && collapsedThrough !== null && !expanded && !cursorInFold
  const rows = pairs.filter((pair) => {
    if (tab === 'flagged') {
      return isFlagged(pair.white?.classification) || isFlagged(pair.black?.classification)
    }
    return !folded || pair.moveNumber > collapsedThrough!
  })

  useEffect(() => {
    // Optional-called: jsdom does not implement it, and it is a nicety either way.
    activeRow.current?.scrollIntoView?.({ block: 'nearest' })
  }, [cursor, tab])

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex h-[2.375rem] flex-none items-stretch gap-0.5 border-b border-hairline px-3">
        <Tab active={tab === 'moves'} onClick={() => setTab('moves')}>
          Moves
        </Tab>
        <Tab active={tab === 'flagged'} onClick={() => setTab('flagged')}>
          Flagged
          {flaggedCount > 0 ? (
            <span className="ml-1.5 font-mono text-[0.625rem] tabular text-blunder">{flaggedCount}</span>
          ) : null}
        </Tab>
        <div className="flex-1" />
        <div className="flex items-center gap-2.5 font-mono text-[0.625rem] tabular text-faint">
          <span>{plyCount} plies</span>
          <PgnButton pgn={pgn} />
        </div>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto py-0.5">
        {folded ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex w-full items-center gap-2 px-3 pb-1 pt-2.5 text-left"
          >
            <div className="h-px flex-1 bg-hairline" />
            <span className="font-mono text-[0.625rem] text-faint hover:text-soft">
              moves 1–{collapsedThrough} collapsed
            </span>
            <div className="h-px flex-1 bg-hairline" />
          </button>
        ) : null}

        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-[0.71875rem] text-dim">
            {tab === 'flagged'
              ? 'Nothing flagged in this game.'
              : 'No moves — this game has an empty move list.'}
          </p>
        ) : null}

        <div className="flex flex-col px-1.5 font-mono text-[0.78125rem]">
          {rows.map((pair) => {
            const isActivePair =
              pair.white?.ply === cursor || pair.black?.ply === cursor
            const future = cursor >= 0 ? pair.moveNumber > cursorMove : pair.moveNumber > 0
            const annotated = annotation
              ? pair.white?.ply === annotation.ply || pair.black?.ply === annotation.ply
              : false
            return (
              <div key={pair.moveNumber} ref={isActivePair ? activeRow : undefined}>
                <div
                  className={cn(
                    'flex h-7 items-center rounded-[0.3125rem] px-1.5',
                    isActivePair ? 'bg-row-active' : 'hover:bg-raised',
                    future && !isActivePair && 'opacity-55 hover:opacity-100',
                  )}
                >
                  <span
                    className={cn(
                      'w-[1.875rem] tabular',
                      isActivePair ? 'text-dim' : 'text-faint',
                    )}
                  >
                    {pair.moveNumber}.
                  </span>
                  <MoveCell move={pair.white} cursor={cursor} onSelectPly={onSelectPly} />
                  <MoveCell move={pair.black} cursor={cursor} onSelectPly={onSelectPly} />
                </div>
                {annotated && annotation ? <Annotation annotation={annotation} /> : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * Design 1a's `PGN`, pinned to the right of the tab row. It copies rather than downloads:
 * the thing anyone wants a game's PGN for — pasting it into an analysis board, handing it
 * to the coach over MCP — starts with it on the clipboard.
 */
function PgnButton({ pgn }: { pgn?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current)
  }, [])

  if (!pgn) return null

  async function copy() {
    if (timer.current !== null) clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(pgn!)
      setState('copied')
    } catch {
      // No clipboard permission, or no clipboard at all (an insecure origin).
      setState('failed')
    }
    timer.current = setTimeout(() => setState('idle'), 1_600)
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title="Copy this game as PGN"
      className={cn(
        'transition-colors',
        state === 'copied'
          ? 'text-accent-teal'
          : state === 'failed'
            ? 'text-blunder'
            : 'text-faint hover:text-soft',
      )}
    >
      {state === 'copied' ? 'copied' : state === 'failed' ? 'no clipboard' : 'PGN'}
    </button>
  )
}

function MoveCell({
  move,
  cursor,
  onSelectPly,
}: {
  move: MoveRow | undefined
  cursor: number
  onSelectPly: (ply: number) => void
}) {
  if (!move?.san) return <span className="flex-1 px-1" />
  const glyph = glyphFor(move.classification)
  const flagged = isFlagged(move.classification)
  const active = move.ply === cursor

  return (
    <button
      type="button"
      onClick={() => onSelectPly(move.ply)}
      title={`${plyLabel(move.ply)}${move.san}`}
      className={cn(
        'flex h-5 flex-1 items-center gap-[0.3125rem] rounded-[0.25rem] px-1 text-left',
        active
          ? 'bg-accent-teal/10 text-bright shadow-[inset_0_0_0_0.0625rem_color-mix(in_srgb,var(--bb-accent)_55%,transparent)]'
          : flagged
            ? cn(GLYPHS[glyph!].textClass, 'font-medium hover:text-bright')
            : 'text-body hover:text-bright',
      )}
    >
      <span className="truncate">{move.san}</span>
      <ClassificationBadge classification={move.classification} size="md" />
    </button>
  )
}

/** The italic aside under a flagged move: the swing it cost and the move that beat it. */
function Annotation({ annotation }: { annotation: MoveAnnotation }) {
  const glyph = glyphFor(annotation.classification)
  const color = glyph ? GLYPHS[glyph].color : 'var(--bb-blunder)'
  return (
    <div className="flex gap-2 py-1.5 pl-[2.625rem] pr-2 font-sans text-[0.71875rem] italic leading-[1.5] text-soft-2">
      <div className="w-0.5 flex-none rounded-sm opacity-50" style={{ background: color }} />
      <div>
        {annotation.bestSan ? (
          <>
            <span className="not-italic">Best was </span>
            <span className="font-mono not-italic text-ink">{annotation.bestSan}</span>
            <span className="not-italic">. </span>
          </>
        ) : null}
        {annotation.before || annotation.after ? (
          <span className="font-mono tabular not-italic text-dim">
            {formatScore(annotation.before)} →{' '}
            <span style={{ color }}>{formatScore(annotation.after)}</span>
          </span>
        ) : null}
        {annotation.winLoss !== null ? (
          <span className="font-mono tabular not-italic text-dim">
            {' '}
            (<span style={{ color }}>{formatWinLoss(annotation.winLoss)}</span> win)
          </span>
        ) : null}
      </div>
    </div>
  )
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center px-2.5 text-xs',
        active
          ? 'font-medium text-ink shadow-[inset_0_-0.125rem_0_var(--bb-accent)]'
          : 'text-dim hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

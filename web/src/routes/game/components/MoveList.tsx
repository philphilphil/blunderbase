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

/**
 * One line in the table, drawn inline under the move it hangs off.
 *
 * Every line the session has walked is here, in the order they were walked, and the one the
 * board is standing in is among them rather than pulled out in front of them: `cursor` says
 * how far into it the board is, and null says the board is not in this line at all — a line
 * to look at, and to click back into.
 */
export interface MoveListVariation {
  /**
   * The kept entry (`../sessionVariations`) this row stands for, or null for a line the
   * store has not been handed yet. It is what a click on a line the board has left names.
   */
  id: number | null
  /** The number of game plies the line branches from — its first move is ply `base`. */
  base: number
  /** The line in SAN, whole, however far into it the board currently is. */
  sans: string[]
  /**
   * How many of its moves are on the board — `0` is the position it branched from — or null
   * where the board is somewhere else entirely.
   */
  cursor: number | null
}

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
  /**
   * The session's lines, drawn inline under the moves they hang off, oldest first — the one
   * the board is standing in included, in the place its age gives it.
   */
  variations?: readonly MoveListVariation[]
  /** Put the board after the `index`-th move of the line it is standing in (0-based). */
  onSelectVariationMove?: (index: number) => void
  /** Walk back into kept line `id`, standing after its `index`-th move (0-based). */
  onSelectKeptMove?: (id: number, index: number) => void
  onSelectPly: (ply: number) => void
  className?: string
}

/**
 * The paired move table from design 1a: a number column and two move cells, glyph badges
 * on anything the engine flagged, the opening folded behind a "moves 1–18 collapsed" rule,
 * and the moves after the cursor dimmed so the eye stops where the board is.
 *
 * A clicked engine line or Maia rollout is drawn inline as an indented variation under the
 * move it branches from, walkable move by move, and stays listed there for the rest of the
 * session once the board has left it — a shade quieter, with nothing lit — so the table
 * remembers the reading rather than only the last detour. `variations` holds them all in
 * one order, oldest first: a line keeps its place when the board walks back into it, and
 * only the styling and the lit move move.
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
  variations,
  onSelectVariationMove,
  onSelectKeptMove,
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

  // Every line on screen, in the order it was handed over — which is the order they were
  // walked. A line's place is its age and nothing else: walking back into one lights it and
  // hands it the cursor where it stands, rather than lifting it to the front of its stack.
  const lines: { anchor: number | null; node: React.ReactNode }[] = []
  for (const entry of variations ?? []) {
    const id = entry.id
    const walking = entry.cursor !== null
    lines.push({
      anchor: anchorOf(entry.base),
      node: (
        <Variation
          key={id === null ? 'active' : `kept-${id}`}
          variation={{ base: entry.base, sans: entry.sans, cursor: entry.cursor ?? 0 }}
          quiet={!walking}
          onSelectMove={
            walking
              ? onSelectVariationMove
              : onSelectKeptMove && id !== null
                ? (index) => onSelectKeptMove(id, index)
                : undefined
          }
        />
      ),
    })
  }

  // A line whose anchor is filtered away by the fold or the `Flagged` tab has no move on
  // screen to hang under, and one off the starting position never had one; either way it
  // goes to the top of the list rather than disappearing with its anchor.
  const shown = new Set(rows.map((pair) => pair.moveNumber))
  const orphans: React.ReactNode[] = []
  const anchored = new Map<number, React.ReactNode[]>()
  for (const line of lines) {
    if (line.anchor === null || !shown.has(line.anchor)) {
      orphans.push(line.node)
      continue
    }
    const group = anchored.get(line.anchor)
    if (group) group.push(line.node)
    else anchored.set(line.anchor, [line.node])
  }

  // The line the board is standing in, if any — the one whose walk the scroller follows.
  const walked = (variations ?? []).find((entry) => entry.cursor !== null)

  // Keep the cursor's row in view *inside this box*. `scrollIntoView` would do it by
  // scrolling every scrollable ancestor as well — on this page that means the studio's own
  // columns and the window, so stepping through a game dragged the whole screen about.
  // The scroller is the row's offset parent (it is `relative`), so the arithmetic is local.
  useEffect(() => {
    const box = scroller.current
    const row = activeRow.current
    if (!box || !row) return
    const top = row.offsetTop
    const bottom = top + row.offsetHeight
    if (top < box.scrollTop) box.scrollTop = top
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight
    // Walking a variation moves nothing in the table, but the row it hangs off — which is
    // the row it is drawn under — is what has to stay in view while it does.
  }, [cursor, tab, walked?.cursor, walked?.sans.length])

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

      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto py-0.5">
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
          {orphans}
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
                {anchored.get(pair.moveNumber)}
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

/** The move a line hangs off — the one that produced the position it left from. */
function anchorOf(base: number): number | null {
  return base > 0 ? Math.floor((base - 1) / 2) + 1 : null
}

/**
 * An analysis line, indented under the move it branches from and parenthesised the way a
 * variation is written on paper. Every move is a click that puts the board after it, and the
 * one the board is on is lit — walking the line with the wheel or the arrow keys moves this
 * mark along, which is the whole point of keeping the line rather than the position.
 *
 * A line the board has left (`quiet`) is the same row a shade further back: nothing lit,
 * because the board is not in it, and dimmer text, because it is the reading behind the
 * reader rather than the thing they are looking at. It is still every bit as clickable —
 * that click is how they walk back into it.
 */
function Variation({
  variation,
  quiet,
  onSelectMove,
}: {
  /** The line, and how many of its moves the board is standing past (`0` while quiet). */
  variation: { base: number; sans: string[]; cursor: number }
  quiet?: boolean
  onSelectMove?: (index: number) => void
}) {
  return (
    <div
      data-testid={quiet ? 'kept-variation' : 'move-variation'}
      className="flex gap-2 py-1 pl-[2.625rem] pr-2 font-mono text-[0.6875rem] leading-[1.5]"
    >
      <div
        className={cn('w-0.5 flex-none rounded-sm bg-brilliant', quiet ? 'opacity-20' : 'opacity-40')}
      />
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1 gap-y-0.5">
        <span className={quiet ? 'text-faint-2' : 'text-faint'}>(</span>
        {variation.sans.map((san, index) => {
          const ply = variation.base + index
          const active = !quiet && variation.cursor === index + 1
          return (
            <span key={`${index}-${san}`} className="inline-flex items-baseline gap-1">
              {ply % 2 === 0 || index === 0 ? (
                <span className={cn('tabular', quiet ? 'text-faint-2' : 'text-faint')}>
                  {Math.floor(ply / 2) + 1}
                  {ply % 2 === 0 ? '.' : '…'}
                </span>
              ) : null}
              <button
                type="button"
                disabled={!onSelectMove}
                onClick={() => onSelectMove?.(index)}
                title={`${plyLabel(ply)}${san} — ${quiet ? 'kept line' : 'analysis'}`}
                className={cn(
                  'rounded-[0.1875rem] px-0.5',
                  active
                    ? 'bg-brilliant/15 text-bright'
                    : quiet
                      ? cn('text-dim-3', onSelectMove && 'hover:text-ink')
                      : onSelectMove
                        ? 'text-soft-2 hover:text-ink'
                        : 'text-soft-2',
                )}
              >
                {san}
              </button>
            </span>
          )
        })}
        <span className={quiet ? 'text-faint-2' : 'text-faint'}>)</span>
      </div>
    </div>
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

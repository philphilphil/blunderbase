import { Pin, PinOff } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { ClassificationBadge } from '@/components/badges/ClassificationBadge'
import type { Classification, MoveRow } from '@/lib/api/types'
import { GLYPHS, glyphFor, isFlagged } from '@/lib/chess/classification'
import { formatScore, formatWinLoss, type Score } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

import { plyLabel, type MovePair } from '../gameModel'

/**
 * The inline note design 1a puts under a flagged move: what it cost and what was better.
 *
 * It carries the move it is about — `san`, and `ply` for the number to print in front of
 * it. The note hangs under a *pair* row, which is two moves wide, so without naming its
 * move a note under `12. e4 Nf6` says nothing about which of the two it is complaining
 * about; readers took a note about White's move for one about Black's and the other way
 * round. Now the note opens with `12… Nf6??` and there is nothing left to guess.
 */
export interface MoveAnnotation {
  ply: number
  san: string | null
  classification: Classification
  before: Score | null
  after: Score | null
  winLoss: number | null
  bestSan: string | null
}

/**
 * Two tabs, not three. `Notes` used to live here because the desktop column was the only
 * place a note could be read; it now has a standing track of its own beside this one at
 * every width down to the phone, so a tab would be a second door into an open room.
 */
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
  /**
   * The pinned line (`POST /lines`) this row stands for, where the server holds it. Null
   * for a line that only this session knows about.
   */
  lineId?: number | null
  /** The number of game plies the line branches from — its first move is ply `base`. */
  base: number
  /** The line in SAN, whole, however far into it the board currently is. */
  sans: string[]
  /**
   * The same line in UCI. Nothing in the table reads it — it rides along so that a click on
   * the pin affordance can name the line to keep without the page having to look it up
   * again by shape.
   */
  moves?: readonly string[]
  /**
   * How many of its moves are on the board — `0` is the position it branched from — or null
   * where the board is somewhere else entirely.
   */
  cursor: number | null
  /**
   * How many of `sans` are actually pinned. `0` is "not pinned at all"; a number short of
   * `sans.length` is "pinned, and since walked further", which the pin affordance offers to
   * extend rather than to undo.
   */
  pinnedThrough?: number
  /** Indices into `sans` that carry a note, drawn as a mark on that move. */
  noted?: readonly number[]
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
  /** The same, for a line only the server holds — one this session has never walked. */
  onSelectLineMove?: (lineId: number, index: number) => void
  /** Pin a variation, or extend a pin the walk has grown past. Hidden without it. */
  onPinVariation?: (variation: MoveListVariation) => void
  /** Unpin a variation the server holds. */
  onUnpinVariation?: (lineId: number) => void
  onSelectPly: (ply: number) => void
  /** Mainline move indices that carry a note (`notesModel.notedMoveIndices`). */
  notedMoves?: ReadonlySet<number>
  /**
   * The open tab, where the caller owns it. Undefined leaves the table in charge of its
   * own, which is what the desktop column does and has always done. The phone layout
   * promotes these tabs into a strip of its own that also holds Eval, Engine and Notes,
   * so there the tab is page state and this table is told which one to draw.
   */
  tab?: MoveTab
  /** Fires on a click in the tab row — meaningless while `showTabRow` is false. */
  onTabChange?: (tab: MoveTab) => void
  /**
   * Draw the tab row. False where the caller draws the tabs itself; the PGN affordance
   * lives in that row, so a caller that switches it off has to place `PgnButton` somewhere
   * of its own.
   */
  showTabRow?: boolean
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
 * A clock column follows each move where the game was played with one, quiet and mono, and
 * turns `--bb-mistake` under twenty seconds: in a 3+2 blitz game time trouble is what
 * explains the late blunders, and putting the two in the same row lets that correlation be
 * read straight off the table instead of captioned under it.
 *
 * The design's tab row is `Moves / Variations / Book`, with `PGN` pinned right. `PGN` is
 * here; the other two are not, and are not a matter of layout. A game carries one line —
 * `/games/{id}` sends a flat move list with no variation tree, and nothing in the API
 * accepts one — so a `Variations` tab would be an empty room. `Book` is a per-position
 * question, and it now has a pane of its own in the track beside this one. The slot they
 * leave carries `Flagged`: the game's mistakes, which is what the whole screen is for and
 * what the design's own eval graph and glyph badges point at.
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
  onSelectLineMove,
  onPinVariation,
  onUnpinVariation,
  onSelectPly,
  notedMoves,
  tab: openTab,
  onTabChange,
  showTabRow = true,
  className,
}: MoveListProps) {
  // Uncontrolled by default — the desktop column has never had anywhere else to put these
  // tabs. `openTab` takes over where a caller draws the strip itself; the internal state is
  // still kept in step, so handing control back would not jump the table to another tab.
  const [ownTab, setOwnTab] = useState<MoveTab>('moves')
  const tab = openTab ?? ownTab
  const setTab = (next: MoveTab) => {
    setOwnTab(next)
    onTabChange?.(next)
  }
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

  // Built off every pair, not the filtered ones: a reading belongs to the move two plies
  // after the one that produced it, and the fold or the `Flagged` tab may well have taken
  // that earlier move off screen.
  const clocks = useMemo(() => clocksBeforeMove(pairs), [pairs])

  // Every line on screen, in the order it was handed over — which is the order they were
  // walked. A line's place is its age and nothing else: walking back into one lights it and
  // hands it the cursor where it stands, rather than lifting it to the front of its stack.
  const lines: { anchor: number | null; node: React.ReactNode }[] = []
  for (const entry of variations ?? []) {
    const id = entry.id
    const lineId = entry.lineId ?? null
    const walking = entry.cursor !== null
    lines.push({
      anchor: anchorOf(entry.base),
      node: (
        <Variation
          key={id !== null ? `kept-${id}` : lineId !== null ? `line-${lineId}` : 'active'}
          variation={entry}
          quiet={!walking}
          onSelectMove={
            walking
              ? onSelectVariationMove
              : onSelectKeptMove && id !== null
                ? (index) => onSelectKeptMove(id, index)
                : onSelectLineMove && lineId !== null
                  ? (index) => onSelectLineMove(lineId, index)
                  : undefined
          }
          onPin={onPinVariation}
          onUnpin={onUnpinVariation}
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
    <div data-testid="move-list" className={cn('flex min-h-0 flex-col', className)}>
      {showTabRow ? (
      <div className="flex h-[2.1875rem] flex-none items-stretch border-b border-line bg-panel pr-2.5">
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
        {/*
          `flex-none`, so whatever else this row has to give up, the PGN affordance is never
          the thing that gets clipped off the right edge.

          The ply total goes below `md`: the tabs, a count and this pair do not fit across a
          375px screen, and of everything here it is the one thing said elsewhere — the
          phone's own header carries `ply 34/91`. The phone layout switches this whole row
          off (`showTabRow`) and draws its own strip, so this only bites a narrow desktop
          window; it is kept because that window is real and a clipped PGN button is not
          worth the two words.
        */}
        <div className="flex flex-none items-center gap-2.5 whitespace-nowrap font-mono text-[0.625rem] tabular text-faint">
          <span className="max-md:hidden">{plyCount} plies</span>
          <PgnButton pgn={pgn} />
        </div>
      </div>
      ) : null}

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
            const annotated = annotation
              ? pair.white?.ply === annotation.ply || pair.black?.ply === annotation.ply
              : false
            return (
              <div key={pair.moveNumber} ref={isActivePair ? activeRow : undefined}>
                <div
                  className={cn(
                    'flex h-7 items-center rounded-[0.3125rem] px-1.5',
                    isActivePair ? 'bg-row-active' : 'hover:bg-raised',
                  )}
                >
                  <span
                    className={cn('w-[2rem] flex-none tabular', isActivePair ? 'text-dim' : 'text-faint')}
                  >
                    {pair.moveNumber}.
                  </span>
                  <MoveCell
                    move={pair.white}
                    cursor={cursor}
                    noted={pair.white ? notedMoves?.has(pair.white.ply) : false}
                    onSelectPly={onSelectPly}
                  />
                  {clocks ? <ClockCell seconds={clocks.get(pair.white?.ply ?? -1)} /> : null}
                  <MoveCell
                    move={pair.black}
                    cursor={cursor}
                    noted={pair.black ? notedMoves?.has(pair.black.ply) : false}
                    onSelectPly={onSelectPly}
                  />
                  {clocks ? <ClockCell seconds={clocks.get(pair.black?.ply ?? -1)} /> : null}
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
 * What each mover had left on their clock *before* they played, keyed by the ply that
 * shows it — or null where this game was played without one.
 *
 * The payload's `MoveRow.clock` is the reading *after* that ply, but the number worth
 * putting beside a move is what its mover had when they sat down to choose it: their own
 * previous reading, two plies back. `backend/services/stats.py:_remaining_clock` builds
 * the app's whole time-trouble statistic on exactly that `ply - 2`, so matching it here is
 * what keeps a `0:19` in this table and a `<20s` blunder on the Stats page meaning the
 * same thing.
 *
 * Plies 0 and 1 have no previous reading of their own — `_remaining_clock` falls back to
 * the game's initial time there, which a move row does not carry — so they stay blank.
 * Null for a game with no readings at all: an empty column of dashes down the table would
 * cost the two move cells their width and say nothing.
 */
function clocksBeforeMove(pairs: MovePair[]): Map<number, number> | null {
  const before = new Map<number, number>()
  for (const pair of pairs) {
    for (const move of [pair.white, pair.black]) {
      if (move?.clock === null || move?.clock === undefined) continue
      before.set(move.ply + 2, move.clock)
    }
  }
  return before.size > 0 ? before : null
}

/** `139` -> `2:19`, the way a clock reads on the board. Negative or absent shows nothing. */
function formatRemaining(seconds: number | undefined): string {
  if (seconds === undefined || seconds < 0) return ''
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Under twenty seconds is time trouble — the band the late blunders fall in. */
const TIME_TROUBLE = 20

/**
 * One clock reading, right-aligned against the move it belongs to and a size smaller than
 * the move, because it is context and not the thing being read.
 *
 * `--bb-mistake` under twenty seconds, so a run of orange down the last ten rows sits
 * beside the run of `??` badges that shares a cause. The cell keeps its width when there
 * is nothing to show, so the column stays a column and the move cells do not jump.
 */
function ClockCell({ seconds }: { seconds: number | undefined }) {
  const low = seconds !== undefined && seconds >= 0 && seconds < TIME_TROUBLE
  return (
    <span
      data-testid="move-clock"
      className={cn(
        'w-[2.25rem] flex-none pr-1.5 text-right text-[0.65625rem] tabular',
        low ? 'text-mistake' : 'text-faint',
      )}
    >
      {formatRemaining(seconds)}
    </span>
  )
}

/**
 * Design 1a's `PGN`, pinned to the right of the tab row. It copies rather than downloads:
 * the thing anyone wants a game's PGN for — pasting it into an analysis board, handing it
 * to the coach over MCP — starts with it on the clipboard.
 */
/**
 * The one PGN button on the screen, named so a key can press it.
 *
 * `c` copies the game, and it does it by pressing this rather than by copying the text a
 * second time somewhere else: the button owns the clipboard call *and* the copied/failed
 * flash that says it worked, and a second path would be a second answer to "did that
 * work". Exactly one of these is mounted at any width — the tab row's, or the phone
 * header's.
 */
export const PGN_BUTTON_ID = 'game-pgn-copy'

/**
 * Copy the whole game as PGN. Exported because the tab row it normally sits in is switched
 * off below `md` (`showTabRow`), and the phone layout has to put it somewhere of its own.
 */
export function PgnButton({ pgn }: { pgn?: string }) {
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
      id={PGN_BUTTON_ID}
      onClick={() => void copy()}
      title="Copy this game as PGN (C)"
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
  noted,
  onSelectPly,
}: {
  move: MoveRow | undefined
  cursor: number
  /** A note hangs on the position this move produced — marked, not spelled out. */
  noted?: boolean
  onSelectPly: (ply: number) => void
}) {
  if (!move?.san) return <span className="min-w-0 flex-1 px-1" />
  const glyph = glyphFor(move.classification)
  const flagged = isFlagged(move.classification)
  const active = move.ply === cursor

  return (
    <button
      type="button"
      onClick={() => onSelectPly(move.ply)}
      title={`${plyLabel(move.ply)}${move.san}${noted ? ' — noted' : ''}`}
      className={cn(
        // `min-w-0` so the row can never push past the track: at the 250px band the two
        // move cells are what has to give, and the san truncates rather than the number,
        // the clock or the glyph badge being shoved off the right edge.
        'flex h-5 min-w-0 flex-1 items-center gap-[0.3125rem] rounded-[0.25rem] px-1 text-left',
        active
          ? 'bg-accent-teal/10 text-bright shadow-[inset_0_0_0_0.0625rem_color-mix(in_srgb,var(--bb-accent)_55%,transparent)]'
          : flagged
            ? cn(GLYPHS[glyph!].textClass, 'font-medium hover:text-bright')
            : 'text-body hover:text-bright',
      )}
    >
      <span className="truncate">{move.san}</span>
      <ClassificationBadge classification={move.classification} size="md" />
      {noted ? <NoteMark /> : null}
    </button>
  )
}

/**
 * "Something is written about this position" — the note sheet, outlined, at nine design
 * pixels.
 *
 * It replaces the dot this used to be. A dot was the smallest mark that could be seen at
 * all, but it read as another status pip beside the glyph badge; a page with a fold and two
 * ruled lines says *what* it is at the same size, which is what makes a noted move findable
 * from the table rather than only from the notes track. Teal, not a classification colour,
 * because a note is the reader's own mark and not the engine's verdict — and outlined, not
 * filled, so it stays quieter than the badge sitting next to it.
 */
function NoteMark() {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-[0.5625rem] flex-none text-accent-teal opacity-85"
    >
      <path d="M2.6 1.6h4.6L9.4 3.8v6.6H2.6z" />
      <path d="M4.3 5.6h3.4M4.3 7.6h2.2" />
    </svg>
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
  onPin,
  onUnpin,
}: {
  /** The line, and how many of its moves the board is standing past (`0` while quiet). */
  variation: MoveListVariation
  quiet?: boolean
  onSelectMove?: (index: number) => void
  onPin?: (variation: MoveListVariation) => void
  onUnpin?: (lineId: number) => void
}) {
  const cursor = variation.cursor ?? 0
  const lineId = variation.lineId ?? null
  const pinnedThrough = variation.pinnedThrough ?? 0
  const noted = new Set(variation.noted ?? [])

  return (
    <div
      data-testid={quiet ? 'kept-variation' : 'move-variation'}
      data-pinned={lineId !== null ? 'true' : undefined}
      className="group/line flex gap-2 py-1 pl-[2.625rem] pr-2 font-mono text-[0.6875rem] leading-[1.5]"
    >
      {/*
        The rail is what says at a glance whether a line is only today's reading or something
        the owner decided to keep: a pinned line's rail is solid, a session line's is the
        same hairline it has always been. Nothing else about the row changes, because a
        pinned line is read exactly like an unpinned one.
      */}
      <div
        className={cn(
          'w-0.5 flex-none rounded-sm bg-brilliant',
          lineId !== null ? (quiet ? 'opacity-60' : 'opacity-90') : quiet ? 'opacity-20' : 'opacity-40',
        )}
      />
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1 gap-y-0.5">
        <span className={quiet ? 'text-faint-2' : 'text-faint'}>(</span>
        {variation.sans.map((san, index) => {
          const ply = variation.base + index
          const active = !quiet && cursor === index + 1
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
                title={`${plyLabel(ply)}${san} — ${quiet ? 'kept line' : 'analysis'}${noted.has(index) ? ', noted' : ''}`}
                className={cn(
                  'inline-flex items-center gap-0.5 rounded-[0.1875rem] px-0.5',
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
                {noted.has(index) ? <NoteMark /> : null}
              </button>
            </span>
          )
        })}
        <span className={quiet ? 'text-faint-2' : 'text-faint'}>)</span>
        <PinButton
          variation={variation}
          lineId={lineId}
          pinnedThrough={pinnedThrough}
          onPin={onPin}
          onUnpin={onUnpin}
        />
      </div>
    </div>
  )
}

/**
 * Keep this line, or stop keeping it — the one affordance that turns a session's reading
 * into something the database holds.
 *
 * Three states, because there are three things a line can be. Unpinned offers the pin.
 * Pinned offers to take it back. And pinned-but-since-extended offers the pin again, which
 * the backend's own prefix rule turns into "the same row, longer" rather than a second line
 * — so "extend" needs no endpoint of its own, only a button that says what it does.
 */
function PinButton({
  variation,
  lineId,
  pinnedThrough,
  onPin,
  onUnpin,
}: {
  variation: MoveListVariation
  lineId: number | null
  pinnedThrough: number
  onPin?: (variation: MoveListVariation) => void
  onUnpin?: (lineId: number) => void
}) {
  const pinned = lineId !== null
  const extendable = pinned && pinnedThrough < variation.sans.length

  if (pinned && !extendable) {
    if (!onUnpin) return null
    return (
      <button
        type="button"
        onClick={() => onUnpin(lineId)}
        aria-label="Unpin this line"
        title="Stop keeping this line"
        className="ml-0.5 text-brilliant/70 hover:text-blunder"
      >
        <PinOff className="size-2.5" aria-hidden />
      </button>
    )
  }

  if (!onPin) return null
  return (
    <button
      type="button"
      onClick={() => onPin(variation)}
      aria-label={extendable ? 'Extend the pin to the whole line' : 'Pin this line'}
      title={
        extendable
          ? 'Kept only as far as its first moves — pin the rest'
          : 'Keep this line with the game'
      }
      className={cn(
        'ml-0.5 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/line:opacity-100',
        extendable ? 'text-brilliant/70 hover:text-brilliant' : 'text-faint hover:text-brilliant',
      )}
    >
      <Pin className="size-2.5" aria-hidden />
    </button>
  )
}

/** The italic aside under a flagged move: which move, the swing it cost, and what beat it. */
function Annotation({ annotation }: { annotation: MoveAnnotation }) {
  const glyph = glyphFor(annotation.classification)
  const color = glyph ? GLYPHS[glyph].color : 'var(--bb-blunder)'
  return (
    <div className="flex gap-2 py-1.5 pl-[2.625rem] pr-2 font-sans text-[0.71875rem] italic leading-[1.5] text-soft-2">
      <div className="w-0.5 flex-none rounded-sm opacity-50" style={{ background: color }} />
      <div>
        {/* Whose move this is about, first and in the move list's own mono, so the note is
            read as belonging to one half of the pair above it rather than to the row. */}
        {annotation.san ? (
          <span className="font-mono not-italic" style={{ color }}>
            {plyLabel(annotation.ply)} {annotation.san}
            {glyph ? GLYPHS[glyph].glyph : ''}{' '}
          </span>
        ) : null}
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
      // A pressed button rather than a `role="tab"`: these two switch what the pane below
      // filters to, and there is no tablist here for a tab to belong to. Which one is on is
      // said out loud either way — it is drawn as chrome, and chrome is invisible to a
      // reader who is being read to.
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        // The selected tab is the pane's own surface pushed up into the chrome strip, with
        // its own sliver of that surface laid over the strip's bottom rule — so the tab and
        // the pane under it read as one region, the way a desktop tool draws a tab. That is
        // a stronger and quieter signal than the accent underline it replaces, and it costs
        // the strip no colour at all.
        'relative flex items-center px-3 text-xs transition-colors',
        active
          ? 'bg-surface font-medium text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-surface'
          : 'text-dim hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

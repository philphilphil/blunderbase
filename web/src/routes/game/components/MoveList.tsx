import { Trans, useLingui } from '@lingui/react/macro'
import { Check, Copy, Pin, PinOff, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { ClassificationBadge } from '@/components/badges/ClassificationBadge'
import { ROW_CURSOR } from '@/components/ui/row'
import type { Classification, MoveRow } from '@/lib/api/types'
import { GLYPHS, glyphFor, isFlagged } from '@/lib/chess/classification'
import { formatScore, formatWinLoss, type Score } from '@/lib/chess/evaluation'
import { useNotation } from '@/lib/chess/notationPrefs'
import { cn } from '@/lib/utils'

import { formatRemaining, moveNumberOf, type MovePair } from '../gameModel'
import { usePlyLabel, usePlyNumbering, usePlyOffset } from '../plyNumbering'
import { PANE_TOOL, STRIP_FACTS, STRIP_RULE, TAB_ROW } from './paneTabs'

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
  plyCount: number
  /** The game as PGN, for the title strip's export affordance. Built by `../pgn`. */
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
   * Draw the title strip. False where the caller draws a strip of its own — the phone does,
   * and since the PGN affordance lives in this one, it has to place `PgnButton` itself.
   */
  showTitleStrip?: boolean
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
 * A clock column follows each move where the game was played with one — the clock as it
 * read when the move was played, the way Lichess and chess.com print it — quiet and mono,
 * and turning `--bb-mistake` under twenty seconds: in a 3+2 blitz game time trouble is
 * what explains the late blunders, and putting the two in the same row lets that
 * correlation be read straight off the table instead of captioned under it.
 *
 * The pane wears a title strip, not tabs. The design's row was `Moves / Variations / Book`;
 * variations are drawn inline here and Book has a pane of its own. A `Flagged` tab filled
 * the slot for a while and was removed (#45): it said nothing the glyph badges, the eval
 * graph's marks and ↑/↓ do not already say, and a filtered copy of the list is a second
 * place to look for the same moves.
 */
export function MoveList({
  pairs,
  cursor,
  collapsedThrough,
  annotation,
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
  showTitleStrip = true,
  className,
}: MoveListProps) {
  const [expanded, setExpanded] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const activeRow = useRef<HTMLDivElement>(null)

  const offset = usePlyOffset()
  const cursorMove = cursor < 0 ? 0 : moveNumberOf(cursor, offset)
  // Stepping into the folded part of the game opens it rather than stranding the cursor.
  const cursorInFold =
    collapsedThrough !== null && cursor >= 0 && cursorMove <= collapsedThrough
  const folded = collapsedThrough !== null && !expanded && !cursorInFold
  const rows = pairs.filter((pair) => !folded || pair.moveNumber > collapsedThrough!)

  // Built off every pair, not the shown ones: a reading belongs to the move two plies after
  // the one that produced it, and the fold may well have taken that earlier move off screen.
  const clocks = useMemo(() => clocksAtMove(pairs), [pairs])

  // Every line on screen, in the order it was handed over — which is the order they were
  // walked. A line's place is its age and nothing else: walking back into one lights it and
  // hands it the cursor where it stands, rather than lifting it to the front of its stack.
  const lines: { anchor: number | null; node: React.ReactNode }[] = []
  for (const entry of variations ?? []) {
    const id = entry.id
    const lineId = entry.lineId ?? null
    const walking = entry.cursor !== null
    lines.push({
      anchor: anchorOf(entry.base, offset),
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

  // A line whose anchor is folded away has no move on screen to hang under, and one off the
  // starting position never had one; either way it goes to the top of the list rather than
  // disappearing with its anchor.
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
  }, [cursor, walked?.cursor, walked?.sans.length])

  return (
    <div data-testid="move-list" className={cn('flex min-h-0 flex-col', className)}>
      {showTitleStrip ? (
      // `@container` on top of the shared strip: the ply count below hides by this row's own
      // width, which only a container query can read.
      <div className={cn(TAB_ROW, '@container')}>
        {/* A plain title where a tab would stand, in a tab's own type and inset so the strip
            lines up with the tabbed strips around it — not a tablist of one, which would
            announce a choice there is none of. */}
        <h2 className="flex items-center px-3 text-data font-medium text-ink">
          <Trans>Moves</Trans>
        </h2>
        <div className="flex-1" />
        {/*
          The strip's order is title │ facts │ tools. `flex-none`, so whatever else this row
          has to give up, the PGN tool is never the thing that gets clipped off the right edge.

          The ply total goes below `md`: of everything here it is the one thing said
          elsewhere — the phone's own header carries `ply 34/91`. The phone layout switches
          this whole strip off (`showTitleStrip`) and draws its own strip, so this only bites a
          narrow desktop window; it is kept because that window is real and a clipped PGN
          button is not worth the two words.
        */}
        <div className="flex flex-none items-center gap-2 whitespace-nowrap">
          {/* And on a desktop whose track is at its 15.625rem floor, by the row's own width:
              German's "Halbzüge" is longer than the word this was fitted to. */}
          <span className={cn(STRIP_FACTS, 'font-mono max-md:hidden @max-[16.5rem]:hidden')}>
            <Trans>{plyCount} plies</Trans>
          </span>
          {pgn ? <span aria-hidden className={STRIP_RULE} /> : null}
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
            <span className="text-label text-dim hover:text-soft">
              <Trans>moves 1–{collapsedThrough} collapsed</Trans>
            </span>
            <div className="h-px flex-1 bg-hairline" />
          </button>
        ) : null}

        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-data text-dim">
            <Trans>No moves — this game has an empty move list.</Trans>
          </p>
        ) : null}

        <div className="flex flex-col px-1.5 font-mono text-lead">
          {orphans}
          {rows.map((pair) => {
            const isActivePair =
              pair.white?.ply === cursor || pair.black?.ply === cursor
            const annotated = annotation
              ? pair.white?.ply === annotation.ply || pair.black?.ply === annotation.ply
              : false
            return (
              <div key={pair.moveNumber} ref={isActivePair ? activeRow : undefined}>
                {/* The pair under the cursor is `row-active` plus the inset accent bar
                    (`ROW_CURSOR`): the tint alone sat 1.1:1 off the pane, and the bar makes
                    the row findable at a glance without competing with the current move's
                    own blue. */}
                <div
                  className={cn(
                    'flex h-7 items-center rounded-md px-1.5',
                    isActivePair ? ROW_CURSOR : 'hover:bg-raised',
                  )}
                >
                  <span
                    className={cn('w-[2rem] flex-none tabular', isActivePair ? 'text-dim' : 'text-dim-2')}
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
 * What the clock read when each move was played, keyed by ply — or null where this game
 * was played without one.
 *
 * The payload's `MoveRow.clock` is the source's own reading after that ply, the `%clk`
 * Lichess and chess.com print beside the move, and it is shown as it is. It used to be
 * shifted two plies — what the mover had when they sat down to choose the move — which
 * answered a better question and matched nothing anyone had seen: a reader who knew the
 * game from Lichess read 10:00 here where they remembered 9:48, and the move-time plot's
 * 26-second bar beside a 10:00 looked like an error. `backend/services/stats.py`'s
 * `_remaining_clock` reads the same ply, so a `0:19` in this table and a `<20s` blunder
 * on the Stats page are still the same number.
 *
 * Null for a game with no readings at all: an empty column of dashes down the table would
 * cost the two move cells their width and say nothing.
 */
function clocksAtMove(pairs: MovePair[]): Map<number, number> | null {
  const at = new Map<number, number>()
  for (const pair of pairs) {
    for (const move of [pair.white, pair.black]) {
      if (move?.clock === null || move?.clock === undefined) continue
      at.set(move.ply, move.clock)
    }
  }
  return at.size > 0 ? at : null
}

/** Under twenty seconds is time trouble — the band the late blunders fall in. */
const TIME_TROUBLE = 20

/**
 * One clock reading, right-aligned against the move it belongs to and a size smaller than
 * the move, because it is context and not the thing being read. Context, but still data:
 * `dim-2`, the quietest step that clears AA, rather than `faint`, which is kept for marks
 * nobody has to read.
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
        'w-[2.25rem] flex-none pr-1.5 text-right text-label tabular',
        low ? 'text-mistake' : 'text-dim-2',
      )}
    >
      {formatRemaining(seconds)}
    </span>
  )
}

/**
 * Design 1a's `PGN`, pinned to the right of the title strip. It copies rather than downloads:
 * the thing anyone wants a game's PGN for — pasting it into an analysis board, handing it
 * to your assistant over MCP — starts with it on the clipboard.
 *
 * The one PGN button on the screen, named so a key can press it.
 *
 * `c` copies the game, and it does it by pressing this rather than by copying the text a
 * second time somewhere else: the button owns the clipboard call *and* the copied/failed
 * flash that says it worked, and a second path would be a second answer to "did that
 * work". Exactly one of these is mounted at any width — the title strip's, or the phone
 * header's.
 */
export const PGN_BUTTON_ID = 'game-pgn-copy'

/**
 * Copy the whole game as PGN. Exported because the title strip it normally sits in is switched
 * off below `md` (`showTitleStrip`), and the phone layout has to put it somewhere of its own.
 */
export function PgnButton({ pgn }: { pgn?: string }) {
  const { t } = useLingui()
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

  // The name stays "Copy PGN" whatever the flash says, so the key's target is findable;
  // the flash is the glyph, the title and a polite announcement.
  const said =
    state === 'copied' ? t`PGN copied` : state === 'failed' ? t`No clipboard to copy to` : null
  const Glyph = state === 'copied' ? Check : state === 'failed' ? X : Copy
  return (
    <>
      <button
        type="button"
        id={PGN_BUTTON_ID}
        onClick={() => void copy()}
        aria-label={t`Copy PGN`}
        aria-keyshortcuts="c"
        title={said ?? t`Copy PGN (C)`}
        // An icon tool in the strip's tools slot (`PANE_TOOL`), like the focus and compare
        // tools beside it. It had been the ghost word "PGN", a text button without a face,
        // which the grammar does not allow; a labelled face squeezed the ply count off a
        // narrow strip. The copy glyph turns into a check (or a cross) for the flash.
        className={cn(
          PANE_TOOL,
          state === 'copied' && 'text-good',
          state === 'failed' && 'text-blunder',
        )}
      >
        <Glyph aria-hidden className="size-3.5" />
      </button>
      <span role="status" className="sr-only">
        {said}
      </span>
    </>
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
  const { t } = useLingui()
  const notate = useNotation()
  const plyLabel = usePlyLabel()
  if (!move?.san) return <span className="min-w-0 flex-1 px-1" />
  const san = notate(move.san)
  const glyph = glyphFor(move.classification)
  const flagged = isFlagged(move.classification)
  const active = move.ply === cursor
  // The number and the move are one unit — `1…d5` — so the title is one message with that
  // unit in it rather than a translated tail glued onto an untranslated head.
  const moveLabel = `${plyLabel(move.ply)}${san}`

  return (
    <button
      type="button"
      onClick={() => onSelectPly(move.ply)}
      title={noted ? t`${moveLabel} — noted` : moveLabel}
      className={cn(
        // `min-w-0` so the row can never push past the track: at the 250px band the two
        // move cells are what has to give, and the san truncates rather than the number,
        // the clock or the glyph badge being shoved off the right edge.
        // The current move is the app's one selected state (`--bb-selected` with the accent
        // ringed inside it), the same blue a selected row or segment wears, on the
        // blue-grey `row-active` of its pair. SAN is primary data, so `ink` at rest.
        'flex h-5 min-w-0 flex-1 items-center gap-[0.3125rem] rounded-md px-1 text-left',
        active
          ? 'bg-selected text-bright ring-1 ring-inset ring-accent-teal/55'
          : flagged
            ? cn(GLYPHS[glyph!].textClass, 'font-medium hover:text-bright')
            : 'text-ink hover:text-bright',
      )}
    >
      <span className="truncate">{san}</span>
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
 * from the table rather than only from the notes track. The accent, not a classification colour,
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
function anchorOf(base: number, offset: number): number | null {
  return base > 0 ? moveNumberOf(base - 1, offset) : null
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
  const { t } = useLingui()
  const notate = useNotation()
  const plyLabel = usePlyLabel()
  const numbering = usePlyNumbering()
  const cursor = variation.cursor ?? 0
  const lineId = variation.lineId ?? null
  const pinnedThrough = variation.pinnedThrough ?? 0
  const noted = new Set(variation.noted ?? [])

  return (
    <div
      data-testid={quiet ? 'kept-variation' : 'move-variation'}
      data-pinned={lineId !== null ? 'true' : undefined}
      className="group/line flex gap-2 py-1 pl-[2.625rem] pr-2 font-mono text-data leading-[1.5]"
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
          // Four whole sentences rather than a stem with two tails bolted on: what a line is
          // and whether it carries a note are one statement, and a translator needs it whole.
          const moveLabel = `${plyLabel(ply)}${notate(san)}`
          const title = quiet
            ? noted.has(index)
              ? t`${moveLabel} — kept line, noted`
              : t`${moveLabel} — kept line`
            : noted.has(index)
              ? t`${moveLabel} — analysis, noted`
              : t`${moveLabel} — analysis`
          return (
            <span key={`${index}-${san}`} className="inline-flex items-baseline gap-1">
              {numbering.side(ply) === 'white' || index === 0 ? (
                <span className={cn('tabular', quiet ? 'text-faint' : 'text-dim-2')}>
                  {numbering.moveNumber(ply)}
                  {numbering.side(ply) === 'white' ? '.' : '…'}
                </span>
              ) : null}
              <button
                type="button"
                disabled={!onSelectMove}
                onClick={() => onSelectMove?.(index)}
                title={title}
                className={cn(
                  'inline-flex items-center gap-0.5 rounded-sm px-0.5',
                  active
                    ? 'bg-brilliant/15 text-bright'
                    : quiet
                      ? cn('text-dim', onSelectMove && 'hover:text-ink')
                      : onSelectMove
                        ? 'text-soft hover:text-ink'
                        : 'text-soft',
                )}
              >
                {notate(san)}
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
  const { t } = useLingui()
  const pinned = lineId !== null
  const extendable = pinned && pinnedThrough < variation.sans.length

  if (pinned && !extendable) {
    if (!onUnpin) return null
    return (
      <button
        type="button"
        onClick={() => onUnpin(lineId)}
        aria-label={t`Unpin this line`}
        title={t`Stop keeping this line`}
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
      aria-label={extendable ? t`Extend the pin to the whole line` : t`Pin this line`}
      title={
        extendable
          ? t`Kept only as far as its first moves — pin the rest`
          : t`Keep this line with the game`
      }
      className={cn(
        'ml-0.5 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/line:opacity-100',
        extendable ? 'text-brilliant/70 hover:text-brilliant' : 'text-soft hover:text-brilliant',
      )}
    >
      <Pin className="size-2.5" aria-hidden />
    </button>
  )
}

/** The italic aside under a flagged move: which move, the swing it cost, and what beat it. */
function Annotation({ annotation }: { annotation: MoveAnnotation }) {
  const notate = useNotation()
  const plyLabel = usePlyLabel()
  const glyph = glyphFor(annotation.classification)
  const color = glyph ? GLYPHS[glyph].color : 'var(--bb-blunder)'
  const winLoss = formatWinLoss(annotation.winLoss)
  return (
    <div className="flex gap-2 py-1.5 pl-[2.625rem] pr-2 font-sans text-data italic leading-[1.5] text-soft">
      <div className="w-0.5 flex-none rounded-sm opacity-50" style={{ background: color }} />
      <div>
        {/* Whose move this is about, first and in the move list's own mono, so the note is
            read as belonging to one half of the pair above it rather than to the row. */}
        {annotation.san ? (
          <span className="font-mono not-italic" style={{ color }}>
            {plyLabel(annotation.ply)} {notate(annotation.san)}
            {glyph ? GLYPHS[glyph].glyph : ''}{' '}
          </span>
        ) : null}
        {annotation.bestSan ? (
          <>
            {/* The space rides outside the message: Lingui trims a message's own edges, and
                what separates the words from the move is layout rather than wording. */}
            <span className="not-italic">
              <Trans>Best was</Trans>{' '}
            </span>
            <span className="font-mono not-italic text-ink">{notate(annotation.bestSan)}</span>
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
            <Trans>(<span style={{ color }}>{winLoss}</span> win)</Trans>
          </span>
        ) : null}
      </div>
    </div>
  )
}


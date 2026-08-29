import { useEffect, useRef, type ReactNode } from 'react'

import { SideDot } from '@/components/badges/SideDot'
import { RunStatusBadge, TierBadge, UnanalysedBadge } from '@/components/badges/TierBadge'
import type { Color, GameRunSummary, GameSummary, RunResponse } from '@/lib/api/types'
import { formatScore, type Score } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

import { formatResult } from '../gameModel'
import { PgnButton, type MoveTab } from './MoveList'

/**
 * The phone's tabs. Three of them are the move table's own, promoted out of it (see
 * `MoveList`'s `showTabRow`); Eval and Engine are the panels that have nowhere else to live
 * once the second column is gone.
 */
export type MobileTab = MoveTab | 'eval' | 'engine'

/**
 * Reading order, not grouping order: Moves, then the two panels that describe the position
 * the board is on, then the two that are about the game as a whole. Flagged and Notes are
 * last because they are places you go on purpose — and the strip scrolls, so the two that
 * can fall off the right edge should be the two nobody reaches for mid-move.
 */
const MOBILE_TABS: readonly MobileTab[] = ['moves', 'eval', 'engine', 'flagged', 'notes']

const TAB_LABEL: Record<MobileTab, string> = {
  moves: 'Moves',
  flagged: 'Flagged',
  notes: 'Notes',
  eval: 'Eval',
  engine: 'Engine',
}

export interface MobileGameViewProps {
  game: GameSummary
  /** The deepest finished run, for the header's tier chip. */
  best: GameRunSummary | null
  /** A run queued or running right now, which the chip reports instead. */
  active: RunResponse | null
  /** The game as PGN. The tab row that normally holds this affordance is switched off. */
  pgn?: string
  /** The ply last played; `-1` for the starting position. */
  cursor: number
  plyCount: number
  /**
   * The evaluation of the position on the board. It is read in the header rather than in
   * the transport row below `md` — see `CompactHeader`.
   */
  score: Score | null
  flaggedCount: number
  noteCount: number
  tab: MobileTab
  onTabChange: (tab: MobileTab) => void
  /** `BoardPanel`, whole — eval bar, board and the transport row under it. */
  board: ReactNode
  /** `MoveList`, already told which of its three tabs to draw. */
  moveList: ReactNode
  evalGraph: ReactNode
  /** `FlaggedMoments` — the curve's marks as a tappable list, under the curve. */
  flaggedMoments: ReactNode
  maiaPanel: ReactNode
  infinite: ReactNode
  composer: ReactNode
}

/**
 * The game screen below `md`, as an app rather than as a page.
 *
 * The desktop screen is two columns of panels that are all on screen at once, which is the
 * right answer at 1440 and impossible at 375. Stacking them into one scroll was the first
 * try and it failed the only test that matters: the board — the thing the screen is *for* —
 * scrolled away the moment you looked at anything else, so every reading of a move meant
 * scrolling back up to see the position it was about.
 *
 * So the board is pinned and everything else is tabbed under it. The head — header, board,
 * transport — never moves; one strip owns the rest, and exactly one panel is on screen at a
 * time in a pane that scrolls inside itself. The page itself does not scroll at all: there
 * is nothing above or below the fold, because there is no fold.
 *
 * The pieces are the same ones the desktop column renders — `GamePage` builds them once and
 * hands both layouts the same nodes — so an engine line, a note or a variation behaves
 * identically whichever screen it is read on. Only the arrangement forks.
 */
export function MobileGameView({
  game,
  best,
  active,
  pgn,
  cursor,
  plyCount,
  score,
  flaggedCount,
  noteCount,
  tab,
  onTabChange,
  board,
  moveList,
  evalGraph,
  flaggedMoments,
  maiaPanel,
  infinite,
  composer,
}: MobileGameViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CompactHeader
        game={game}
        best={best}
        active={active}
        pgn={pgn}
        cursor={cursor}
        plyCount={plyCount}
        score={score}
      />

      {/*
        The pinned head. `flex-none`, so it keeps its natural height and the pane below is
        what gives way — including when the transport row wraps to a third line inside an
        analysis variation. The board caps itself against `100dvh` (`BoardPanel`), which is
        what stops it eating the pane on a short phone.
      */}
      <div className="flex-none px-2 py-2">{board}</div>

      <TabStrip
        tab={tab}
        onTabChange={onTabChange}
        flaggedCount={flaggedCount}
        noteCount={noteCount}
      />

      {/*
        The pane. `min-h-0 flex-1` is what makes it the thing that shrinks, and the bottom
        inset keeps the last row clear of an iPhone's home indicator — the head has the
        titlebar's own `env(safe-area-inset-top)` above it already.

        Every branch owns its scrolling rather than the pane owning it, because the panels
        disagree about what should scroll: `MoveList` has an inner scroller that keeps the
        current move in view, and wrapping it in a second one would leave the outer scrolled
        somewhere the inner knows nothing about.
      */}
      <div
        data-testid="mobile-tab-pane"
        className="flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom,0rem)]"
      >
        {tab === 'eval' ? (
          /*
            The story of the game: the shape on top, the moves that made it underneath.

            One scroller over the pair, in block flow — not a fixed curve above a scrolling
            list. Splitting them made the curve a `flex-none` box that could not yield, and
            at 375×812 the card is about 178px of a 230px pane; the list under it was handed
            the remainder and drew 13 visible pixels of a 426px list. Scrolled together, a
            card that does not fit simply scrolls away and the list is the whole pane once
            you have passed it.

            The curve keeps a compact height rather than filling the pane. A stretched curve
            is not a more readable one — the same handful of turning points, drawn taller —
            and that height is worth far more spent on the list, which is the half of this
            tab a finger can hit. Scrubbing is unaffected: a touch that starts on the plot is
            recharts', a touch below it is the scroller's, and the two never see each other.
          */
          <div data-testid="eval-scroll" className="min-h-0 flex-1 overflow-y-auto">
            <div className="px-2 py-1.5">{evalGraph}</div>
            <div className="border-t border-hairline">{flaggedMoments}</div>
          </div>
        ) : tab === 'engine' ? (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {maiaPanel}
            {infinite}
          </div>
        ) : tab === 'notes' ? (
          <>
            {/*
              The list above, the composer pinned under it like a message box. Reading what
              is already written is the common visit and belongs where the eye lands; the
              composer is where a phone keyboard will push it anyway, and the Note button in
              the transport row switches to this tab and focuses it (`GamePage`).
            */}
            {moveList}
            <div className="flex-none border-t border-hairline p-2">{composer}</div>
          </>
        ) : (
          moveList
        )}
      </div>
    </div>
  )
}

/**
 * Two lines of what the desktop `GameHeaderBar` says in four, plus the three readouts that
 * lost their homes below `md`: the tier chip, PGN out of the move table's hidden tab row,
 * and the evaluation out of the transport row.
 *
 * The titlebar's breadcrumb — date and players — is hidden below `md`, so this is the only
 * thing on screen naming the game, which is why the players are the line that gets the
 * room. Everything folded away (source, time control, rated, when it was analysed) is a
 * property of the game rather than of the position, and the library screen already lists it.
 *
 * The second line is the position rather than the game: what the engine makes of it, whose
 * result it ended in, how far in the board stands. It costs no height — the line was there
 * for the result anyway — which is the whole reason the evaluation was moved into it.
 */
function CompactHeader({
  game,
  best,
  active,
  pgn,
  cursor,
  plyCount,
  score,
}: {
  game: GameSummary
  best: GameRunSummary | null
  active: RunResponse | null
  pgn?: string
  cursor: number
  plyCount: number
  score: Score | null
}) {
  const winner = game.result === '1-0' ? 'white' : game.result === '0-1' ? 'black' : null

  return (
    <div
      data-testid="mobile-header"
      className="flex h-[2.75rem] flex-none items-center gap-2 border-b border-hairline px-3"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <div className="flex min-w-0 items-center gap-1.5 text-[0.71875rem] leading-tight">
          <Name side="white" name={game.white} rating={game.white_rating} won={winner === 'white'} owner={game.color === 'white'} />
          <span className="flex-none text-faint-2">vs</span>
          <Name side="black" name={game.black} rating={game.black_rating} won={winner === 'black'} owner={game.color === 'black'} />
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-[0.625rem] leading-tight text-dim">
          {/*
            The evaluation of the position on the board, in the brightest tone on the line:
            it is the only thing here that changes as the game is walked, and the one number
            the eval bar beside the board can only draw as a picture.
          */}
          <span className="flex-none font-mono tabular text-ink">{formatScore(score)}</span>
          <span className="flex-none text-faint-2">·</span>
          <span className="flex-none font-mono tabular">{formatResult(game.result)}</span>
          <span className="flex-none text-faint-2">·</span>
          {/* The ply readout the transport row gives up below `md`; free here. */}
          <span className="flex-none font-mono tabular text-faint">
            ply {cursor + 1}/{plyCount}
          </span>
          {game.opening ? (
            <>
              <span className="flex-none text-faint-2">·</span>
              <span className="truncate">{game.opening}</span>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex flex-none items-center gap-2">
        {active ? (
          <RunStatusBadge status={active.status} />
        ) : best ? (
          <TierBadge tier={best.tier} depth={best.depth} />
        ) : (
          <UnanalysedBadge />
        )}
        <PgnButton pgn={pgn} />
      </div>
    </div>
  )
}

/**
 * One player: side dot, name, rating.
 *
 * `max-w-[48%]` is what keeps a short name whole. Flex shares a row's overflow out in
 * proportion to what each item asked for, so two names side by side *both* give ground —
 * which is how a four-character owner ended up as "p…" beside an opponent that kept a dozen
 * characters. A cap changes the question from "how much should each give" to "is this one
 * over its half": a name under its share is never asked to shrink at all, and only the one
 * that is actually too long truncates. Two long names are still shared out, evenly, which
 * is the fair answer when there is no short one to protect.
 *
 * The dot and the rating are `flex-none`: what gives is the name, never the two things
 * beside it that are three characters wide and mean nothing truncated.
 */
function Name({
  side,
  name,
  rating,
  won,
  owner,
}: {
  side: Color
  name: string | null | undefined
  rating: number | null | undefined
  won: boolean
  owner: boolean
}) {
  return (
    <span className="inline-flex min-w-0 max-w-[48%] items-center gap-1">
      <SideDot side={side} size="sm" className="flex-none" />
      <span className={cn('truncate', owner && 'font-medium', won ? 'text-good' : owner ? 'text-ink' : 'text-soft')}>
        {name ?? 'unknown'}
      </span>
      <span className="flex-none font-mono text-[0.625rem] tabular text-faint">{rating ?? '—'}</span>
    </span>
  )
}

/**
 * The five tabs, in one horizontally scrollable strip.
 *
 * Five labels plus two counts come to about 340 of the 356 usable pixels at 375 — they fit,
 * but only just, and a three-digit flagged count or a longer word would push the last one
 * off the edge silently. Scrolling the strip makes that overflow reachable instead of lost,
 * and the active tab is scrolled back into view so a tab switched from elsewhere (the Note
 * button jumps to Notes) is never left off-screen.
 */
function TabStrip({
  tab,
  onTabChange,
  flaggedCount,
  noteCount,
}: {
  tab: MobileTab
  onTabChange: (tab: MobileTab) => void
  flaggedCount: number
  noteCount: number
}) {
  const active = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // `block: 'nearest'` so bringing a tab into view never scrolls an ancestor vertically —
    // there is nothing above or below this strip that is allowed to move.
    active.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [tab])

  return (
    <div
      role="tablist"
      aria-label="Game panels"
      className="flex h-[2.5rem] flex-none items-stretch gap-0.5 overflow-x-auto border-b border-hairline px-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {MOBILE_TABS.map((name) => {
        const count = name === 'flagged' ? flaggedCount : name === 'notes' ? noteCount : 0
        const selected = tab === name
        return (
          <button
            key={name}
            ref={selected ? active : undefined}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onTabChange(name)}
            className={cn(
              'flex flex-none items-center whitespace-nowrap px-2.5 text-xs',
              selected
                ? 'font-medium text-ink shadow-[inset_0_-0.125rem_0_var(--bb-accent)]'
                : 'text-dim hover:text-ink',
            )}
          >
            {TAB_LABEL[name]}
            {count > 0 ? (
              <span
                className={cn(
                  'ml-1.5 font-mono text-[0.625rem] tabular',
                  name === 'flagged' ? 'text-blunder' : 'text-accent-teal',
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

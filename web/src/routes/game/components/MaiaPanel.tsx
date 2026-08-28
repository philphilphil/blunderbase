import { ChevronDown, Columns3 } from 'lucide-react'

import type { GameRunSummary } from '@/lib/api/types'
import { glyphStyle, isFlagged } from '@/lib/chess/classification'
import { formatNodes, formatScore, formatWinLoss } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

import {
  plyLabel,
  type EngineLineView,
  type HumanMoveView,
  type MaiaComparisonColumn,
  type MaiaLevelOption,
  type MaiaMove,
} from '../gameModel'

/** The human column's own colour — the purple `docs/design/README.md` gives Maia. */
const MAIA_HUE = 'var(--bb-brilliant)'

/**
 * A token colour at a fraction of its opacity. The colours are `var(--bb-…)` tokens, so the
 * design's `rgba(240,82,74,.06)` tints have to be mixed rather than written as a hex-alpha
 * suffix — and mixing keeps them right in both themes, where the token itself changes.
 */
function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`
}

export interface MaiaLiveState {
  /** The most likely continuation from here, both sides at the same level. */
  rollout: MaiaMove[]
  /** A query is in flight for the position on the board. */
  pending: boolean
}

export interface MaiaPanelProps {
  /** The level the human column speaks for — a stored band, or the live engine's own. */
  rating: string | null
  /** The human column, already crossed with the engine's verdicts (`humanMoves`). */
  human: HumanMoveView[]
  /**
   * Every level the reader may switch to here: what this position carries, plus the levels
   * the deployment is configured for but this run was never made at, which are offered
   * disabled rather than hidden (`maiaLevelOptions`). Fewer than two, and the header is the
   * plain label it always was — there is nothing to switch between.
   */
  levels?: MaiaLevelOption[]
  onSelectLevel?: (elo: number) => void
  /** The human column is every level side by side rather than the one that is selected. */
  compare?: boolean
  onCompareChange?: (next: boolean) => void
  /** One column per level, for the compare grid (`maiaComparison`). */
  comparison?: MaiaComparisonColumn[]
  /**
   * Whether the human column has anything to say. Off — the `hints` toggle, or a
   * deployment with no Maia to ask — the column keeps its place and its header but shows
   * nothing, so the box never changes shape; what the run found is not a hint and must not
   * vanish with them.
   */
  showHuman?: boolean
  /** The engine's ranking of the same position; empty off the game line. */
  engine: EngineLineView[]
  /** The run those lines came from, whose spend the engine column's header reports. */
  run?: GameRunSummary | null
  /** The ply the position sits at, for numbering a rollout. */
  ply: number
  /** Set while the board is off the game line: the panel is reading a live query. */
  live?: MaiaLiveState | null
  /** Pointing at a row previews its move on the board; leaving clears it. */
  onHoverMove?: (uci: string | null) => void
  /**
   * Walk into a line from the position on the board: the *whole* line in UCI, and which of
   * its moves was clicked (0-based). The page puts the board just after that move and keeps
   * the rest of the line to step through, so a click is an entry point rather than a cut.
   */
  onPlayLine?: (ucis: string[], index: number) => void
  className?: string
}

/**
 * What humans play here, beside what the engine plays here.
 *
 * Neither column says much alone — "a 1700 plays Nf3, 41%" teaches nothing, and the engine
 * list is the same list every engine ever printed. Side by side they answer the two
 * questions the owner actually has: *was my blunder a normal human mistake* (the played
 * move, tinted with the verdict the engine gave it, beside how many people at my level walk
 * into it), and *what will a human actually do here* (the distribution, and the rollout of
 * the line two humans at this level would most likely play out).
 *
 * On the game line the human column is stored data, instant. Off it, the board is an
 * analysis board and the column is a live query — see `useLiveMaia`.
 *
 * The engine column is also the run's own box: which run is speaking, what it spent, and
 * its multi-PV lines for the position on the board, with the move actually played as the
 * last row, marked `played`, so a blunder reads as "these were the options, this happened".
 *
 * Compare mode is the third question, the one a single level cannot answer: *at which level
 * does this stop being the move people play*. Several levels' distributions only mean
 * anything against each other, so the grid takes the whole card while it is on — the
 * engine's verdict is already in every column's colour, and five columns squeezed into a
 * quarter of the width would be five ellipses.
 */
export function MaiaPanel({
  rating,
  human,
  levels = [],
  onSelectLevel,
  compare = false,
  onCompareChange,
  comparison = [],
  showHuman = true,
  engine,
  run,
  ply,
  live,
  onHoverMove,
  onPlayLine,
  className,
}: MaiaPanelProps) {
  const rollout = live?.rollout ?? []
  const nodes = formatNodes(run?.nodes)
  const comparing = showHuman && compare && comparison.length > 1
  // The toggle stays offered while compare is on even with nothing to compare here, so a
  // position with one level is never a position the reader cannot get out of.
  const canCompare = onCompareChange !== undefined && (comparison.length > 1 || compare)

  return (
    <div
      className={cn(
        // One height for every position: the box sits on top of the move table, and a
        // height that tracked how many rows the columns happen to have would bounce the
        // table on every step through the game. A column with more to say scrolls.
        'flex h-[12rem] flex-none flex-col border-t border-hairline bg-panel',
        className,
      )}
      data-testid="maia-panel"
    >
      {/*
        A quarter to Maia, three to the engine: the human column is single moves and a
        number, the engine column is whole variations, and an even split left the one
        half-empty while the other wrapped. The quarter has a floor, though — a loss chip,
        a SAN and a percentage side by side are about 9rem, and below that the column
        truncates its own header — so in a narrow moves column the engine's rows wrap a
        line sooner rather than the human rows becoming ellipses.
      */}
      <div
        className={cn(
          'grid min-h-0 flex-1 divide-x divide-line',
          comparing ? 'grid-cols-1' : 'grid-cols-[minmax(9rem,1fr)_minmax(0,3fr)]',
        )}
      >
        <section className="flex min-w-0 flex-col gap-2 overflow-y-auto px-3 py-2.5">
          <div className="flex flex-nowrap items-center gap-[0.4375rem]">
            <span className="size-1.5 flex-none rounded-full bg-brilliant" />
            {/*
              The visible label is the level itself, with the picker laid over it: the
              header has room for one reading of who this column speaks for, and "Maia
              1700" is that reading whether or not it can be changed.
            */}
            <LevelLabel
              rating={rating}
              levels={comparing ? [] : levels}
              onSelectLevel={onSelectLevel}
            />
            <div className="flex-1" />
            {showHuman && live ? <LivePill pending={live.pending} /> : null}
            {canCompare && onCompareChange ? (
              <CompareToggle on={compare} onChange={onCompareChange} />
            ) : null}
          </div>

          {/* Switched off, the column holds its place and says nothing at all. */}
          {!showHuman ? null : comparing ? (
            <CompareGrid columns={comparison} onHoverMove={onHoverMove} onPlayLine={onPlayLine} />
          ) : human.length === 0 ? (
            <p className="py-2 text-[0.6875rem] text-dim">
              {live?.pending ? 'Reading this position…' : '–'}
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {human.map((move) => (
                <HumanRow
                  key={move.uci}
                  move={move}
                  onHoverMove={onHoverMove}
                  onPlay={onPlayLine ? () => onPlayLine([move.uci], 0) : undefined}
                />
              ))}
            </div>
          )}

          {showHuman && live && rollout.length > 0 ? (
            <Rollout rollout={rollout} ply={ply} onPlayLine={onPlayLine} />
          ) : null}
        </section>

        {comparing ? null : (
          <section className="flex min-w-0 flex-col gap-2 overflow-y-auto px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-[0.4375rem]">
              <span
                className={cn(
                  'size-1.5 flex-none rounded-full',
                  run ? 'bg-accent-teal' : 'bg-edge-strong',
                )}
              />
              <span className="truncate text-[0.6875rem] font-semibold tracking-[0.02em] text-ink">
                {run?.engine ?? 'No engine run'}
              </span>
              {/*
                The label is the column's category, paired with the human column's own —
                never the run's protocol kind, which lives on the engines page.
              */}
              <div className="flex-1" />
              {run?.depth ? (
                <span className="font-mono text-[0.625rem] tabular text-dim">d{run.depth}</span>
              ) : null}
              {nodes !== '—' ? (
                <span className="font-mono text-[0.625rem] tabular text-dim">{nodes} nodes</span>
              ) : null}
              {run?.multipv ? (
                <span className="rounded-sm border border-edge px-[0.3125rem] py-px font-mono text-[0.625rem] tabular text-dim">
                  MPV {run.multipv}
                </span>
              ) : null}
            </div>

            {engine.length === 0 ? (
              <p className="py-2 text-[0.6875rem] text-dim">–</p>
            ) : (
              <div className="flex flex-col gap-1">
                {engine.map((line) => (
                  <EngineRow
                    key={`${line.multipv}-${line.firstUci ?? 'x'}`}
                    line={line}
                    ply={ply}
                    onHoverMove={onHoverMove}
                    onPlayLine={onPlayLine}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

/**
 * Who the column speaks for, and the switch that changes it.
 *
 * A native `select` laid over the label rather than beside it: the header is one line at
 * 11px with a live pill and a compare toggle already on it, and a second visible control
 * would take the label's room. The label is what is read; the select is what is clicked,
 * and it brings the platform's own keyboard handling, its scroll and its disabled options
 * with it. A level the position has no data for is offered and disabled — the fix is a
 * fresh pass, and hiding it would make a level the owner configured look impossible.
 */
function LevelLabel({
  rating,
  levels,
  onSelectLevel,
}: {
  rating: string | null
  levels: MaiaLevelOption[]
  onSelectLevel?: (elo: number) => void
}) {
  const label = rating ? `Maia ${rating}` : 'Maia'
  const pickable = levels.length > 1 && onSelectLevel !== undefined
  if (!pickable) {
    return (
      <span className="flex-none whitespace-nowrap text-[0.6875rem] font-semibold tracking-[0.02em] text-ink">
        {label}
      </span>
    )
  }
  return (
    // `flex-none` and no truncation: the label is four digits and a word, and it was the
    // one thing on this row that ellipsised ("Maia 20…") while the spacer beside it still
    // had room to give. What yields in a narrow column is the spacer, never the name.
    <span
      data-testid="maia-level-picker"
      className="relative inline-flex flex-none items-center gap-0.5 rounded-[0.1875rem] hover:bg-raised"
    >
      <span className="whitespace-nowrap text-[0.6875rem] font-semibold tracking-[0.02em] text-ink">
        {label}
      </span>
      <ChevronDown className="size-2.5 flex-none text-faint" aria-hidden />
      <select
        aria-label="Maia level"
        title="Which level the human column speaks for"
        value={rating ?? ''}
        onChange={(event) => onSelectLevel(Number(event.target.value))}
        className="absolute inset-0 w-full cursor-pointer appearance-none opacity-0"
      >
        {/* A live answer from a fixed-weights build names no level; the box still has to
            have the value it is showing, or the platform picks one nobody asked for. */}
        {rating === null ? <option value="">Maia</option> : null}
        {levels.map((option) => (
          <option key={option.elo} value={String(option.elo)} disabled={!option.available}>
            {option.available ? String(option.elo) : `${option.elo} — re-analyse to add`}
          </option>
        ))}
      </select>
    </span>
  )
}

/** One level, or all of them side by side. */
function CompareToggle({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      data-testid="maia-compare-toggle"
      aria-pressed={on}
      title={on ? 'Read one level at a time' : 'Compare the levels side by side'}
      aria-label={on ? 'Read one level at a time' : 'Compare the levels side by side'}
      onClick={() => onChange(!on)}
      className={cn(
        'inline-flex flex-none items-center rounded-sm border px-1 py-px',
        on
          ? 'border-brilliant/40 bg-brilliant/12 text-brilliant'
          : 'border-edge text-dim hover:border-edge-hover hover:text-soft',
      )}
    >
      <Columns3 className="size-3" aria-hidden />
    </button>
  )
}

/**
 * Every level's reading of one position, one column each.
 *
 * The columns are the comparison, so they are equal-width and read across: the same move on
 * the same row of two columns is the same move at two levels, and a move that is top at
 * 1100 and absent at 2000 is the answer to "was this a normal mistake" without a sentence
 * having to say so.
 */
function CompareGrid({
  columns,
  onHoverMove,
  onPlayLine,
}: {
  columns: MaiaComparisonColumn[]
  onHoverMove?: (uci: string | null) => void
  onPlayLine?: (ucis: string[], index: number) => void
}) {
  return (
    <div
      data-testid="maia-compare"
      className="grid min-w-0 gap-x-3"
      style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
    >
      {columns.map((column, index) => (
        <CompareColumn
          key={column.rating ?? `unnamed-${index}`}
          column={column}
          onHoverMove={onHoverMove}
          onPlayLine={onPlayLine}
        />
      ))}
    </div>
  )
}

function CompareColumn({
  column,
  onHoverMove,
  onPlayLine,
}: {
  column: MaiaComparisonColumn
  onHoverMove?: (uci: string | null) => void
  onPlayLine?: (ucis: string[], index: number) => void
}) {
  const played = column.played
  const listed = played !== null && column.moves.some((move) => move.uci === played.uci)

  return (
    <div
      data-testid="maia-compare-column"
      data-rating={column.rating ?? ''}
      className="flex min-w-0 flex-col gap-0.5"
    >
      <span className="truncate border-b border-line pb-1 font-mono text-[0.625rem] font-semibold text-brilliant">
        {column.rating ?? 'Maia'}
      </span>
      {column.moves.length === 0 ? (
        <span className="py-1 font-mono text-[0.625rem] text-dim">–</span>
      ) : (
        column.moves.map((move) => (
          <CompareRow
            key={move.uci}
            move={move}
            onHoverMove={onHoverMove}
            onPlay={onPlayLine ? () => onPlayLine([move.uci], 0) : undefined}
          />
        ))
      )}
      {/* The played move is on every column whether or not the level ranked it: a level
          that puts it seventh is exactly the level worth reading. */}
      {played && !listed ? (
        <div data-testid="maia-compare-played" className="mt-0.5 border-t border-line pt-0.5">
          <CompareRow
            move={played}
            onHoverMove={onHoverMove}
            onPlay={onPlayLine ? () => onPlayLine([played.uci], 0) : undefined}
          />
        </div>
      ) : null}
    </div>
  )
}

/** One move of one compare column: its rank at this level, the SAN, its share. */
function CompareRow({
  move,
  onHoverMove,
  onPlay,
}: {
  move: HumanMoveView
  onHoverMove?: (uci: string | null) => void
  onPlay?: () => void
}) {
  const verdict = glyphStyle(move.classification)
  const hue = verdict?.color ?? MAIA_HUE

  return (
    <button
      type="button"
      data-testid={move.played ? 'maia-compare-played-row' : 'maia-compare-row'}
      disabled={!onPlay}
      onClick={onPlay}
      onMouseEnter={() => onHoverMove?.(move.uci)}
      onMouseLeave={() => onHoverMove?.(null)}
      title={`Play ${move.san} on the analysis board`}
      className={cn(
        'relative flex w-full items-baseline gap-1 overflow-hidden rounded-[0.1875rem] border-l-2 px-1 py-px text-left',
        move.played ? null : 'border-transparent',
        onPlay ? 'hover:bg-raised' : 'cursor-default',
      )}
      style={move.played ? { borderLeftColor: hue, background: tint(hue, 7) } : undefined}
    >
      <span className="relative w-3 flex-none font-mono text-[0.59375rem] tabular text-faint">
        {move.rank}
      </span>
      <span
        className={cn(
          'relative min-w-0 flex-1 truncate font-mono text-[0.625rem]',
          verdict ? verdict.textClass : 'text-soft',
        )}
      >
        {move.san}
      </span>
      <span className="relative flex-none font-mono text-[0.59375rem] tabular text-dim">
        {move.probability === null ? '—' : `${Math.round(move.probability * 100)}%`}
      </span>
    </button>
  )
}

/** The header affordance that says these numbers were computed just now, not stored. */
function LivePill({ pending }: { pending: boolean }) {
  return (
    <span
      data-testid="maia-live"
      className="inline-flex flex-none items-center gap-1 rounded-sm border border-brilliant/30 bg-brilliant/10 px-1.5 py-px font-mono text-[0.59375rem] text-brilliant"
    >
      <span
        className={cn('size-1 rounded-full bg-brilliant', pending && 'animate-pulse')}
        aria-hidden
      />
      live
    </span>
  )
}

/**
 * One human move: how often it is played, and what it costs. The SAN carries the engine's
 * verdict where the position's stored lines have one — that colour, next to a long bar, is
 * the whole "everybody at my level walks into this" reading.
 */
function HumanRow({
  move,
  onHoverMove,
  onPlay,
}: {
  move: HumanMoveView
  onHoverMove?: (uci: string | null) => void
  onPlay?: () => void
}) {
  const verdict = glyphStyle(move.classification)
  const hue = verdict?.color ?? MAIA_HUE
  const share = move.probability ?? 0
  const loss = move.loss !== null && move.loss >= 0.05 ? formatWinLoss(move.loss) : null

  return (
    <button
      type="button"
      data-testid={move.played ? 'maia-played-row' : 'maia-row'}
      disabled={!onPlay}
      onClick={onPlay}
      onMouseEnter={() => onHoverMove?.(move.uci)}
      onMouseLeave={() => onHoverMove?.(null)}
      title={`Play ${move.san} on the analysis board`}
      className={cn(
        'relative flex w-full items-baseline gap-1.5 overflow-hidden rounded-[0.25rem] border-l-2 px-1 py-[0.1875rem] text-left',
        move.played ? null : 'border-transparent',
        onPlay ? 'hover:bg-raised' : 'cursor-default',
      )}
      style={move.played ? { borderLeftColor: hue, background: tint(hue, 7) } : undefined}
    >
      {/* The probability, drawn as a fill behind the row — the narrow column has no room
          for a bar of its own. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0"
        style={{ width: `${Math.min(100, share * 100)}%`, background: tint(hue, 8) }}
      />
      {/* The move's cost sits where the engine rows put their eval, so the two columns
          read the same way: value first, then the move. */}
      <span
        className={cn(
          'relative min-w-[2.5rem] flex-none rounded-[0.1875rem] px-1 py-px text-right font-mono text-[0.625rem] tabular',
          verdict ? verdict.textClass : 'text-faint',
        )}
        style={verdict ? { background: tint(verdict.color, 13) } : undefined}
      >
        {loss ?? ''}
      </span>
      <span
        className={cn(
          'relative min-w-0 flex-1 truncate font-mono text-[0.6875rem]',
          verdict ? verdict.textClass : 'text-soft',
        )}
      >
        {move.san}
      </span>
      <span className="relative flex-none text-right font-mono text-[0.625rem] tabular text-dim">
        {move.probability === null ? '—' : `${Math.round(move.probability * 100)}%`}
      </span>
    </button>
  )
}

/**
 * One engine line: its eval, then the whole variation, wrapped. Clicking the Nth move puts
 * the analysis board just after it, with the rest of the line kept to walk through.
 *
 * A played move is only drawn in its own colour when the engine had something against it:
 * playing the top line is not a warning, and `best` is a compliment, so only the flagged
 * classifications tint the row.
 */
function EngineRow({
  line,
  ply,
  onHoverMove,
  onPlayLine,
}: {
  line: EngineLineView
  ply: number
  onHoverMove?: (uci: string | null) => void
  onPlayLine?: (ucis: string[], index: number) => void
}) {
  const verdict = line.played && isFlagged(line.classification) ? glyphStyle(line.classification) : null

  return (
    <div
      data-testid={line.played ? 'engine-played-line' : undefined}
      onMouseEnter={() => onHoverMove?.(line.firstUci)}
      onMouseLeave={() => onHoverMove?.(null)}
      title={line.text || plyLabel(ply)}
      className={cn(
        'flex items-baseline gap-1.5 rounded-[0.25rem] px-1 py-[0.1875rem]',
        verdict ? null : 'hover:bg-raised',
      )}
      style={verdict ? { background: tint(verdict.color, 6) } : undefined}
    >
      <span
        className={cn(
          'min-w-[2.5rem] flex-none rounded-[0.1875rem] px-1 py-px text-right font-mono text-[0.625rem] tabular',
          verdict ? '' : line.multipv === 1 ? 'bg-cell-strong text-ink-2' : 'bg-cell text-body-3',
        )}
        style={verdict ? { background: tint(verdict.color, 13), color: verdict.color } : undefined}
      >
        {formatScore(line.score)}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1 gap-y-0.5">
        {line.sans.length === 0 ? (
          <span className="font-mono text-[0.6875rem] text-soft">—</span>
        ) : (
          line.sans.map((san, index) => (
            <span key={`${index}-${san}`} className="inline-flex items-baseline gap-1">
              <PlyNumber ply={ply + index} first={index === 0} />
              <MoveButton
                san={san}
                // The verdict belongs to the move that was played, which is the first one.
                className={index === 0 ? verdict?.textClass : undefined}
                onPlay={onPlayLine ? () => onPlayLine(line.pv, index) : undefined}
              />
            </span>
          ))
        )}
      </div>
      {line.played ? (
        <span
          className={cn(
            'flex-none rounded-[0.1875rem] border px-1 py-px font-mono text-[0.59375rem]',
            verdict ? '' : 'border-edge text-dim',
          )}
          style={
            verdict ? { borderColor: tint(verdict.color, 35), color: verdict.color } : undefined
          }
        >
          played
        </span>
      ) : null}
    </div>
  )
}

/**
 * The rollout: what two humans at this level would most likely play from here. Clicking a
 * move puts the analysis board just after it and keeps the rest to walk, re-querying from
 * wherever the board stands — the line is a suggestion to walk into, not a verdict.
 */
function Rollout({
  rollout,
  ply,
  onPlayLine,
}: {
  rollout: MaiaMove[]
  ply: number
  onPlayLine?: (ucis: string[], index: number) => void
}) {
  return (
    <div
      data-testid="maia-rollout"
      className="flex flex-col gap-1 border-t border-line pt-[0.4375rem]"
    >
      <span className="font-mono text-[0.59375rem] uppercase tracking-[0.04em] text-faint">
        likely continuation
      </span>
      <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
        {rollout.map((move, index) => (
          <span key={`${index}-${move.uci}`} className="inline-flex items-baseline gap-1">
            <PlyNumber ply={ply + index} first={index === 0} />
            <MoveButton
              san={move.san}
              onPlay={
                onPlayLine
                  ? () => onPlayLine(rollout.map((step) => step.uci), index)
                  : undefined
              }
            />
            {move.probability === null ? null : (
              <span className="font-mono text-[0.59375rem] tabular text-faint">
                {Math.round(move.probability * 100)}%
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}

/** `12.` for White; Black gets a number only where the line starts on it. */
function PlyNumber({ ply, first }: { ply: number; first: boolean }) {
  if (ply % 2 === 1 && !first) return null
  return (
    <span className="font-mono text-[0.59375rem] tabular text-faint">
      {Math.floor(ply / 2) + 1}
      {ply % 2 === 0 ? '.' : '…'}
    </span>
  )
}

function MoveButton({
  san,
  className,
  onPlay,
}: {
  san: string
  className?: string
  onPlay?: () => void
}) {
  if (!onPlay) {
    return <span className={cn('font-mono text-[0.6875rem] text-soft', className)}>{san}</span>
  }
  return (
    <button
      type="button"
      onClick={onPlay}
      className={cn(
        'rounded-[0.1875rem] font-mono text-[0.6875rem] text-soft hover:text-ink hover:underline',
        className,
      )}
    >
      {san}
    </button>
  )
}

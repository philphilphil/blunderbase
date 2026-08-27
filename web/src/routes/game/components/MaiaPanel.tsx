import type { GameRunSummary } from '@/lib/api/types'
import { glyphStyle, isFlagged } from '@/lib/chess/classification'
import { formatNodes, formatScore, formatWinLoss } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

import { plyLabel, type EngineLineView, type HumanMoveView, type MaiaMove } from '../gameModel'

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
 */
export function MaiaPanel({
  rating,
  human,
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

  return (
    <div
      className={cn(
        'flex flex-none flex-col border-t border-hairline bg-panel',
        className,
      )}
      data-testid="maia-panel"
    >
      <div className="grid grid-cols-2 divide-x divide-line">
        <section className="flex min-w-0 flex-col gap-2 px-3 py-2.5">
          <div className="flex items-center gap-[0.4375rem]">
            <span className="size-1.5 flex-none rounded-full bg-brilliant" />
            <span className="truncate text-[0.6875rem] font-semibold tracking-[0.02em] text-ink">
              {rating ? `Maia ${rating}` : 'Maia'}
            </span>
            <span className="truncate font-mono text-[0.625rem] text-faint">human</span>
            <div className="flex-1" />
            {showHuman && live ? <LivePill pending={live.pending} /> : null}
          </div>

          {/* Switched off, the column holds its place and says nothing at all. */}
          {!showHuman ? null : human.length === 0 ? (
            <p className="py-2 text-[0.6875rem] text-dim">
              {live?.pending ? 'Reading this position…' : 'No human model for this position.'}
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

        <section className="flex min-w-0 flex-col gap-2 px-3 py-2.5">
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
            {/* The run's kind takes the label slot where there is a run to name. */}
            <span className="truncate font-mono text-[0.625rem] uppercase text-faint">
              {run?.engine_kind ?? 'engine'}
            </span>
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
            <p className="py-2 text-[0.6875rem] text-dim">No engine lines for this position.</p>
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
      </div>
    </div>
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
        'flex w-full items-center gap-2 rounded-[0.25rem] border-l-2 px-1 py-[0.1875rem] text-left',
        move.played ? null : 'border-transparent',
        onPlay ? 'hover:bg-raised' : 'cursor-default',
      )}
      style={move.played ? { borderLeftColor: hue, background: tint(hue, 7) } : undefined}
    >
      <span
        className={cn(
          'w-11 flex-none truncate font-mono text-[0.6875rem]',
          verdict ? verdict.textClass : 'text-soft',
        )}
      >
        {move.san}
      </span>
      <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-[0.125rem] bg-track">
        <div
          className="h-full rounded-[0.125rem]"
          style={{ width: `${Math.min(100, share * 100)}%`, background: hue }}
        />
      </div>
      <span className="w-[1.875rem] flex-none text-right font-mono text-[0.625rem] tabular text-dim">
        {move.probability === null ? '—' : `${Math.round(move.probability * 100)}%`}
      </span>
      <span
        className={cn(
          'w-[2.75rem] flex-none text-right font-mono text-[0.625rem] tabular',
          verdict ? verdict.textClass : 'text-faint',
        )}
      >
        {loss ?? ''}
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

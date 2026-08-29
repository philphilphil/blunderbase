import { Fragment, useEffect, useRef, useState } from 'react'

import { MiniBoard } from '@/components/board/MiniBoard'
import { Skeleton } from '@/components/ui/skeleton'
import { formatNps, formatVariation, type StreamSessionApi } from '@/lib/analysis'
import type { StreamEndReason, StreamLine } from '@/lib/api/types'
import {
  cachedReplay,
  peekCaption,
  peekFen,
  type LinePreviewPrefs,
  type RowPreview,
} from '@/lib/board/linePreview'
import { setLinePreviewPrefs, useLinePreviewPrefs } from '@/lib/board/linePreviewPrefs'
import type { HoveredLine } from '@/lib/board/useLinePreview'
import { formatNodes, formatScore } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

import { AnalysisControls } from './AnalysisControls'
import { LinePreviewSettingsButton } from './LinePreviewSettings'

// What a hovered line *is* belongs to the preview, not to the panel that reports one, so
// the type lives beside the hook that consumes it — and is re-exported here because this
// is where a caller reads it off the prop.
export type { HoveredLine }

export interface InfiniteAnalysisPanelProps {
  /** The hook's whole surface; the panel renders, it never fetches. */
  stream: StreamSessionApi
  /**
   * The position the lines are read from — SAN needs it.
   */
  fen: string | null
  /** For numbering the variation; omitted numbers from move 1. */
  ply?: number | null
  /**
   * Pointing at a line offers its first move in UCI, so a surface with a board of its own
   * can preview it as an arrow; leaving a line offers `null`. Surfaces that draw nothing
   * pass nothing.
   */
  onHoverMove?: (uci: string | null) => void
  /** The line being pointed at, for a surface that draws a whole-line preview. */
  onHoverLine?: (state: HoveredLine | null) => void
  /** A wheel step along the previewed line: +1 forwards, -1 back. */
  onStepPreview?: (delta: number) => void
  /** A token clicked — enter the line, the same call `MaiaPanel` makes. */
  onPlayLine?: (ucis: string[], index: number) => void
  /** The preview's effective line and ply, handed back so the tokens can show where it is. */
  previewLine?: string | null
  previewPly?: number | null
  /** Which way up the peek board is drawn — the surface's own board, not the engine's. */
  orientation?: 'white' | 'black'
  className?: string
}

/**
 * Wheel travel that counts as one step along a line — `BoardPanel`'s constant and its
 * accumulation, because the two gestures land on the same page and a wheel that stepped the
 * board at one speed and a preview at another would read as two different wheels.
 */
const WHEEL_STEP = 10

/**
 * The id this panel gives one of its rows, and the only place it is built.
 *
 * A bare `multipv` is not an identity: the game page shows this panel and the stored-run box
 * at the same time, both number their lines from 1, and one `useLinePreview` serves both. An
 * unqualified "line 1" would make the two boxes the same row — hovering here would dim the
 * tokens there, and the hook's cache key could not tell the two lines apart.
 */
function lineId(multipv: number): string {
  return `live:${multipv}`
}

/** The cycle the header chip walks, in the order the design lists the modes. */
const ROW_MODES: RowPreview[] = ['arrows', 'overlay', 'play', 'peek', 'off']

/** What each mode does, for the chip's `title` — the words, not the vocabulary. */
const ROW_SAYS: Record<RowPreview, string> = {
  arrows: 'draws the whole line as layered arrows',
  overlay: 'shows where the pieces end up',
  play: 'plays the line out on the board',
  peek: 'opens a small board beside the row',
  off: 'draws nothing',
}

/** Whether a wheel over a row has anywhere to step: only the modes that stand on a ply. */
function canStep(prefs: LinePreviewPrefs): boolean {
  return prefs.row === 'play' || prefs.row === 'peek' || prefs.scrub
}

/**
 * The PV as one span per move rather than as one string.
 *
 * The numbering is `formatVariation`'s, restated here because that function joins its moves
 * into a single text node and the row needs them apart: a token is what the pointer names,
 * what a click enters, and what the preview dims as it walks past. The move numbers stay
 * plain text — they are punctuation between moves, not moves.
 */
function LineTokens({
  sans,
  ply,
  previewPly,
  onHoverPly,
  onPlay,
}: {
  sans: string[]
  ply: number | null | undefined
  /** The ply the preview stands on within *this* line, or null when it is elsewhere. */
  previewPly: number | null
  onHoverPly?: (at: number | null) => void
  onPlay?: (index: number) => void
}) {
  const start = typeof ply === 'number' && ply >= 0 ? ply : 0
  return (
    <>
      {sans.map((san, offset) => {
        const at = start + offset
        const number =
          at % 2 === 0
            ? `${Math.floor(at / 2) + 1}.`
            : offset === 0
              ? `${Math.floor(at / 2) + 1}…`
              : null
        const k = offset + 1
        return (
          <Fragment key={k}>
            {offset > 0 ? ' ' : null}
            <span className="whitespace-nowrap">
              {number ? <span className="text-dim">{number}</span> : null}
              <span
                data-ply={k}
                role={onPlay ? 'button' : undefined}
                tabIndex={onPlay ? 0 : undefined}
                onMouseEnter={onHoverPly ? () => onHoverPly(k) : undefined}
                // Off a token and back into the row: the row's own state, not the row's
                // `mouseleave`, which only fires when the pointer leaves the row entirely.
                onMouseLeave={onHoverPly ? () => onHoverPly(null) : undefined}
                onClick={onPlay ? () => onPlay(offset) : undefined}
                onKeyDown={
                  onPlay
                    ? (event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        onPlay(offset)
                      }
                    : undefined
                }
                className={cn(
                  // No padding on the marked token: a background that widened as the
                  // preview walked would shove the rest of the line along under the pointer.
                  'rounded-[0.1875rem]',
                  previewPly !== null && k === previewPly
                    ? 'bg-selected text-accent-teal'
                    : previewPly !== null && k < previewPly
                      ? 'text-faint-2'
                      : null,
                  onPlay ? 'cursor-pointer hover:text-ink' : null,
                )}
              >
                {san}
              </span>
            </span>
          </Fragment>
        )
      })}
    </>
  )
}

/** The end reasons the panel offers a way out of, in words rather than in wire vocabulary. */
function reasonSentence(reason: StreamEndReason, where: string): string {
  switch (reason) {
    case 'runner_gone':
      return `${where} went away mid-search.`
    case 'engine_failed':
      return `The engine on ${where} stopped mid-search.`
    case 'idle':
      return 'The search was closed for sitting idle.'
    default:
      return 'The search ended.'
  }
}

function HostChip({ runner }: { runner: string | null }) {
  return runner === null ? (
    <span
      data-testid="infinite-analysis-host"
      className="rounded-sm border border-edge bg-elevated px-1.5 py-px font-mono text-[0.59375rem] text-dim"
    >
      local
    </span>
  ) : (
    <span
      data-testid="infinite-analysis-host"
      className="inline-flex min-w-0 items-center gap-1 rounded-sm border border-edge bg-elevated px-1.5 py-px text-[0.59375rem] text-soft"
    >
      <span className="size-1 flex-none rounded-full bg-accent-teal" />
      <span className="truncate" title={runner}>{runner}</span>
    </span>
  )
}

/** Browser engines include the runner in their unique wire name; the adjacent chip owns it here. */
function displayEngine(engine: string, runner: string | null): string {
  const suffix = runner ? ` (${runner})` : ''
  return suffix && engine.endsWith(suffix) ? engine.slice(0, -suffix.length) : engine
}

/**
 * The controls sit under the lines, not over them: the lines are what the panel is for, and
 * a row that changes height as engines and hosts arrive would otherwise keep shoving them
 * down the page. Shared by the live rail and the game page, so both read the same way.
 */
function ControlsFooter({
  stream,
  fen,
}: {
  stream: StreamSessionApi
  fen: string | null
}) {
  return (
    <div className="flex flex-none items-center border-t border-hairline px-3 py-2">
      <AnalysisControls stream={stream} fen={fen} className="w-full" />
    </div>
  )
}

/**
 * What the engine is finding *now* in the position on the board.
 *
 * It sits under the stored-run panel on the game page rather than replacing it: a run says
 * what an analysis pass concluded about a move that was played, this says what a search is
 * concluding about a position nobody has left yet. Two different claims, stacked, never
 * merged.
 *
 * The scores are White-relative, like every other evaluation the app draws — the panel above
 * this one included, which is the whole reason `streamModel` flips what the engine reports.
 *
 * Three gestures point at a line, and they stay separate because they ask different
 * questions. The **row** asks where the line goes, and answers for the whole line at once;
 * a **token** asks what the position looks like after that one move, so it names a ply the
 * row cannot; the **wheel** walks that ply along without the pointer having to hit each
 * token in turn. Folding them together would lose the difference: a row-only preview cannot
 * say "here", and a token-only one cannot say "all of it". The panel only reports them —
 * what any of them draws is the surface's business, which is why they leave as callbacks
 * and the preview's position comes back as `previewLine` / `previewPly`.
 */
export function InfiniteAnalysisPanel({
  stream,
  fen,
  ply,
  onHoverMove,
  onHoverLine,
  onStepPreview,
  onPlayLine,
  previewLine,
  previewPly,
  orientation = 'white',
  className,
}: InfiniteAnalysisPanelProps) {
  const { phase, snapshot, session, offer, error, note } = stream
  const lines: StreamLine[] = [...(snapshot?.lines ?? [])].sort((a, b) => a.multipv - b.multipv)
  const prefs = useLinePreviewPrefs()

  // Which row the pointer is in. The preview's own position comes back from the surface,
  // but the wheel and the peek popover need to know where the pointer *is* right now, and
  // a surface that draws nothing still never gets asked.
  const [hovered, setHovered] = useState<number | null>(null)

  // Wheeling over the lines steps the preview: down is forwards, as everywhere else. Bound
  // by hand and non-passive for the same reason as `BoardPanel` — a passive listener cannot
  // keep the page from scrolling out from under the gesture — and bound once, so the live
  // values sit behind a ref rather than in the listener's closure.
  const linesRef = useRef<HTMLDivElement>(null)
  const stepping = useRef({ hovered, prefs, onStepPreview })
  useEffect(() => {
    stepping.current = { hovered, prefs, onStepPreview }
  })
  const travel = useRef(0)
  const showLines = lines.length > 0

  useEffect(() => {
    const node = linesRef.current
    if (!node) return
    function onWheel(event: WheelEvent) {
      // A pinch-zoom is a wheel event too, and is not a request for the next ply.
      if (event.ctrlKey) return
      const { hovered: row, prefs: current, onStepPreview: step } = stepping.current
      // Nothing to step: the page scrolls the way it always did, so a reader who has the
      // preview switched off never notices the panel took an interest in the wheel.
      if (row === null || !step || !canStep(current)) return
      event.preventDefault()
      // `deltaMode` is lines or pages on some browsers; both become rough pixels.
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1
      const delta = event.deltaY * scale
      if (delta === 0) return
      // Turning round mid-gesture starts its own count rather than paying off the old one.
      if (delta > 0 !== travel.current > 0) travel.current = 0
      travel.current += delta
      if (Math.abs(travel.current) < WHEEL_STEP) return
      const direction = travel.current > 0 ? 1 : -1
      travel.current = 0
      step(direction)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [showLines])

  const shell = cn('flex flex-none flex-col border-t border-hairline bg-panel', className)

  if (phase === 'off' && !offer) {
    return (
      <section className={shell} data-testid="infinite-analysis">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="size-1.5 flex-none rounded-full bg-edge-strong" />
          <span className="text-[0.71875rem] text-dim">
            Analyse this position continuously.
          </span>
        </div>
        {note ? (
          <p className="px-3 pb-2.5 text-[0.6875rem] text-dim">{note}</p>
        ) : null}
        <ControlsFooter stream={stream} fen={fen} />
      </section>
    )
  }

  const where = session?.runner ?? 'this machine'

  return (
    <section className={shell} data-testid="infinite-analysis">
      <div className="px-3 pb-2 pt-2.5" data-testid="infinite-analysis-header">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'size-1.5 flex-none rounded-full',
              phase === 'running'
                ? 'animate-pulse bg-accent-teal'
                : phase === 'opening'
                  ? 'bg-mistake'
                  : phase === 'error'
                    ? 'bg-blunder'
                    : 'bg-edge-strong',
            )}
          />
          <span
            data-testid="infinite-analysis-engine"
            title={session?.engine}
            className="max-w-[45%] flex-none truncate text-xs font-semibold text-ink"
          >
            {session ? displayEngine(session.engine, session.runner ?? null) : 'Live analysis'}
          </span>
          {session ? <HostChip runner={session.runner ?? null} /> : null}
          <div className="flex-1" />
          {onHoverLine ? (
            <button
              type="button"
              onClick={() =>
                setLinePreviewPrefs({
                  row: ROW_MODES[(ROW_MODES.indexOf(prefs.row) + 1) % ROW_MODES.length]!,
                })
              }
              title={`Hovering a line ${ROW_SAYS[prefs.row]}. Click to cycle.`}
              className="bb-chip flex-none px-1.5 py-px font-mono text-[0.625rem] text-dim transition-colors hover:text-ink"
            >
              {prefs.row}
            </button>
          ) : null}
          {onHoverLine ? <LinePreviewSettingsButton /> : null}
        </div>

        <div className="mt-1 flex min-w-0 items-center gap-2 pl-3.5" data-testid="infinite-analysis-meta">
          <div className="flex-1" />
          {snapshot?.depth ? (
            <span className="flex-none whitespace-nowrap font-mono text-[0.625rem] tabular text-dim">d{snapshot.depth}</span>
          ) : null}
          {snapshot?.nodes ? (
            <span className="flex-none whitespace-nowrap font-mono text-[0.625rem] tabular text-dim">
              {formatNodes(snapshot.nodes)} nodes
            </span>
          ) : null}
          {snapshot?.nps ? (
            <span className="flex-none whitespace-nowrap font-mono text-[0.625rem] tabular text-dim">
              {formatNps(snapshot.nps)}
            </span>
          ) : null}
        </div>
      </div>

      {offer ? (
        <div className="mx-1.5 mb-1.5 rounded-md border border-mistake/28 bg-mistake/5 px-2.5 py-2">
          <p className="text-[0.71875rem] text-mistake">
            {reasonSentence(offer.reason, where)}
          </p>
          {offer.error ? (
            <p className="mt-1 font-mono text-[0.625rem] text-mistake/80">{offer.error}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {offer.candidates.map((host) => (
              <button
                key={host.engineId}
                type="button"
                onClick={() => stream.resume(host.engineId)}
                className="rounded-md border border-edge bg-elevated px-2 py-[0.1875rem] text-[0.6875rem] text-soft transition-colors hover:border-edge-hover hover:text-ink"
              >
                Resume on {host.name}
              </button>
            ))}
            <button
              type="button"
              onClick={stream.dismissOffer}
              className="rounded-md px-2 py-[0.1875rem] text-[0.6875rem] text-dim transition-colors hover:text-ink"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'error' && error ? (
        <p className="mx-1.5 mb-1.5 rounded-md border border-blunder/28 bg-blunder/5 px-2.5 py-2 text-[0.71875rem] text-blunder">
          {error.message}
        </p>
      ) : null}

      {phase === 'opening' || (phase === 'running' && lines.length === 0) ? (
        // A "running" dot over an empty body reads as broken; three rows of the right
        // height say the search has started and has not reported yet.
        <div className="flex flex-col gap-1 px-3 pb-2.5" data-testid="infinite-analysis-pending">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-[1.625rem] w-full" />
          ))}
        </div>
      ) : null}

      {showLines ? (
        <div
          ref={linesRef}
          data-testid="infinite-analysis-lines"
          className="flex flex-col px-1.5 pb-1.5 font-mono text-[0.71875rem]"
        >
          {lines.map((line) => {
            // One replay per line, memoised on the position and the PV: the tokens, the peek
            // board and the surface's own preview all want the same walk, and a live engine
            // hands the panel a new snapshot several times a second.
            const replay = fen ? cachedReplay(fen, line.pv) : null
            const sans = replay?.moves.map((move) => move.san) ?? []
            // A position chessops will not replay still has something true to show: the
            // engine's own UCI. Better a row of `e2e4 e7e5` than a blank one — and no
            // tokens, because there is no ply behind them to point at.
            const text = sans.length > 0 ? formatVariation(ply, sans) : line.pv.join(' ')
            // The preview's ply counts for this row only where the preview is on this row;
            // on any other it stands nowhere, and the tokens say so by staying plain.
            const id = lineId(line.multipv)
            const at = previewLine === id ? (previewPly ?? null) : null
            const state = { line: id, ply: at }
            // Peek draws beside the row instead of on the board, so it is the panel's own
            // job — and only while this row is the one under the pointer.
            const peeking =
              replay && prefs.row === 'peek' && onHoverLine && hovered === line.multipv
                ? replay
                : null
            const peek = peeking ? peekFen(peeking, prefs, state) : null
            const caption = peeking ? peekCaption(peeking, prefs, state, ply ?? 0) : null
            return (
              <div
                key={line.multipv}
                data-testid="infinite-analysis-line"
                onMouseEnter={() => {
                  setHovered(line.multipv)
                  onHoverMove?.(line.pv[0] ?? null)
                  onHoverLine?.({ line: id, ply: null, pv: line.pv })
                }}
                onMouseLeave={() => {
                  setHovered((row) => (row === line.multipv ? null : row))
                  onHoverMove?.(null)
                  onHoverLine?.(null)
                }}
                className="relative flex h-[1.625rem] items-center gap-[0.5625rem] rounded-[0.3125rem] px-1.5 hover:bg-raised"
              >
                <span
                  className={cn(
                    'min-w-11 rounded-[0.1875rem] px-1.5 py-0.5 text-right tabular',
                    line.multipv === 1 ? 'bg-cell-strong text-ink-2' : 'bg-cell text-body-3',
                  )}
                >
                  {formatScore({ cp: line.cp, mate: line.mate })}
                </span>
                <span
                  data-testid="infinite-analysis-pv"
                  className="flex-1 truncate text-soft"
                  title={text || undefined}
                >
                  {sans.length > 0 ? (
                    <LineTokens
                      sans={sans}
                      ply={ply}
                      previewPly={at}
                      // A token names a ply, which is only worth reporting where something
                      // scrubs to it; without that the row's own answer stands.
                      onHoverPly={
                        onHoverLine && prefs.scrub
                          ? (k) => onHoverLine({ line: id, ply: k, pv: line.pv })
                          : undefined
                      }
                      onPlay={onPlayLine ? (index) => onPlayLine(line.pv, index) : undefined}
                    />
                  ) : (
                    text || '—'
                  )}
                </span>
                {peek ? (
                  // Above the row, not below it: this panel hangs off the bottom of a column
                  // that clips what overflows it (`GamePage`'s `overflow-hidden`), so a board
                  // drawn downwards would be cut in half by the edge of the window.
                  // `pointer-events-none`, so walking along the tokens never lands on the
                  // popover and takes the hover — the row's own state has to survive it.
                  <div className="pointer-events-none absolute bottom-full right-1.5 z-20 mb-1 flex flex-col items-center gap-1 rounded-md border border-edge bg-elevated p-1.5 shadow-lg">
                    <MiniBoard
                      fen={peek}
                      orientation={orientation}
                      size="7.5rem"
                      label="Peek at the line"
                    />
                    {caption ? (
                      <span className="font-mono text-[0.59375rem] text-dim">{caption}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      <ControlsFooter stream={stream} fen={fen} />
    </section>
  )
}

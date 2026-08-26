import { Skeleton } from '@/components/ui/skeleton'
import { formatNps, formatVariation, sanLine, type StreamSessionApi } from '@/lib/analysis'
import type { StreamEndReason, StreamLine } from '@/lib/api/types'
import { formatNodes, formatScore } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

import { AnalysisControls } from './AnalysisControls'

export interface InfiniteAnalysisPanelProps {
  /** The hook's whole surface; the panel renders, it never fetches. */
  stream: StreamSessionApi
  /**
   * The position the lines are read from — SAN needs it, and its turn labels the eval's
   * point of view.
   */
  fen: string | null
  /** For numbering the variation; omitted numbers from move 1. */
  ply?: number | null
  className?: string
}

/** Whose move it is, straight off the FEN's second field. */
function turnOf(fen: string | null): 'white' | 'black' | null {
  if (!fen) return null
  return fen.split(/\s+/)[1] === 'b' ? 'black' : 'white'
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
    <span className="rounded-sm border border-edge bg-elevated px-1.5 py-px font-mono text-[0.59375rem] text-dim">
      local
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-sm border border-edge bg-elevated px-1.5 py-px text-[0.59375rem] text-soft">
      <span className="size-1 flex-none rounded-full bg-accent-teal" />
      {runner}
    </span>
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
 * The header still names whose move it is, which is the one thing about the position the
 * lines alone do not say.
 */
export function InfiniteAnalysisPanel({
  stream,
  fen,
  ply,
  className,
}: InfiniteAnalysisPanelProps) {
  const { phase, snapshot, session, offer, error, note } = stream
  const turn = turnOf(fen)
  const lines: StreamLine[] = [...(snapshot?.lines ?? [])].sort((a, b) => a.multipv - b.multipv)

  const shell = cn('flex flex-none flex-col border-t border-hairline bg-panel', className)

  if (phase === 'off' && !offer) {
    return (
      <section className={shell} data-testid="infinite-analysis">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="size-1.5 flex-none rounded-full bg-edge-strong" />
          <span className="text-[0.71875rem] text-dim">
            Analyse this position continuously.
          </span>
          <div className="flex-1" />
          <AnalysisControls stream={stream} fen={fen} />
        </div>
        {note ? (
          <p className="px-3 pb-2.5 text-[0.6875rem] text-dim">{note}</p>
        ) : null}
      </section>
    )
  }

  const where = session?.runner ?? 'this machine'

  return (
    <section className={shell} data-testid="infinite-analysis">
      <div className="flex items-center gap-2 px-3 pb-2 pt-2.5">
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
          className="text-xs font-semibold text-ink"
        >
          {session?.engine ?? 'Live analysis'}
        </span>
        {session ? <HostChip runner={session.runner ?? null} /> : null}
        {turn ? (
          <span className="text-[0.625rem] text-dim">{turn} to move</span>
        ) : null}
        <div className="flex-1" />
        {snapshot?.depth ? (
          <span className="font-mono text-[0.625rem] tabular text-dim">d{snapshot.depth}</span>
        ) : null}
        {snapshot?.nodes ? (
          <span className="font-mono text-[0.625rem] tabular text-dim">
            {formatNodes(snapshot.nodes)} nodes
          </span>
        ) : null}
        {snapshot?.nps ? (
          <span className="font-mono text-[0.625rem] tabular text-dim">
            {formatNps(snapshot.nps)}
          </span>
        ) : null}
        <AnalysisControls stream={stream} fen={fen} />
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

      {lines.length > 0 ? (
        <div className="flex flex-col px-1.5 pb-1.5 font-mono text-[0.71875rem]">
          {lines.map((line) => {
            const sans = fen ? sanLine(fen, line.pv) : []
            // A position chessops will not replay still has something true to show: the
            // engine's own UCI. Better a row of `e2e4 e7e5` than a blank one.
            const text = sans.length > 0 ? formatVariation(ply, sans) : line.pv.join(' ')
            return (
              <div
                key={line.multipv}
                data-testid="infinite-analysis-line"
                className="flex h-[1.625rem] items-center gap-[0.5625rem] rounded-[0.3125rem] px-1.5 hover:bg-raised"
              >
                <span
                  className={cn(
                    'min-w-11 rounded-[0.1875rem] px-1.5 py-0.5 text-right tabular',
                    line.multipv === 1 ? 'bg-cell-strong text-ink-2' : 'bg-cell text-body-3',
                  )}
                >
                  {formatScore({ cp: line.cp, mate: line.mate })}
                </span>
                <span className="flex-1 truncate text-soft" title={text || undefined}>
                  {text || '—'}
                </span>
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

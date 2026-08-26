import type { GameRunSummary, RunResponse } from '@/lib/api/types'
import { formatNodes } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

export interface RunProgress {
  done: number
  total: number
}

/**
 * The deep-analysis trigger from design 1a. It is the only place in the game view that
 * writes: `POST /analysis { game_id, tier: "deep" }`, then follows the run through the
 * `/events` socket rather than polling.
 *
 * Budget and multi-PV are the server's (`Settings.deep_nodes`, `Settings.deep_multipv`),
 * so the card describes them from the run once one exists rather than promising numbers
 * the frontend cannot know.
 */
export function DeepAnalysisCard({
  deepRun,
  activeRun,
  progress,
  pending,
  error,
  onRequestDeep,
  onRequestQuick,
  className,
}: {
  /** The newest finished deep run over this game, if there is one. */
  deepRun: GameRunSummary | null
  /** A run over this game that is queued or running right now. */
  activeRun: RunResponse | null
  /** Live ply counts from `analysis.progress`, while a run is working. */
  progress: RunProgress | null
  pending: boolean
  error: Error | null
  onRequestDeep: () => void
  onRequestQuick: () => void
  className?: string
}) {
  const busy = activeRun !== null || pending
  const share =
    progress && progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : null

  return (
    <div
      className={cn(
        'flex flex-col gap-[0.5625rem] rounded-lg border border-edge bg-[linear-gradient(180deg,var(--bb-card-grad-a),var(--bb-card-grad-b))] p-3',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-ink">Deep analysis</span>
        <span className="rounded-sm border border-brilliant/28 bg-brilliant/10 px-[0.3125rem] py-px text-[0.625rem] text-brilliant">
          {deepRun?.multipv ? `multi-PV ${deepRun.multipv}` : 'multi-PV'}
        </span>
        {deepRun ? (
          <span className="font-mono text-[0.625rem] tabular text-faint">
            {formatNodes(deepRun.nodes)} nodes
          </span>
        ) : null}
      </div>

      <p className="text-[0.71875rem] leading-[1.5] text-soft-2">
        {deepRun
          ? 'A deep pass has already run over this game. Requesting another re-analyses every ply — runs are never overwritten.'
          : 'The deep tier’s full node budget per position, several candidate lines per move, and Maia’s human model where one is configured.'}
      </p>

      {activeRun ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-[0.6875rem]">
            <span className="text-soft">
              {activeRun.status === 'running' ? 'Analysing' : 'Queued'} · {activeRun.tier}
            </span>
            <div className="flex-1" />
            <span className="font-mono text-[0.6875rem] tabular text-ink">
              {progress ? `${progress.done}/${progress.total}` : `run #${activeRun.id}`}
            </span>
          </div>
          <div className="h-[0.1875rem] overflow-hidden rounded-sm bg-edge">
            <div
              className={cn(
                'h-full bg-accent-teal',
                share === null && 'w-1/3 animate-pulse',
              )}
              style={share === null ? undefined : { width: `${share}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onRequestDeep}
            className="flex-1 rounded-md bg-accent-teal px-2.5 py-2 text-center text-xs font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50"
          >
            {pending ? 'Queueing…' : 'Request deep analysis'}
          </button>
          <button
            type="button"
            disabled={busy}
            title="Queue a quick pass instead"
            onClick={onRequestQuick}
            className="rounded-md border border-edge-input px-2.5 py-2 text-xs text-soft hover:border-edge-hover hover:text-ink disabled:opacity-50"
          >
            Quick
          </button>
        </div>
      )}

      {error ? (
        <p className="rounded-md border border-blunder/30 bg-blunder/5 px-2 py-1.5 text-[0.6875rem] text-blunder">
          {error.message}
        </p>
      ) : null}
    </div>
  )
}

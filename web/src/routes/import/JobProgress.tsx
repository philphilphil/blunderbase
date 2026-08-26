import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

import type { SourceProgress } from './useImportProgress'

/** How many per-game failures the inline block shows before it defers to the history. */
const SHOWN_FAILURES = 4

function label(progress: SourceProgress): { text: string; tone: string } {
  if (progress.running) return { text: 'Syncing', tone: 'text-soft' }
  if (progress.status === 'failed') return { text: 'Sync failed', tone: 'text-blunder' }
  if (progress.failed > 0) return { text: `Finished — ${progress.failed} failed`, tone: 'text-mistake' }
  return { text: 'Finished', tone: 'text-good' }
}

/**
 * A sync as it happens: the counts every `import.game` frame carries, and the reason any
 * of them did not make it in. Nothing here polls — the frames are the progress.
 */
export function JobProgress({
  progress,
  className,
}: {
  progress: SourceProgress
  className?: string
}) {
  const { text, tone } = label(progress)
  const settled = progress.imported + progress.skipped + progress.failed
  const bar =
    progress.status === 'failed' || progress.failed > 0
      ? 'bg-blunder'
      : progress.running
        ? 'bg-accent-teal'
        : 'bg-good'
  const extra = progress.failures.length - SHOWN_FAILURES

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-md border px-2.5 py-2',
        progress.status === 'failed'
          ? 'border-blunder/28 bg-blunder/5'
          : 'border-edge bg-elevated',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn('flex-1 text-[0.6875rem]', tone)}>{text}</span>
        {progress.jobId !== null ? (
          <span className="font-mono text-[0.625rem] text-faint">job {progress.jobId}</span>
        ) : null}
        <span className="font-mono text-[0.6875rem] text-ink tabular">
          {settled}/{progress.seen}
        </span>
      </div>

      <Progress
        value={settled}
        max={Math.max(1, progress.seen)}
        barClassName={cn(bar, progress.running && progress.seen === 0 && 'animate-pulse')}
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.65625rem] text-dim tabular">
        <span className="text-soft">{progress.imported} imported</span>
        <span>{progress.skipped} skipped</span>
        <span className={progress.failed > 0 ? 'text-blunder' : undefined}>
          {progress.failed} failed
        </span>
        {progress.lastRef ? (
          <span className="min-w-0 flex-1 truncate text-right text-faint">{progress.lastRef}</span>
        ) : null}
      </div>

      {progress.status === 'failed' && progress.message ? (
        <p className="font-mono text-[0.65625rem] leading-[1.5] text-blunder">{progress.message}</p>
      ) : null}

      {progress.failures.length > 0 ? (
        <ul className="flex flex-col gap-1 border-t border-hairline pt-1.5">
          {progress.failures.slice(-SHOWN_FAILURES).map((failure, index) => (
            <li key={`${failure.ref}-${index}`} className="flex gap-2 font-mono text-[0.65625rem]">
              <span className="w-24 flex-none truncate text-soft-2">{failure.ref}</span>
              <span className="min-w-0 flex-1 truncate text-blunder">{failure.error}</span>
            </li>
          ))}
          {extra > 0 ? (
            <li className="text-[0.65625rem] text-dim">and {extra} more — see the sync history</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}

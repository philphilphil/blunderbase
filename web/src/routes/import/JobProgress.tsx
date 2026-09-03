import { Loader2, Square } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useCancelImport } from '@/lib/api/queries'
import { cn } from '@/lib/utils'

import type { SourceProgress } from './useImportProgress'

/** How many per-game failures the inline block shows before it defers to the history. */
const SHOWN_FAILURES = 4

function label(progress: SourceProgress, stopping: boolean): { text: string; tone: string } {
  if (progress.running) return { text: stopping ? 'Stopping' : 'Syncing', tone: 'text-soft' }
  if (progress.status === 'failed') return { text: 'Sync failed', tone: 'text-blunder' }
  if (progress.status === 'cancelled') return { text: 'Stopped', tone: 'text-mistake' }
  if (progress.failed > 0) return { text: `Finished — ${progress.failed} failed`, tone: 'text-mistake' }
  return { text: 'Finished', tone: 'text-good' }
}

/**
 * How the box holding this progress should be tinted.
 *
 * The state of a sync belongs to the source it is a sync of, so it colours that whole box
 * rather than a bordered inset inside one — a card the size of a run's own progress does
 * not need two frames to say one thing. Exported because both cards must agree on it.
 */
export function progressChrome(progress: SourceProgress | undefined): string {
  if (!progress) return 'border-edge'
  if (progress.status === 'failed') return 'border-blunder/30 bg-blunder/[0.06]'
  if (progress.status === 'cancelled') return 'border-mistake/30'
  if (progress.running) return 'border-accent-teal/35'
  return 'border-edge'
}

/**
 * A sync as it happens: the counts every `import.game` frame carries, and the reason any
 * of them did not make it in. Nothing here polls — the frames are the progress.
 *
 * It is the lower half of the box for the source that is running, under a hairline rather
 * than in a frame of its own (see `progressChrome`), and every line of it wraps: a box is
 * a quarter of a wide page and a third of a narrow one, so nothing here may assume a width.
 *
 * Stop lives here because this is the only part of the screen that knows a job id, and
 * because a run in flight is the only thing there is to stop. It takes effect between two
 * games, so the label says "Stopping" until the finished frame arrives; what is already in
 * the library stays, and the next run skips past it.
 */
export function JobProgress({
  progress,
  className,
}: {
  progress: SourceProgress
  className?: string
}) {
  const cancel = useCancelImport()
  const jobId = progress.jobId
  // The request returns long before the loop notices, so the mutation's own state is what
  // holds "asked" until `import.finished` turns the block into a stopped one. Scoped to the
  // job it was asked for — a second sync started after a stopped one is not stopping.
  const mine = cancel.variables === jobId
  const stopping = mine && (cancel.isPending || cancel.isSuccess)
  const { text, tone } = label(progress, stopping)
  const settled = progress.imported + progress.skipped + progress.blocked + progress.failed
  const bar =
    progress.status === 'failed' || progress.failed > 0
      ? 'bg-blunder'
      : progress.status === 'cancelled'
        ? 'bg-mistake'
        : progress.running
          ? 'bg-accent-teal'
          : 'bg-good'
  const extra = progress.failures.length - SHOWN_FAILURES

  return (
    <div className={cn('flex flex-col gap-2 border-t border-hairline pt-2.5', className)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cn('text-[0.6875rem]', tone)}>{text}</span>
        {jobId !== null ? (
          <span className="font-mono text-[0.625rem] text-faint">job {jobId}</span>
        ) : null}
        <div className="flex-1" />
        <span className="font-mono text-[0.6875rem] text-ink tabular">
          {settled}/{progress.seen}
        </span>
        {progress.running && jobId !== null ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={stopping}
            title="Stop after the game it is on. Everything imported so far stays, and running the import again picks up from there."
            onClick={() => cancel.mutate(jobId)}
          >
            {stopping ? <Loader2 className="animate-spin" aria-hidden /> : <Square aria-hidden />}
            {stopping ? 'Stopping' : 'Stop'}
          </Button>
        ) : null}
      </div>

      {mine && cancel.isError ? (
        <p className="text-[0.6875rem] text-blunder">{cancel.error.message}</p>
      ) : null}

      <Progress
        value={settled}
        max={Math.max(1, progress.seen)}
        barClassName={cn(bar, progress.running && progress.seen === 0 && 'animate-pulse')}
      />

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[0.65625rem] text-dim tabular">
        <span className="text-soft">{progress.imported} imported</span>
        <span>{progress.skipped} skipped</span>
        {/* Only when there are any: on the ordinary sync this line is already four numbers
            long, and a permanent "0 previously deleted" would be the loudest of them. */}
        {progress.blocked > 0 ? (
          <span className="text-mistake">{progress.blocked} previously deleted</span>
        ) : null}
        <span className={progress.failed > 0 ? 'text-blunder' : undefined}>
          {progress.failed} failed
        </span>
      </div>

      {progress.lastRef ? (
        <p className="truncate font-mono text-[0.65625rem] text-faint">{progress.lastRef}</p>
      ) : null}

      {progress.status === 'failed' && progress.message ? (
        <p className="font-mono text-[0.65625rem] leading-[1.5] text-blunder">{progress.message}</p>
      ) : null}

      {progress.failures.length > 0 ? (
        <ul className="flex flex-col gap-1 border-t border-hairline pt-1.5">
          {progress.failures.slice(-SHOWN_FAILURES).map((failure, index) => (
            <li key={`${failure.ref}-${index}`} className="flex flex-col font-mono text-[0.65625rem]">
              <span className="truncate text-soft-2">{failure.ref}</span>
              <span className="truncate text-blunder">{failure.error}</span>
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

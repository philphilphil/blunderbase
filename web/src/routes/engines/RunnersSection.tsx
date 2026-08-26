import { Plus, Server } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { RunnersStatus } from '@/lib/api/types'

import { CreateRunnerForm } from './CreateRunnerForm'
import { RunnerCard } from './RunnerCard'

/**
 * The machines that run engine work for this server.
 *
 * Sits below the engine roster rather than beside it: with no runner registered the whole
 * block is one empty state, and the page reads exactly as it did before runners existed.
 */
export function RunnersSection({
  status,
  isLoading,
  error,
  onRetry,
}: {
  status?: RunnersStatus
  isLoading?: boolean
  error?: Error | null
  onRetry?: () => void
}) {
  const [adding, setAdding] = useState(false)
  const runners = status?.runners ?? []

  return (
    <section className="flex flex-col gap-3 border-t border-hairline pt-5">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-sm font-semibold text-ink">Runners</h2>
          <p className="text-[0.71875rem] leading-[1.5] text-dim">
            Machines that run engine work for this server. With none registered, everything runs
            here — exactly as before.
          </p>
        </div>
        <div className="flex-1" />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setAdding(true)}
          disabled={adding}
        >
          <Plus aria-hidden />
          Add runner
        </Button>
      </div>

      {adding ? <CreateRunnerForm onCancel={() => setAdding(false)} /> : null}

      {error ? (
        <div className="rounded-xl border border-blunder/28 bg-blunder/5 px-4 py-6 text-center">
          <p className="text-[0.78125rem] text-blunder">The runners could not be read.</p>
          <p className="mt-1 font-mono text-[0.6875rem] text-blunder/80">{error.message}</p>
          {onRetry ? (
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : isLoading ? (
        <Skeleton className="h-24 w-full" data-testid="runners-loading" />
      ) : runners.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-edge-strong bg-panel/60 px-4 py-8 text-center">
          <Server className="size-5 text-faint" aria-hidden />
          <p className="text-[0.78125rem] text-soft">No runners are registered.</p>
          <p className="max-w-md text-[0.71875rem] leading-[1.5] text-dim">
            Every engine job runs on this machine. Register one with{' '}
            <span className="font-mono text-soft">blunderbase runners create</span> or the button
            above, then follow <span className="font-mono text-soft">docs/runners.md</span> on the
            other machine.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {runners.map((runner) => (
            <RunnerCard key={runner.id} runner={runner} />
          ))}
        </div>
      )}
    </section>
  )
}

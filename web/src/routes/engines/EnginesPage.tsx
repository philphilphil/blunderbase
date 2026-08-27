import { Cpu, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useEngines, useRunnersStatus, useTierStatus } from '@/lib/api/queries'
import { hostByEngineId } from '@/lib/engines/hosts'

import { AddEngineForm } from './AddEngineForm'
import { EngineDetail } from './EngineDetail'
import { EngineList } from './EngineList'
import { RunnersSection } from './RunnersSection'
import { TierStatus } from './TierStatus'

/**
 * Settings → Engines. No dedicated design turn; same shell, cards and badges.
 *
 * The roster on the left, one engine whole on the right — every write path on the backend
 * probes the binary, so this page is where a bad engine is found rather than at analysis
 * time three minutes into a run.
 *
 * `/engines` carries no `runner_id`, so where each binary actually lives is joined in from
 * `/runners/status` on engine id (`lib/engines/hosts.ts`). That join is what turns a row
 * into a read-only advertisement and what puts "queue only" on a poll-mode machine — and it
 * is a second read, which can land after the roster or not at all, so the detail card is
 * told whether it has arrived rather than left to read "no binding" as "local".
 */
export function EnginesPage() {
  const engines = useEngines()
  const tiers = useTierStatus()
  const status = useRunnersStatus()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)

  const list = engines.data ?? []
  const selected = list.find((engine) => engine.id === selectedId) ?? null
  const hosts = useMemo(() => hostByEngineId(status.data), [status.data])

  // Whatever the roster holds, something is selected: the first engine on load, and the
  // next one along after one is removed.
  useEffect(() => {
    if (list.length === 0) {
      if (selectedId !== null) setSelectedId(null)
      return
    }
    if (!list.some((engine) => engine.id === selectedId)) setSelectedId(list[0]!.id)
  }, [list, selectedId])

  return (
    <PageBody>
      <SetPageChrome
        breadcrumb={[{ label: 'Settings', to: '/settings' }, { label: 'Engines' }]}
      />
      <PageHeader
        title="Engines"
        description="Add a binary, edit its UCI options against what it declares, test-run it."
        actions={
          <Button type="button" size="sm" onClick={() => setAdding(true)} disabled={adding}>
            <Plus aria-hidden />
            Add engine
          </Button>
        }
      />

      <TierStatus tiers={tiers.data} isLoading={tiers.isPending} error={tiers.error} />

      {adding ? (
        <AddEngineForm
          onCancel={() => setAdding(false)}
          onAdded={(engine) => {
            setAdding(false)
            setSelectedId(engine.id)
          }}
        />
      ) : null}

      {engines.isPending ? (
        <div className="flex gap-4" data-testid="engines-loading">
          <div className="flex w-[18.75rem] flex-none flex-col gap-1.5">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
          <Skeleton className="h-64 flex-1" />
        </div>
      ) : engines.isError ? (
        <div className="rounded-xl border border-blunder/28 bg-blunder/5 px-4 py-6 text-center">
          <p className="text-[0.78125rem] text-blunder">The engine list could not be read.</p>
          <p className="mt-1 font-mono text-[0.6875rem] text-blunder/80">{engines.error.message}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void engines.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-edge-strong bg-panel/60 px-4 py-10 text-center">
          <Cpu className="size-5 text-faint" aria-hidden />
          <p className="text-[0.78125rem] text-soft">No engines are registered.</p>
          <p className="max-w-sm text-[0.71875rem] leading-[1.5] text-dim">
            Nothing can be analysed until one is. Point Blunderbase at a Stockfish binary —
            it is probed on the way in, so a wrong path is refused here rather than in the
            middle of a run.
          </p>
          {adding ? null : (
            <Button type="button" size="sm" className="mt-1.5" onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              Add engine
            </Button>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-4">
          <div className="w-[18.75rem] flex-none">
            <EngineList
              engines={list}
              hosts={hosts}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
          {selected ? (
            <EngineDetail
              key={selected.id}
              engine={selected}
              host={hosts.get(selected.id)}
              // `/engines` and `/runners/status` are two reads: an engine with no binding
              // *yet* is not a local engine, and the card must not treat it as one.
              hostKnown={status.isSuccess}
              tiers={tiers.data ?? []}
              onDeleted={() => setSelectedId(null)}
            />
          ) : null}
        </div>
      )}

      <RunnersSection
        status={status.data}
        isLoading={status.isPending}
        error={status.error}
        onRetry={() => void status.refetch()}
      />
    </PageBody>
  )
}

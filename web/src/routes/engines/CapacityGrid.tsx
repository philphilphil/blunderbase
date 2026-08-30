import { Info, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { EngineResponse, LocalHost, RunnersStatus } from '@/lib/api/types'
import { useBrowserRunner } from '@/lib/runner'

import { AddEngineForm } from './AddEngineForm'
import { BrowserRunnerSection } from './BrowserRunnerSection'
import { CreateRunnerForm } from './CreateRunnerForm'
import { MachineEngineList } from './MachineEngineList'
import { MachineRow } from './MachineRow'
import { RunnerCard } from './RunnerCard'

/**
 * Capacity is deliberately secondary to the engine inventory: it answers where work can
 * run and how another host joins, without listing every engine a second time in its summary.
 * Three unlike hosts remain separate — this server, this browser, remote runners — because
 * calling the first two "local" would be false when the deployment itself is remote.
 *
 * Details and forms share the page's single `openDetail` slot with engine editors. This is
 * what keeps the one-page design from regressing into the old wall of permanently expanded
 * cards. Creation also lives on the host that owns it: path-based engines on This server,
 * browser Stockfish on This browser, yaml-configured engines on a remote runner.
 */
export function CapacityGrid({
  remoteRunnersEnabled,
  status,
  isLoading,
  error,
  onRetry,
  openDetail,
  onOpenDetail,
  onEngineAdded,
}: {
  remoteRunnersEnabled: boolean
  status?: RunnersStatus
  isLoading: boolean
  error: Error | null
  onRetry: () => void
  openDetail: string | null
  onOpenDetail: (detail: string | null) => void
  onEngineAdded: (engine: EngineResponse) => void
}) {
  const browser = useBrowserRunner()
  const browserRunner = status?.runners.find((runner) => runner.id === browser.runnerId)
  const remoteRunners = (status?.runners ?? []).filter((runner) => runner.id !== browser.runnerId)
  const toggle = (key: string) => onOpenDetail(openDetail === key ? null : key)

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start gap-3 max-md:flex-wrap">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold text-ink">Compute capacity</h2>
          <p className="mt-1 text-[0.6875rem] leading-[1.5] text-dim">
            {remoteRunnersEnabled
              ? 'This server, this browser, and remote machines that can take engine work.'
              : 'The engines and analysis capacity on this computer.'}
          </p>
        </div>
        <div className="flex-1" />
        {remoteRunnersEnabled ? (
          <>
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="How remote runners work"
              title="How remote runners work"
              aria-expanded={openDetail === 'remote-info'}
              onClick={() => toggle('remote-info')}
            >
              <Info aria-hidden />
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => toggle('add-remote-runner')}
              aria-expanded={openDetail === 'add-remote-runner'}
            >
              <Plus aria-hidden />
              Remote runner
            </Button>
          </>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-blunder/28 bg-blunder/5 px-4 py-5 text-center">
          <p className="text-[0.78125rem] text-blunder">Compute capacity could not be read.</p>
          <p className="mt-1 font-mono text-[0.6875rem] text-blunder/80">{error.message}</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : isLoading || !status ? (
        <div
          className={
            remoteRunnersEnabled
              ? 'grid grid-cols-3 gap-2.5 max-md:grid-cols-1'
              : 'grid grid-cols-1 gap-2.5'
          }
          data-testid="machines-loading"
        >
          {remoteRunnersEnabled ? <Skeleton className="h-20 w-full" /> : null}
          {remoteRunnersEnabled ? <Skeleton className="h-20 w-full" /> : null}
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        // One machine card per row below `md`. `col-span-full` details keep working:
        // a full span of one column is still the whole width.
        <div
          className={
            remoteRunnersEnabled
              ? 'grid grid-cols-3 gap-2.5 max-md:grid-cols-1'
              : 'grid grid-cols-1 gap-2.5'
          }
        >
          <ServerCard
            local={status.local}
            localOnly={!remoteRunnersEnabled}
            expanded={openDetail === 'server'}
            onToggle={() => toggle('server')}
            adding={openDetail === 'add-engine'}
            onAdd={() => toggle('add-engine')}
          />
          {remoteRunnersEnabled ? (
            <BrowserRunnerSection
              runner={browserRunner}
              expanded={openDetail === 'browser'}
              onToggleExpand={() => toggle('browser')}
              layout="card"
            />
          ) : null}
          {remoteRunnersEnabled
            ? remoteRunners.map((runner) => (
                <RunnerCard
                  key={runner.id}
                  runner={runner}
                  expanded={openDetail === `runner:${runner.id}`}
                  onToggleExpand={() => toggle(`runner:${runner.id}`)}
                  layout="card"
                />
              ))
            : null}

          {remoteRunnersEnabled && openDetail === 'remote-info' ? <RemoteRunnerInfo /> : null}
          {openDetail === 'add-engine' ? (
            <div className="order-1 col-span-full">
              <AddEngineForm
                onCancel={() => onOpenDetail(null)}
                onAdded={onEngineAdded}
              />
            </div>
          ) : null}
          {remoteRunnersEnabled && openDetail === 'add-remote-runner' ? (
            <div className="order-1 col-span-full">
              <CreateRunnerForm onCancel={() => onOpenDetail(null)} />
            </div>
          ) : null}
        </div>
      )}

      {remoteRunnersEnabled && !isLoading && !error && remoteRunners.length === 0 ? (
        <p className="text-[0.6875rem] text-dim-2">
          No remote runners are registered. This server and browser still work independently.
        </p>
      ) : null}
    </section>
  )
}

/** This process owns path-based engines, so it alone carries the add-engine action. */
function ServerCard({
  local,
  localOnly,
  expanded,
  onToggle,
  adding,
  onAdd,
}: {
  local: LocalHost
  localOnly: boolean
  expanded: boolean
  onToggle: () => void
  adding: boolean
  onAdd: () => void
}) {
  const used = local.busy + local.streams
  const total = local.slots ?? null
  return (
    <MachineRow
      tone={local.workers ? 'connected' : 'degraded'}
      name={localOnly ? 'This computer' : 'This server'}
      caption={local.workers ? 'ready for queued work' : 'not draining the queue'}
      type={localOnly ? 'Computer' : 'Server'}
      slots={total === null ? String(used) : `${used}/${total}`}
      engines={String(local.engines.length)}
      expanded={expanded}
      onToggleExpand={onToggle}
      ariaLabel={`${expanded ? 'Collapse' : 'Expand'} ${localOnly ? 'this computer' : 'this server'}`}
      layout="card"
      actions={
        <Button type="button" size="sm" variant="ghost" onClick={onAdd} aria-expanded={adding}>
          <Plus aria-hidden />
          Engine
        </Button>
      }
      detail={
        <div className="flex flex-col gap-3">
          {local.workers ? (
            <p className="text-[0.6875rem] leading-[1.6] text-dim">
              {local.queued} queued and {local.running} running here. Paths and options for
              these engines are editable in the inventory above.
            </p>
          ) : (
            <p className="text-[0.6875rem] leading-[1.6] text-mistake">
              This process is not draining the queue. Runs wait until a worker picks them up.
            </p>
          )}
          <MachineEngineList engines={local.engines} streamable connected />
        </div>
      }
    />
  )
}

/**
 * The remote setup model in one place: an outbound connection, a one-time bearer token and
 * yaml owned by the other machine. The eventual documentation can deepen this explanation;
 * the screen still needs enough now to make the button understandable before it is pressed.
 */
function RemoteRunnerInfo() {
  return (
    <div className="order-1 col-span-full rounded-lg border border-edge-strong bg-elevated px-3.5 py-3">
      <h3 className="text-[0.75rem] font-medium text-ink">How remote runners work</h3>
      <p className="mt-1.5 text-[0.6875rem] leading-[1.6] text-dim">
        A runner is a small process on another machine that connects outward to this
        Blunderbase deployment. Registering one mints a token shown once and a paste-ready{' '}
        <span className="font-mono text-soft">runner.yaml</span>. Copy both to that machine,
        set its engine paths in the yaml, and start the runner. Its advertised engines then
        appear in the inventory above; their paths and options remain read-only here because
        the yaml on that machine is the source of truth.
      </p>
      <p className="mt-2 text-[0.65625rem] text-faint">
        A longer setup and troubleshooting guide will be linked here when the documentation is ready.
      </p>
    </div>
  )
}

import { Cpu } from 'lucide-react'
import { useMemo, useState } from 'react'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useEngineRoles, useEngines, useRunnersStatus } from '@/lib/api/queries'
import { hostByEngineId } from '@/lib/engines/hosts'
import { useRuntimeCapabilities } from '@/lib/runtime/capabilities'

import { CapacityGrid } from './CapacityGrid'
import { EngineInventory } from './EngineInventory'
import { RolesForm } from './RolesForm'
import { engineRoles } from './roles'

/**
 * Engines as one ranked screen: assignments, engine inventory, then capacity.
 * Policy comes first because a role that cannot run is the actionable failure; the flat
 * inventory makes kind, role and host comparable; host setup is last because it changes
 * where work can run rather than what the deployment has chosen to run.
 *
 * One detail key spans engine editors, host details and creation forms. The old one-page
 * version was a mess because four equally loud sections and a permanent editor could all
 * remain expanded; here the summaries stay visible and every new detail replaces the old.
 */
export function EnginesPage() {
  const capabilities = useRuntimeCapabilities()
  const engines = useEngines()
  const roles = useEngineRoles()
  const status = useRunnersStatus()
  const [openDetail, setOpenDetail] = useState<string | null>(null)
  const list = engines.data ?? []
  const hosts = useMemo(() => hostByEngineId(status.data), [status.data])
  // The assignment is read once for the page: the inventory and the form use the same map,
  // so one engine can never be described two ways in two sections.
  const byRole = useMemo(() => engineRoles(roles.data), [roles.data])

  return (
    <PageBody>
      <SetPageChrome breadcrumb={[{ label: 'Engines' }]} />
      <PageHeader
        className="max-w-5xl"
        title="Engines"
        description="Assign each job, compare every configured engine, and see all compute capacity in one place."
      />

      <div className="flex max-w-5xl flex-col gap-5">
        <RolesForm
          roles={roles.data}
          engines={list}
          hosts={hosts}
          isLoading={roles.isPending}
          error={roles.error}
        />

        <section data-tour="engines" className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <div>
              <h2 className="text-xs font-semibold text-ink">Engine inventory</h2>
              <p className="mt-1 text-[0.6875rem] text-dim">
                Every configured engine, what it does and where it runs.
              </p>
            </div>
          </div>

          {engines.isPending ? (
            <div className="flex flex-col gap-1.5" data-testid="engines-loading">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : engines.isError ? (
            <div className="rounded-xl border border-blunder/28 bg-blunder/5 px-4 py-6 text-center">
              <p className="text-[0.78125rem] text-blunder">The engine list could not be read.</p>
              <p className="mt-1 font-mono text-[0.6875rem] text-blunder/80">
                {engines.error.message}
              </p>
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
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-edge-strong bg-panel/60 px-4 py-8 text-center">
              <Cpu className="size-5 text-faint" aria-hidden />
              <p className="text-[0.78125rem] text-soft">No engines are registered.</p>
              <p className="max-w-md text-[0.71875rem] leading-[1.5] text-dim">
                {capabilities.remote_runners
                  ? 'Add a path-based engine below, install browser Stockfish, or connect a remote runner.'
                  : 'Add a path-based engine on this computer below.'}
              </p>
            </div>
          ) : (
            <EngineInventory
              engines={list}
              hosts={hosts}
              roles={byRole}
              hostKnown={status.isSuccess}
              openDetail={openDetail}
              onOpenDetail={setOpenDetail}
              localLabel={capabilities.remote_runners ? 'This server' : 'This computer'}
            />
          )}
        </section>

        <CapacityGrid
          remoteRunnersEnabled={capabilities.remote_runners}
          status={status.data}
          isLoading={status.isPending}
          error={status.error}
          onRetry={() => void status.refetch()}
          openDetail={openDetail}
          onOpenDetail={setOpenDetail}
          onEngineAdded={(engine) => setOpenDetail(`engine:${engine.id}`)}
        />
      </div>
    </PageBody>
  )
}

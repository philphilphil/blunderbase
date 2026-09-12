/**
 * **Compute → Machines**: where engines run, how much runs at once, and what is running now.
 *
 * The Engines page used to carry this as its third section, "Compute capacity", under the
 * roles and the inventory — and the numbers that decide how many engine processes a
 * machine runs at once were spread over four homes (an environment variable, the
 * correspondence settings, a runner's own row, and each engine's `Threads`). This page is
 * the one home for the machine half of that: one card per host, this server's caps
 * editable on its card with the arithmetic drawn under them, and the runner lifecycle —
 * registering, installing the browser engine, renaming, revoking. What is *installed* and
 * how each engine is set up is the other page, `EnginesPage`.
 *
 * Three unlike hosts stay separate — this server, this browser, remote runners — because
 * calling the first two "local" would be false when the deployment itself is remote. The
 * server card is always open; the others keep their disclosure, sharing one `openDetail`
 * slot with the two forms so the page never regresses into a wall of expanded cards.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { Info, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useEngineRoles, useEngines, useRunnersStatus } from '@/lib/api/queries'
import { useBrowserRunner } from '@/lib/runner'
import { useRuntimeCapabilities } from '@/lib/runtime/capabilities'

import { BrowserRunnerSection } from './BrowserRunnerSection'
import { CreateRunnerForm } from './CreateRunnerForm'
import { RunnerCard } from './RunnerCard'
import { ServerCard } from './ServerCard'
import { engineRoles } from './roles'

export function MachinesPage() {
  const { t } = useLingui()
  const capabilities = useRuntimeCapabilities()
  const status = useRunnersStatus()
  const engines = useEngines()
  const roles = useEngineRoles()
  const browser = useBrowserRunner()
  const [openDetail, setOpenDetail] = useState<string | null>(null)
  const byRole = useMemo(() => engineRoles(roles.data), [roles.data])

  // The demo has no machines of its own to show or to configure; its Engines page says so.
  if (capabilities.read_only) return <Navigate to="/compute/engines" replace />

  const remote = capabilities.remote_runners
  const toggle = (key: string) => setOpenDetail(openDetail === key ? null : key)
  const browserRunner = status.data?.runners.find((runner) => runner.id === browser.runnerId)
  const remoteRunners = (status.data?.runners ?? []).filter(
    (runner) => runner.id !== browser.runnerId,
  )

  return (
    <PageBody>
      <SetPageChrome
        breadcrumb={[{ label: t`Compute`, to: '/compute' }, { label: t`Machines` }]}
        manual="operate/runners"
      />
      <PageHeader
        className="max-w-5xl"
        title={t`Machines`}
        description={
          remote
            ? t`Where engines run, how much runs at once, and what is running now.`
            : t`How much this computer runs at once, and what is running now.`
        }
        actions={
          remote ? (
            <>
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label={t`How remote runners work`}
                title={t`How remote runners work`}
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
                <Trans>Remote runner</Trans>
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="flex max-w-5xl flex-col gap-3">
        {remote && openDetail === 'remote-info' ? <RemoteRunnerInfo /> : null}
        {remote && openDetail === 'add-remote-runner' ? (
          <CreateRunnerForm onCancel={() => setOpenDetail(null)} />
        ) : null}

        {status.error ? (
          <div className="rounded-lg border border-blunder/28 bg-blunder/5 px-4 py-5 text-center">
            <p className="text-[0.78125rem] text-blunder">
              <Trans>Compute capacity could not be read.</Trans>
            </p>
            <p className="mt-1 font-mono text-[0.6875rem] text-blunder/80">
              {status.error.message}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void status.refetch()}
            >
              <Trans>Try again</Trans>
            </Button>
          </div>
        ) : status.isPending || !status.data ? (
          <div className="flex flex-col gap-2.5" data-testid="machines-loading">
            <Skeleton className="h-40 w-full" />
            {remote ? <Skeleton className="h-16 w-full" /> : null}
          </div>
        ) : (
          <>
            <ServerCard
              local={status.data.local}
              localOnly={!remote}
              engines={engines.data ?? []}
              roles={byRole}
            />
            {/* The two collapsible cards draw their detail `col-span-full` under the row,
                which in a one-column grid is simply the full width. */}
            {remote ? (
              <div className="grid grid-cols-1 gap-2.5">
                <BrowserRunnerSection
                  runner={browserRunner}
                  expanded={openDetail === 'browser'}
                  onToggleExpand={() => toggle('browser')}
                  layout="card"
                />
                {remoteRunners.map((runner) => (
                  <RunnerCard
                    key={runner.id}
                    runner={runner}
                    expanded={openDetail === `runner:${runner.id}`}
                    onToggleExpand={() => toggle(`runner:${runner.id}`)}
                    layout="card"
                  />
                ))}
              </div>
            ) : null}
            {remote && remoteRunners.length === 0 ? (
              <p className="text-[0.6875rem] text-dim-2">
                <Trans>
                  No remote runners are registered. This server and browser still work
                  independently.
                </Trans>
              </p>
            ) : null}
          </>
        )}

      </div>
    </PageBody>
  )
}

/**
 * The remote setup model in one place: an outbound connection, a one-time bearer token and
 * yaml owned by the other machine. The manual chapter has the long form; the screen still
 * needs enough to make the button understandable before it is pressed.
 */
function RemoteRunnerInfo() {
  return (
    <div className="rounded-lg border border-edge-strong bg-elevated px-3.5 py-3">
      <h3 className="text-[0.75rem] font-medium text-ink">
        <Trans>How remote runners work</Trans>
      </h3>
      <p className="mt-1.5 text-[0.6875rem] leading-[1.6] text-dim">
        <Trans>
          A runner is a small process on another machine that connects outward to this
          Blunderbase deployment. Registering one mints a token shown once and a paste-ready{' '}
          <span className="font-mono text-soft">runner.yaml</span>. Copy both to that machine,
          set its engine paths in the yaml, and start the runner. Its advertised engines then
          appear on Engines; their paths and options remain read-only here because the yaml on
          that machine is the source of truth.
        </Trans>
      </p>
      <p className="mt-2 text-[0.65625rem] text-faint">
        <Trans>The manual chapter behind the (?) in the titlebar has the setup and the troubleshooting.</Trans>
      </p>
    </div>
  )
}

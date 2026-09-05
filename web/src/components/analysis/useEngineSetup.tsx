import * as Dialog from '@radix-ui/react-dialog'
import { Trans, useLingui } from '@lingui/react/macro'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { demoAnalysis, DEMO_ENGINE_ID } from '@/lib/demo/analysis'

import { Button } from '@/components/ui/button'
import { createRunner, getRunnersStatus, listEngineRoles, setEngineRoles } from '@/lib/api/endpoints'
import type { Tier } from '@/lib/api/types'
import { engineHosts } from '@/lib/engines/hosts'
import { browserRunner, browserRunnerSupport } from '@/lib/runner'
import { installBrowserRunner, whenBrowserEngineReady } from '@/lib/runner/install'
import { useRuntimeCapabilities } from '@/lib/runtime/capabilities'

/** Keep the user's requested action until Stockfish has registered and can receive work. */
export function useEngineSetup() {
  const { t } = useLingui()
  const client = useQueryClient()
  const capabilities = useRuntimeCapabilities()
  const [pending, setPending] = useState<{ tier: Tier; resume: (engineId: number) => void } | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const epoch = useRef(0)
  useEffect(() => () => { epoch.current += 1 }, [])
  const support = browserRunnerSupport()

  // `close` and `show` are stable: callers keep them in effect dependency lists, and a
  // fresh identity every render would re-run those effects on every keystroke elsewhere.
  // Both touch only setState and the ref, so there is nothing for them to close over.
  const close = useCallback(() => {
    epoch.current += 1
    setPending(null)
    setBusy(false)
    setFailure(null)
  }, [])

  const show = useCallback((tier: Tier, resume: (engineId: number) => void) => {
    epoch.current += 1
    setFailure(null)
    setPending({ tier, resume })
  }, [])

  async function install() {
    if (!pending || busy) return
    const mine = epoch.current
    setBusy(true)
    setFailure(null)
    try {
      if (capabilities.read_only) {
        await demoAnalysis.install()
        if (mine !== epoch.current) return
        pending.resume(DEMO_ENGINE_ID)
        close()
        return
      }
      if (browserRunner.getSnapshot().runnerId === null) {
        await installBrowserRunner({ create: createRunner, start: (credential) => browserRunner.start(credential) })
      } else {
        browserRunner.resume()
      }
      await whenBrowserEngineReady(browserRunner)
      if (mine !== epoch.current) return
      const hosts = engineHosts(await getRunnersStatus())
      const host = hosts.find((entry) => entry.runnerId === browserRunner.getSnapshot().runnerId && entry.kind === 'uci' && entry.enabled)
      if (!host) throw new Error(t`Browser Stockfish did not register an engine.`)
      const roles = await listEngineRoles()
      if (!roles.roles.find((role) => role.role === pending.tier)?.configured) {
        await setEngineRoles({ [pending.tier]: host.engineId })
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: ['engines'] }),
        client.invalidateQueries({ queryKey: ['runners'] }),
      ])
      if (mine !== epoch.current) return
      pending.resume(host.engineId)
      close()
    } catch (cause) {
      if (mine === epoch.current) setFailure(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mine === epoch.current) setBusy(false)
    }
  }

  return {
    close,
    show,
    dialog: <Dialog.Root open={pending !== null} onOpenChange={(open) => { if (!open) close() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-void/75" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-edge bg-elevated p-6 shadow-xl">
          <Dialog.Title className="text-lg font-medium"><Trans>No engine is set up</Trans></Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-dim">
            {capabilities.read_only
              ? <Trans>Stockfish will run in this tab. Analysis results stay in your browser.</Trans>
              : <Trans>Set up browser Stockfish to start this analysis without leaving the page.</Trans>}
          </Dialog.Description>
          {!support.supported ? <p className="mt-3 text-sm text-blunder">{support.reason}</p> : null}
          {failure ? <p role="alert" className="mt-3 text-sm text-blunder">{failure}</p> : null}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link to="/engines" onClick={close}><Trans>Go to engine page</Trans></Link></Button>
            <Button disabled={busy || !support.supported} onClick={() => void install()}>
              {busy ? <Trans>Setting up Stockfish…</Trans> : <Trans>Set up browser engine</Trans>}
            </Button>
            <Dialog.Close asChild><Button variant="ghost"><Trans>Cancel</Trans></Button></Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>,
  }
}

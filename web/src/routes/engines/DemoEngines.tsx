import { Trans, useLingui } from '@lingui/react/macro'
import { Network, Server, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'

import { StatusDot } from '@/components/badges/StatusDot'
import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody } from '@/components/shell/PageHeader'
import { Button } from '@/components/ui/button'
import { TextLink } from '@/components/ui/text-link'
import { demoAnalysis, useDemoAnalysis } from '@/lib/demo/analysis'
import { SITE_URL } from '@/lib/links'
import { browserRunnerSupport } from '@/lib/runner/support'

/**
 * The Engines page as the public demo can show it.
 *
 * The real page manages a deployment's own compute, and the demo has none: no engine row,
 * and registering one is a write it refuses. Shown empty, that reads as "Blunderbase has no
 * engines" rather than "this demo has none of its own" — so the second section names the
 * three things the page normally holds, one line each. Prose, not disabled controls: a
 * greyed-out button invites clicking and explains nothing.
 *
 * It names the page as the real one does, `Compute › Engines`. Setting up the browser
 * engine is the page's one primary; once it is ready that is a status (a green dot and
 * the words), not accent text, which is kept for links.
 */
export function DemoEngines() {
  const { t } = useLingui()
  const state = useDemoAnalysis()
  const support = browserRunnerSupport()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function install() {
    setBusy(true)
    setError(null)
    try {
      await demoAnalysis.install()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageBody>
      <SetPageChrome
        breadcrumb={[{ label: t`Compute`, to: '/compute' }, { label: t`Engines` }]}
        manual="operate/engines"
      />
      <div className="flex max-w-2xl flex-col gap-5">
        <section className="rounded-xl border border-edge bg-panel p-5">
          <h2 className="text-heading font-semibold text-ink">
            <Trans>Browser Stockfish</Trans>
          </h2>
          <p className="mt-1.5 text-data leading-[1.6] text-dim">
            <Trans>
              The analysis pass, Analyse… and continuous analysis, all in this tab. Nothing is
              saved.
            </Trans>
          </p>
          {state.ready ? (
            <p role="status" className="mt-4 flex items-center gap-2 text-data font-medium text-ink">
              <StatusDot tone="healthy" />
              <Trans>Stockfish is ready in this browser.</Trans>
            </p>
          ) : (
            <Button
              className="mt-4"
              disabled={busy || !support.supported}
              title={!support.supported ? (support.reason ?? undefined) : undefined}
              onClick={() => void install()}
            >
              {busy ? <Trans>Setting up Stockfish…</Trans> : <Trans>Set up browser engine</Trans>}
            </Button>
          )}
          {!support.supported ? (
            <p className="mt-3 text-data text-blunder">{support.reason}</p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-3 text-data text-blunder">
              {error}
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border border-dashed border-edge-strong bg-panel/60 p-5">
          <h2 className="text-heading font-semibold text-ink">
            <Trans>In your own Blunderbase</Trans>
          </h2>
          <ul className="mt-3 flex flex-col gap-2 text-data leading-[1.5] text-dim">
            <li className="flex items-baseline gap-2.5">
              <Server className="size-3.5 flex-none translate-y-[0.15rem] text-faint" aria-hidden />
              <span>
                <Trans>
                  <span className="font-medium text-soft">Local engines</span> — a Stockfish or
                  Maia binary by path.
                </Trans>
              </span>
            </li>
            <li className="flex items-baseline gap-2.5">
              <Network className="size-3.5 flex-none translate-y-[0.15rem] text-faint" aria-hidden />
              <span>
                <Trans>
                  <span className="font-medium text-soft">Remote runners</span> — other machines,
                  dialling in.
                </Trans>
              </span>
            </li>
            <li className="flex items-baseline gap-2.5">
              <SlidersHorizontal
                className="size-3.5 flex-none translate-y-[0.15rem] text-faint"
                aria-hidden
              />
              <span>
                <Trans>
                  <span className="font-medium text-soft">Roles</span> — which engine does the
                  analysis and which the human moves.
                </Trans>
              </span>
            </li>
          </ul>
          <p className="mt-4 text-label text-dim">
            <Trans>
              Free and self-hosted —{' '}
              <TextLink href={SITE_URL} external>
                run your own
              </TextLink>
            </Trans>
          </p>
        </section>
      </div>
    </PageBody>
  )
}

import { AppWindow, Loader2, Play, Square, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { StatusDot } from '@/components/badges/StatusDot'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api/client'
import { useCreateRunner, useDeleteRunner } from '@/lib/api/queries'
import type { RunnerResponse } from '@/lib/api/types'
import {
  browserRunner,
  browserRunnerName,
  browserRunnerSupport,
  useBrowserRunner,
} from '@/lib/runner'

import { engineLabel, hasEngine, statusLabel } from './browserRunner'
import { MachineRow } from './MachineRow'

/**
 * This browser is its own capacity card because installing it takes one press and no yaml.
 *
 * It is a row of its own rather than one more entry read off `/runners/status`, because the
 * *installing* is the whole difference. Every other machine was set up by hand — mint a
 * token, copy a yaml over, edit engine paths, start a process — while a browser needs none
 * of it: the engine ships with the app, the token is minted and stored by this component,
 * and the socket is dialled from the page. Once installed it registers exactly like any
 * other runner and would otherwise show up a second time in the plain list below, which is
 * why `CapacityGrid` filters this browser's own id back out of it.
 *
 * Two things this component is careful about.
 *
 * **Uninstall revokes before it forgets.** The token is a bearer credential that exists on
 * the server whether or not this browser still holds a copy; clearing `localStorage` alone
 * would leave a live runner row nobody can reach, holding queue work that only it is
 * eligible for, and an engine row the owner cannot delete (the Engines page refuses a
 * runner-bound row on purpose). So `DELETE /runners/{id}` goes first and the local copy is
 * dropped only once the server has agreed — with the one exception that a 404 means the row
 * is already gone and the copy is then simply stale.
 *
 * **The name is proposed, not owned.** Runner names are unique, so a second browser on the
 * same machine would collide; the install retries with a numbered suffix rather than making
 * the owner type a name for something that should be one press.
 */
export function BrowserRunnerSection({
  runner,
  expanded,
  onToggleExpand,
  layout,
}: {
  /** This browser's own row from `/runners/status`, once installed — for slots and queue. */
  runner?: RunnerResponse
  expanded: boolean
  onToggleExpand: () => void
  /** The one-page screen presents capacity as cards without changing browser-runner behavior. */
  layout?: 'row' | 'card'
}) {
  const state = useBrowserRunner()
  const support = browserRunnerSupport()
  const create = useCreateRunner()
  const remove = useDeleteRunner()
  const [failure, setFailure] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const installed = state.runnerId !== null
  const busy = create.isPending || remove.isPending

  async function install() {
    setFailure(null)
    const proposed = browserRunnerName(
      typeof navigator === 'undefined' ? undefined : navigator.userAgent,
    )
    try {
      const created = await mintRunner(proposed, (name) =>
        create.mutateAsync({ name, slots: 1 }),
      )
      browserRunner.start({
        runnerId: created.runner.id,
        // The server's own name, not the one we asked for: it may have held us to something
        // else, and the engine this tab advertises is named after it.
        runnerName: created.runner.name,
        token: created.token,
      })
    } catch (cause) {
      setFailure(message(cause))
    }
  }

  async function uninstall() {
    setFailure(null)
    setConfirmRemove(false)
    const runnerId = state.runnerId
    if (runnerId === null) {
      browserRunner.forget()
      return
    }
    try {
      await remove.mutateAsync(runnerId)
    } catch (cause) {
      // Already gone server-side: the local copy is stale, and keeping it would leave the
      // owner with an install button that will not appear and a token that cannot connect.
      if (!(cause instanceof ApiError && cause.status === 404)) {
        setFailure(`${message(cause)} — the token was kept, so nothing is orphaned`)
        return
      }
    }
    browserRunner.forget()
  }

  const caption = !support.supported
    ? (support.reason ?? 'unsupported')
    : !installed
      ? 'not installed'
      : statusLabel(state).label
  const tone = !support.supported || !installed ? 'away' : statusLabel(state).tone
  const slots =
    installed && runner ? `${runner.busy + runner.streams}/${runner.slots}` : installed ? '1' : '—'

  return (
    <MachineRow
      tone={tone}
      name={installed ? (state.runnerName ?? 'This browser') : 'This browser'}
      caption={caption}
      type="This browser"
      slots={slots}
      engines={hasEngine(state) ? '1' : '0'}
      expanded={expanded}
      onToggleExpand={onToggleExpand}
      ariaLabel={`${expanded ? 'Collapse' : 'Expand'} this browser`}
      layout={layout}
      actions={
        !support.supported ? null : !installed ? (
          <Button type="button" size="sm" disabled={busy} onClick={() => void install()}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <AppWindow aria-hidden />}
            Install browser Stockfish
          </Button>
        ) : confirmRemove ? (
          <>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => void uninstall()}
            >
              {remove.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Revoke and uninstall
            </Button>
          </>
        ) : (
          <>
            {state.phase === 'off' || state.phase === 'refused' ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => browserRunner.resume()}
              >
                <Play aria-hidden />
                Start
              </Button>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={() => browserRunner.stop()}>
                <Square aria-hidden />
                Stop
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemove(true)}>
              <Trash2 aria-hidden />
              Uninstall
            </Button>
          </>
        )
      }
      detail={
        !support.supported ? (
          <p className="text-[0.71875rem] leading-[1.6] text-dim">
            {support.reason}. Everything else on this page works as it always did — engines on
            this host, and runners on other machines.
          </p>
        ) : !installed ? (
          <div className="text-[0.71875rem] leading-[1.6] text-dim">
            Nothing is installed here. The engine and its network are about 15 MB and are served
            by Blunderbase itself, so nothing is fetched from anywhere else — and the token this
            creates lives in this browser only.
            {failure ? <p className="mt-2 text-blunder">{failure}</p> : null}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {hasEngine(state) ? (
              <div className="flex items-center gap-2 rounded-md border border-edge bg-elevated px-3 py-2">
                <StatusDot tone="healthy" />
                <span className="truncate font-mono text-[0.6875rem] text-body">
                  {engineLabel(state)}
                </span>
              </div>
            ) : (
              <p className="rounded-md border border-edge bg-elevated px-3 py-2 text-[0.6875rem] text-dim">
                The engine has not started yet. It lives in this browser rather than at a path —
                there is nothing on a filesystem to point at.
              </p>
            )}

            {!state.isolated && hasEngine(state) ? (
              <p className="text-[0.6875rem] leading-[1.6] text-mistake">
                This page is not cross-origin isolated, so the engine gets one thread instead of
                several. Blunderbase sends the headers that ask for isolation; a reverse proxy in
                front of it is the usual reason they do not arrive.
              </p>
            ) : null}

            {state.refused.map((engine) => (
              <p key={engine.name} className="text-[0.6875rem] leading-[1.6] text-mistake">
                The server refused {engine.name}: {engine.reason}
              </p>
            ))}

            {state.error ? (
              <p
                className={
                  state.phase === 'refused'
                    ? 'text-[0.6875rem] leading-[1.6] text-blunder'
                    : 'text-[0.6875rem] leading-[1.6] text-dim'
                }
              >
                {state.error.message}
              </p>
            ) : null}
            {failure ? <p className="text-[0.6875rem] text-blunder">{failure}</p> : null}
          </div>
        )
      }
    />
  )
}

/** How many names to try before giving up and letting the duplicate error through. */
const NAME_ATTEMPTS = 5

/**
 * Register the runner, working around a name this deployment already has.
 *
 * `POST /runners` answers 409 `duplicate_runner` for a name in use — two Chromes on two
 * machines is the ordinary case, not an edge one — so the second one becomes
 * `Chrome on macOS (2)`. Only that one status is retried; anything else is the owner's to
 * see.
 */
async function mintRunner<T>(
  proposed: string,
  create: (name: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const name = attempt === 1 ? proposed : `${proposed} (${attempt})`
    try {
      return await create(name)
    } catch (cause) {
      const taken = cause instanceof ApiError && cause.status === 409
      if (!taken || attempt >= NAME_ATTEMPTS) throw cause
    }
  }
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

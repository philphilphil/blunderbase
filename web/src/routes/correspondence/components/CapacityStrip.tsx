/**
 * What the machine is spending on correspondence, in one line under the heading.
 *
 * Three numbers and a host list, because those are the three questions an owner asks
 * before starting a fourth search: is there a slot free, how much memory are the parked
 * processes holding, and is the other machine still connected. A fourth, apart from them:
 * how many **tasks** are out. They hold no slot — each is a run in the ordinary analysis
 * queue and may be working on another machine — so they are counted beside the slots
 * rather than against them, and a deployment with no free slot and forty tasks running is
 * not the same picture as one with neither. Parked processes are not
 * capped (`docs/correspondence.md`, Settled) — the strip is what makes that safe, by
 * saying what they cost so the owner can decide when it is too much.
 *
 * The GB figure is the sum of the parked engines' `Hash`, which is what a parked process
 * actually holds. It is the engine row's own option, so an engine configured without one
 * simply does not contribute — better a figure that undercounts than one invented.
 *
 * The count beside it is `status.parked`, the warm processes, and not `status.paused`,
 * which counts rows: a restart makes every paused search cold, and a strip that read the
 * rows would go on charging the owner for memory no process is holding.
 */
import { t as global } from '@lingui/core/macro'
import { Plural, Trans, useLingui } from '@lingui/react/macro'

import type { CorrespondenceStatus } from '@/lib/api/types'
import { cn } from '@/lib/utils'

/** MB across the parked processes, or null when none of them names a Hash. */
export function parkedMegabytes(status: CorrespondenceStatus): number | null {
  const held = (status.parked ?? [])
    .map((one) => one.hash_mb ?? 0)
    .filter((mb) => mb > 0)
  if (held.length === 0) return null
  return held.reduce((total, mb) => total + mb, 0)
}

/**
 * `8 GB` over a gigabyte, `512 MB` under it — the unit the number is readable in.
 *
 * The global `t` rather than the hook's, because this is a helper with no React in it and
 * it is exported and tested as one; the unit is still a word a person reads, so it comes
 * out of the catalog.
 */
export function formatMemory(mb: number): string {
  if (mb >= 1024) {
    const gb = (mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)
    return global`${gb} GB`
  }
  return global`${mb} MB`
}

function Dot({ tone }: { tone: 'live' | 'warm' | 'queued' | 'idle' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-[0.4375rem] rounded-full align-[0.0625rem]',
        tone === 'live'
          ? 'bg-good'
          : tone === 'warm'
            ? 'bg-mistake'
            : tone === 'queued'
              ? 'bg-accent-teal'
              : 'bg-faint',
      )}
    />
  )
}

export function CapacityStrip({ status }: { status: CorrespondenceStatus | undefined }) {
  const { t } = useLingui()

  if (!status) {
    return (
      <div
        data-testid="correspondence-capacity"
        className="flex flex-wrap gap-x-6 gap-y-1.5 border-y border-hairline py-2 text-[0.6875rem] text-dim"
      >
        <span>
          <Trans>Reading what the engines are doing…</Trans>
        </span>
      </div>
    )
  }

  const memory = parkedMegabytes(status)
  const inUse = status.in_use ?? 0
  const slots = status.slots ?? 0
  const parked = (status.parked ?? []).length
  const paused = status.paused ?? 0
  const queued = status.queued ?? 0
  // Counted apart from the slots, and deliberately: a task is an ordinary queue run and
  // may be working on a runner, so it takes nothing from the two numbers above it. An
  // owner reading "0 of 2 slots in use" with a dozen tasks out is not idle.
  const tasksQueued = status.tasks?.queued ?? 0
  const tasksRunning = status.tasks?.running ?? 0
  const tasks = tasksQueued + tasksRunning
  const remote = (status.hosts ?? []).filter((host) => host.runner_id !== null)

  return (
    <div
      data-testid="correspondence-capacity"
      className="flex flex-wrap gap-x-6 gap-y-1.5 border-y border-hairline py-2 text-[0.6875rem] text-dim"
    >
      <span>
        <Dot tone={inUse > 0 ? 'live' : 'idle'} />{' '}
        <b className="font-medium text-body">{t`${inUse} of ${slots}`}</b>{' '}
        <Trans>search slots in use on this machine</Trans>
      </span>
      {parked > 0 ? (
        <span>
          <Dot tone="warm" />{' '}
          <b className="font-medium text-body">
            <Plural value={parked} one="# engine parked" other="# engines parked" />
          </b>
          {memory === null ? null : (
            <>
              {', '}
              <b className="font-medium text-body">{formatMemory(memory)}</b>
            </>
          )}
        </span>
      ) : null}
      {queued > 0 ? (
        <span>
          <Dot tone="queued" />{' '}
          <b className="font-medium text-body">
            <Plural value={queued} one="# search waiting" other="# searches waiting" />
          </b>{' '}
          <Trans>for a slot</Trans>
        </span>
      ) : null}
      {tasks > 0 ? (
        <span data-testid="correspondence-tasks">
          <Dot tone={tasksRunning > 0 ? 'live' : 'queued'} />{' '}
          <b className="font-medium text-body">
            <Plural value={tasks} one="# task" other="# tasks" />
          </b>{' '}
          {tasksRunning > 0 && tasksQueued > 0
            ? t`in the analysis queue, ${tasksRunning} being worked on`
            : tasksRunning > 0
              ? t`being worked on`
              : t`waiting in the analysis queue`}
        </span>
      ) : null}
      {remote.map((host) => (
        <span key={host.runner_id ?? host.host}>
          <b className="font-medium text-body">{host.host}</b>{' '}
          {host.connected === false ? (
            <span className="text-mistake">
              <Trans>away</Trans>
            </span>
          ) : (
            t`${host.in_use ?? 0} of ${host.slots} in use`
          )}
        </span>
      ))}
      {/* `paused` rather than `parked`: a search paused cold after a restart is still work
          the owner has waiting, and telling them to start one would be the wrong advice. */}
      {inUse === 0 && paused === 0 && queued === 0 && tasks === 0 ? (
        <span className="text-dim-2">
          <Trans>Nothing is searching. Open a game and set an engine on a position.</Trans>
        </span>
      ) : null}
    </div>
  )
}

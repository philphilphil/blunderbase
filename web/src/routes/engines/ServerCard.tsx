/**
 * This server on the Machines page: what it has, how much it may run at once, and what
 * that adds up to.
 *
 * Always open, unlike the browser and runner cards under it, because its two numbers are
 * the page's reason to exist. **Queue processes** is `analysis_concurrency` and **Search
 * slots** is `correspondence_slots` — the caps the analysis queue and the correspondence
 * searches each get, added rather than shared — and under them the budget line does the
 * sum the manual used to ask the owner to do: processes × the engines' `Threads`, against
 * the cores. Both are read by the server when it starts, so the card says when a saved
 * number is not yet the one in force rather than pretending a save applied it.
 *
 * The queue's cap can be pinned from outside (`BLUNDERBASE_ANALYSIS_CONCURRENCY`); then the
 * field is read-only and says so, because a save would change nothing.
 *
 * Saves go through `completeUpdate` like every settings form: `PUT /settings` replaces the
 * lot, so a form that sent only its own two keys would clear what the other pages hold.
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { StatusDot } from '@/components/badges/StatusDot'
import { SaveRow, SettingField, type SettingSpec } from '@/components/settings/SettingField'
import { Label } from '@/components/ui/label'
import {
  completeUpdate,
  parseSetting as parse,
  settingText as storedText,
  SETTING_DEFAULTS as DEFAULTS,
} from '@/lib/api/appSettings'
import { useAppSettings, useSaveAppSettings } from '@/lib/api/queries'
import type { EngineResponse, LocalHost } from '@/lib/api/types'
import { cn } from '@/lib/utils'

import { MachineEngineList } from './MachineEngineList'
import { budgetShares, hostBudget } from './capacity'
import type { EngineRoles } from './roles'

type CapKey = 'analysis_concurrency' | 'correspondence_slots'

export function ServerCard({
  local,
  localOnly,
  engines,
  roles,
}: {
  local: LocalHost
  /** A deployment without remote runners calls this machine a computer, not a server. */
  localOnly: boolean
  /** Every engine the deployment has; the card keeps the ones whose binary is here. */
  engines: EngineResponse[]
  roles: Map<number, EngineRoles>
}) {
  const { t } = useLingui()
  const settings = useAppSettings()
  const save = useSaveAppSettings({ onSuccess: () => setDraft({}) })
  const [draft, setDraft] = useState<Partial<Record<CapKey, string>>>({})

  const stored = settings.data
  const text = (key: CapKey) => draft[key] ?? storedText(stored, key)
  const pinned = local.slots_source === 'env'
  const inForce = local.slots ?? null
  const configured = local.slots_configured ?? inForce
  // The cores-minus-two default is the server's to know; the card learns it only while it
  // is what is in force, and otherwise says where the number comes from.
  // The caption under each box is where the box explains itself: what the number counts,
  // and what an empty box means. A paragraph beside the boxes was tried and read as a wall.
  const queueDefault =
    local.slots_source === 'default' && configured !== null
      ? t`Passes and tasks · default ${configured}`
      : t`Passes and tasks · default cores − 2`
  const queueField: SettingSpec<CapKey> = {
    key: 'analysis_concurrency',
    label: t`Queue processes`,
    min: 1,
    max: 64,
    step: 1,
    unset: queueDefault,
  }
  const searchField: SettingSpec<CapKey> = {
    key: 'correspondence_slots',
    label: t`Search slots`,
    min: 1,
    max: 16,
    step: 1,
    unset: t`Correspondence · default ${DEFAULTS.correspondence_slots}`,
  }
  const keys: CapKey[] = ['analysis_concurrency', 'correspondence_slots']
  const dirty = stored !== undefined && keys.some((key) => text(key) !== storedText(stored, key))

  // The local engines by id: what `/runners/status` says is here, joined to the rows that
  // carry the options. A runner's engines are that machine's budget, not this one's.
  const here = useMemo(() => {
    const ids = new Set(local.engines.map((engine) => engine.id))
    return engines.filter((engine) => ids.has(engine.id))
  }, [engines, local.engines])
  const correspondenceOn =
    (stored?.correspondence_enabled ?? DEFAULTS.correspondence_enabled) === 1
  // The budget follows the boxes as they are typed, so the owner sees the sum move before
  // saving — the number in force is the field's business, the arithmetic is the draft's.
  const queueWanted = parse(text('analysis_concurrency')) ?? configured ?? inForce ?? 1
  const searchWanted = parse(text('correspondence_slots')) ?? DEFAULTS.correspondence_slots
  const budget = useMemo(
    () =>
      hostBudget({
        cores: local.cores,
        queueProcesses: queueWanted,
        searchSlots: searchWanted,
        correspondenceOn,
        engines: here,
        roles,
      }),
    [local.cores, queueWanted, searchWanted, correspondenceOn, here, roles],
  )
  const shares = budgetShares(budget)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!stored || !dirty) return
    save.mutate({
      ...completeUpdate(stored),
      // A pinned cap keeps whatever row it has: the field was read-only, so nothing here
      // is the owner's word on it.
      analysis_concurrency: pinned
        ? (stored.analysis_concurrency ?? null)
        : parse(text('analysis_concurrency')),
      correspondence_slots: parse(text('correspondence_slots')),
    })
  }

  const used = local.busy + local.streams
  const cores = local.cores ?? null
  const name = localOnly ? t`This computer` : t`This server`
  const queueThreads = budget.queue.threads
  const queueProcesses = budget.queue.processes
  const searchThreads = budget.searches?.threads ?? 0
  const searchProcesses = budget.searches?.processes ?? 0
  const total = budget.total
  const coresLabel = cores !== null ? t`${cores} cores` : t`cores unknown`
  const restartPending =
    !pinned && local.workers && inForce !== null && configured !== null && inForce !== configured

  return (
    <section
      data-testid="server-card"
      className="flex flex-col rounded-lg border border-edge-strong bg-panel"
    >
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-3.5 py-2.5">
        <StatusDot tone={local.workers ? 'healthy' : 'degraded'} />
        <h3 className="text-[0.8125rem] font-semibold text-ink">{name}</h3>
        <span className="text-[0.6875rem] text-dim">
          {cores !== null ? (
            <Plural value={cores} one="# core" other="# cores" />
          ) : (
            <Trans>cores unknown</Trans>
          )}
        </span>
        <div className="flex-1" />
        <span
          className={cn(
            'font-mono text-[0.6875rem] tabular',
            local.workers ? 'text-soft' : 'text-mistake',
          )}
          title={local.workers ? undefined : t`Runs wait until a worker picks them up.`}
        >
          {local.workers ? (
            <Trans>
              queue {used} of {inForce ?? '?'} in use
            </Trans>
          ) : (
            <Trans>not draining the queue</Trans>
          )}
        </span>
      </div>

      <div className="grid gap-0 md:grid-cols-2">
        <form
          noValidate
          onSubmit={submit}
          className="flex flex-col gap-3 px-3.5 py-3 md:border-r md:border-line"
        >
          <h4 className="text-[0.625rem] tracking-[0.1em] text-faint uppercase">
            <Trans>How much at once</Trans>
          </h4>
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex flex-col gap-1.5">
              {pinned ? (
                <div className="flex w-36 flex-none flex-col gap-1.5">
                  <Label htmlFor="analysis-concurrency">{queueField.label}</Label>
                  <input
                    id="analysis-concurrency"
                    readOnly
                    value={inForce ?? ''}
                    className="h-8 w-full rounded-md border border-input bg-raised px-2 font-mono text-xs text-dim tabular"
                  />
                  <span className="font-mono text-[0.625rem] text-dim-2">
                    <Trans>Set by BLUNDERBASE_ANALYSIS_CONCURRENCY</Trans>
                  </span>
                </div>
              ) : (
                <SettingField
                  field={queueField}
                  value={text('analysis_concurrency')}
                  onChange={(next) => setDraft({ ...draft, analysis_concurrency: next })}
                />
              )}
            </div>
            {/* The slots exist only for correspondence searches, so an install with the
                mode off never sees a box for them; the row it may hold rides along unchanged. */}
            {correspondenceOn ? (
              <SettingField
                field={searchField}
                value={text('correspondence_slots')}
                onChange={(next) => setDraft({ ...draft, correspondence_slots: next })}
              />
            ) : null}
          </div>
          <p className="max-w-[30rem] text-[0.625rem] leading-[1.5] text-dim-2">
            {correspondenceOn ? (
              <Trans>
                Queue processes run the passes and tasks; search slots exist only for
                correspondence searches and are added on top. Read when the server starts:
                change, then restart.
              </Trans>
            ) : (
              <Trans>
                Queue processes run the analysis passes. Read when the server starts: change,
                then restart.
              </Trans>
            )}
          </p>
          {restartPending ? (
            <p className="text-[0.6875rem] text-mistake" role="status">
              <Trans>
                Saved {configured}; the queue is running on {inForce} until the server restarts.
              </Trans>
            </p>
          ) : null}
          {save.isError ? (
            <p role="alert" className="text-[0.6875rem] text-blunder">
              {save.error.message}
            </p>
          ) : null}
          <SaveRow dirty={dirty} pending={save.isPending} onRevert={() => setDraft({})} />

          <div
            data-testid="core-budget"
            className={cn(
              'flex flex-col gap-1.5 rounded-md border border-line bg-elevated px-3 py-2.5 text-[0.6875rem] leading-[1.6] text-body',
              budget.over && 'border-l-2 border-l-mistake',
            )}
          >
            <p className="font-mono tabular">
              {budget.searches ? (
                <Trans>
                  queue {queueProcesses} × {queueThreads} threads + searches {searchProcesses} ×{' '}
                  {searchThreads} ={' '}
                  <span className={cn('font-semibold', budget.over ? 'text-mistake' : 'text-ink')}>
                    {total} threads
                  </span>{' '}
                  · {coresLabel}
                </Trans>
              ) : (
                <Trans>
                  queue {queueProcesses} × {queueThreads} threads ={' '}
                  <span className={cn('font-semibold', budget.over ? 'text-mistake' : 'text-ink')}>
                    {total} threads
                  </span>{' '}
                  · {coresLabel}
                </Trans>
              )}
            </p>
            <div className="flex h-1.5 overflow-hidden rounded-sm bg-track">
              <div className="bg-accent-teal" style={{ width: `${shares.queue}%` }} />
              <div className="bg-good" style={{ width: `${shares.searches}%` }} />
              <div className="bg-blunder" style={{ width: `${shares.over}%` }} />
            </div>
            <p className="text-[0.625rem] text-dim">
              {budget.over ? (
                <Trans>
                  At full load, more threads than cores. Lower a cap, or an engine&rsquo;s
                  threads on Engines.
                </Trans>
              ) : cores !== null ? (
                <Trans>At full load, everything fits the cores.</Trans>
              ) : (
                <Trans>Threads × processes is what has to fit the cores.</Trans>
              )}
            </p>
          </div>
        </form>

        <div className="flex flex-col gap-3 px-3.5 py-3">
          <h4 className="text-[0.625rem] tracking-[0.1em] text-faint uppercase">
            <Trans>Engines on this machine</Trans>
          </h4>
          <MachineEngineList engines={local.engines} streamable connected />
          <p className="text-[0.625rem] leading-[1.6] text-dim-2">
            {local.workers ? (
              <Trans>
                {local.queued} queued, {local.running} running here. Add or edit engines on{' '}
                <Link to="/compute/engines" className="text-accent-teal hover:text-accent-link">
                  Engines
                </Link>
                .
              </Trans>
            ) : (
              <Trans>
                Add or edit engines on{' '}
                <Link to="/compute/engines" className="text-accent-teal hover:text-accent-link">
                  Engines
                </Link>
                .
              </Trans>
            )}
          </p>
        </div>
      </div>
    </section>
  )
}

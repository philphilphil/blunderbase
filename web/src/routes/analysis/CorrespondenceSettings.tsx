/**
 * **Analysis → Correspondence**: whether the mode exists at all, and the numbers a new
 * game, a new search and a new task start from.
 *
 * It is a small page on purpose. Correspondence mode is off by default — most owners never
 * play it and should never see the rail entry — so the first thing on the page is the
 * switch that brings it into existence, and everything under it is what that mode will do
 * once it is on.
 *
 * **Search slots is the one setting here that needs a restart.** The server reads it when
 * it starts, because it sizes an engine pool, and a pool cannot be resized under three
 * searches that are already in it. The field says so rather than pretending otherwise.
 *
 * **The search engines are a list, not a set of switches.** Their order is the picker's
 * order and the first is its default, which is why they are moved up and down rather than
 * ticked — and why an empty list is a real state meaning "offer every eligible engine"
 * rather than "offer none". Eligible is the backend's word: switched on, UCI, able to
 * drive a board, on this machine.
 *
 * **The task engine is chosen out of a wider pool than the search engines.** A search runs
 * in this process's own pool and must therefore be an engine that can drive a board here; a
 * task is an ordinary `AnalysisRun` and runs wherever the queue has room, so every enabled
 * UCI engine is offered, a runner's included. That is why this one list comes from
 * `/runners/status` rather than from `/correspondence/status`.
 *
 * The form saves through `completeUpdate` like the other two settings pages: `PUT
 * /settings` is a replace, so a page that sent only its own fields would clear everything
 * Maia and Engine passes hold — and, now, each other's list.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Toggle } from '@/components/analysis/AnalysisControls'
import { SaveRow, SettingField, type SettingSpec } from '@/components/settings/SettingField'
import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  completeUpdate,
  parseSetting as parse,
  settingText as storedText,
  SETTING_DEFAULTS as DEFAULTS,
} from '@/lib/api/appSettings'
import {
  useAppSettings,
  useCorrespondenceStatus,
  useRunnersStatus,
  useSaveAppSettings,
} from '@/lib/api/queries'
import { engineHosts } from '@/lib/engines/hosts'
import { cn } from '@/lib/utils'

type NumberKey =
  | 'correspondence_days_per_move'
  | 'correspondence_multipv'
  | 'correspondence_slots'
  | 'correspondence_task_nodes'
  | 'correspondence_task_multipv'
  | 'correspondence_stale_depth'

export function CorrespondenceSettingsPage() {
  const { t } = useLingui()
  const settings = useAppSettings()
  // The engines a search could run on, from the same endpoint the picker itself reads —
  // `enabled && uci && streams && !runner_id`, decided once on the server so this page and
  // the dialog cannot disagree about what "eligible" means. `status.engines` is the
  // picker's list, which is this setting already applied; this page needs the pool it is
  // chosen out of.
  const status = useCorrespondenceStatus()
  // The task engine is chosen out of a wider pool than the searches are: a task is
  // ordinary queue work, so an engine on a remote runner is not only allowed, it is the
  // sensible choice where there is one. `/runners/status` is the only place that knows a
  // runner's engines, which is why this page reads it and the picker's own list does not.
  const runners = useRunnersStatus()
  const save = useSaveAppSettings({
    onSuccess: () => {
      setDraft({})
      setChosen(null)
      setTaskEngine(undefined)
    },
  })
  const [draft, setDraft] = useState<
    Partial<Record<NumberKey | 'correspondence_enabled', string>>
  >({})
  /** null while the stored list stands; an array as soon as the owner has moved anything. */
  const [chosen, setChosen] = useState<number[] | null>(null)
  /**
   * `undefined` while the stored engine stands, and then the choice — which may itself be
   * `null`, meaning "whichever engine holds the deep role". Two kinds of nothing, and a
   * single null would make "not touched yet" indistinguishable from "deliberately none".
   */
  const [taskEngine, setTaskEngine] = useState<number | null | undefined>(undefined)

  const chrome = (
    <SetPageChrome
      breadcrumb={[{ label: t`Analysis`, to: '/analysis' }, { label: t`Correspondence` }]}
      manual="guide/analysis#correspondence"
    />
  )
  const heading = (
    <PageHeader
      title={t`Correspondence`}
      description={t`Games played over weeks, with a tree of positions the engines keep working on.`}
    />
  )

  if (!settings.data) {
    return (
      <PageBody>
        {chrome}
        {heading}
        {settings.isPending ? (
          <Skeleton className="h-28 w-full max-w-3xl" data-testid="settings-loading" />
        ) : (
          <div className="max-w-2xl rounded-md border border-blunder/28 bg-blunder/5 px-3 py-2.5">
            <p className="text-[0.75rem] text-blunder">
              <Trans>The analysis configuration could not be read.</Trans>
            </p>
            <p className="mt-1 font-mono text-[0.6875rem] text-blunder/80">
              {settings.error?.message}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2.5"
              onClick={() => void settings.refetch()}
            >
              <Trans>Try again</Trans>
            </Button>
          </div>
        )}
      </PageBody>
    )
  }

  const stored = settings.data
  const text = (key: NumberKey | 'correspondence_enabled') => draft[key] ?? storedText(stored, key)
  const enabled = (parse(text('correspondence_enabled')) ?? DEFAULTS.correspondence_enabled) === 1
  const fields: SettingSpec<NumberKey>[] = [
    {
      key: 'correspondence_days_per_move',
      label: t`Days per move`,
      min: 1,
      max: 365,
      step: 1,
      unset: t`Default 10`,
    },
    {
      key: 'correspondence_multipv',
      label: t`Lines per search`,
      min: 1,
      max: 5,
      step: 1,
      unset: t`Default 3`,
    },
  ]
  const slots: SettingSpec<NumberKey> = {
    key: 'correspondence_slots',
    label: t`Search slots`,
    min: 1,
    max: 16,
    step: 1,
    unset: t`Default 2`,
  }
  const taskFields: SettingSpec<NumberKey>[] = [
    {
      key: 'correspondence_task_nodes',
      label: t`Nodes per task`,
      min: 1,
      step: 1_000_000,
      unset: t`Default 40,000,000`,
    },
    {
      key: 'correspondence_task_multipv',
      label: t`Lines per task`,
      min: 1,
      max: 5,
      step: 1,
      unset: t`Default 3`,
    },
    {
      key: 'correspondence_stale_depth',
      label: t`Stale below depth`,
      min: 1,
      max: 100,
      step: 1,
      unset: t`Default 30`,
    },
  ]
  const keys = [
    'correspondence_enabled',
    ...fields.map((field) => field.key),
    slots.key,
    ...taskFields.map((field) => field.key),
  ] as const

  // `eligible_engines`, not `engines`: the latter is already this setting applied, so
  // choosing one engine would hide every other one from this page for good.
  const offered = status.data?.eligible_engines ?? []
  const storedEngines = stored.correspondence_search_engine_ids ?? []
  const engineIds = chosen ?? storedEngines
  // Every enabled UCI engine the deployment knows, this machine's and every runner's — the
  // one picker on these screens that is not limited to what can drive a board here.
  const taskEngines = engineHosts(runners.data).filter(
    (host) => host.enabled && host.kind === 'uci',
  )
  const storedTaskEngine = stored.correspondence_task_engine_id ?? null
  const taskEngineId = taskEngine === undefined ? storedTaskEngine : taskEngine
  const dirty =
    keys.some((key) => text(key) !== storedText(stored, key)) ||
    (chosen !== null && chosen.join(',') !== storedEngines.join(',')) ||
    (taskEngine !== undefined && taskEngine !== storedTaskEngine)

  /** Names for the ids on the list, including one whose engine row has since gone. */
  const nameOf = (id: number) =>
    offered.find((engine) => engine.engine_id === id)?.name ?? t`Engine ${id}`

  const move = (at: number, by: number) => {
    const next = [...engineIds]
    const to = at + by
    if (to < 0 || to >= next.length) return
    ;[next[at], next[to]] = [next[to], next[at]]
    setChosen(next)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!dirty) return
    save.mutate({
      ...completeUpdate(stored),
      correspondence_enabled: enabled ? 1 : 0,
      correspondence_days_per_move: parse(text('correspondence_days_per_move')),
      correspondence_multipv: parse(text('correspondence_multipv')),
      correspondence_slots: parse(text('correspondence_slots')),
      correspondence_search_engine_ids: engineIds,
      correspondence_task_nodes: parse(text('correspondence_task_nodes')),
      correspondence_task_multipv: parse(text('correspondence_task_multipv')),
      correspondence_stale_depth: parse(text('correspondence_stale_depth')),
      correspondence_task_engine_id: taskEngineId,
    })
  }

  return (
    <PageBody>
      {chrome}
      {heading}
      <form noValidate onSubmit={submit} className="flex max-w-3xl flex-col gap-3">
        <Card>
          <CardHeader className="flex-col items-stretch gap-1">
            <CardTitle>
              <Trans>Correspondence mode</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Off, nothing changes: there is no rail entry and the screens are not
                reachable. Games already stored keep everything they hold.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-start gap-2">
              <Toggle
                checked={enabled}
                onChange={(next) =>
                  setDraft({ ...draft, correspondence_enabled: next ? '1' : '0' })
                }
                label={t`Show correspondence mode`}
              />
              <div className="flex flex-col gap-0.5 pt-1.5">
                <span className="text-[0.71875rem] text-body">
                  <Trans>Show correspondence mode</Trans>
                </span>
                <span className="text-[0.625rem] leading-[1.5] text-dim-2">
                  <Trans>
                    Adds Correspondence to the rail, after Live, with the number of games
                    waiting on your move.
                  </Trans>
                </span>
              </div>
            </div>
            {enabled ? (
              <p className="border-t border-hairline pt-3 text-[0.625rem] text-dim-2">
                <Trans>
                  Start a game from{' '}
                  <Link to="/correspondence" className="text-accent-teal hover:text-accent-link">
                    Correspondence
                  </Link>
                  .
                </Trans>
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-col items-stretch gap-1">
            <CardTitle>
              <Trans>Defaults for a new game</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                What a game created here is given, and how many lines a search over one
                position keeps. Both can be changed per game.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            {fields.map((field) => (
              <SettingField
                key={field.key}
                field={field}
                value={text(field.key)}
                onChange={(next) => setDraft({ ...draft, [field.key]: next })}
              />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-col items-stretch gap-1">
            <CardTitle>
              <Trans>Searches</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                A search is one engine on one position for as long as you let it. They have
                slots of their own, so a search that runs for days never takes one an
                imported game&rsquo;s quick pass is waiting for.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start gap-4">
              <SettingField
                field={slots}
                value={text(slots.key)}
                onChange={(next) => setDraft({ ...draft, [slots.key]: next })}
              />
              <p className="max-w-sm pt-6 text-[0.625rem] leading-[1.6] text-dim-2">
                <Trans>
                  Two is one CPU engine and one GPU engine at once. The server reads this
                  when it starts, so a change here takes effect after a restart.
                </Trans>
              </p>
            </div>

            <div className="flex flex-col gap-2 border-t border-hairline pt-3">
              <span className="text-[0.71875rem] text-body">
                <Trans>Engines the picker offers</Trans>
              </span>
              <span className="text-[0.625rem] leading-[1.5] text-dim-2">
                <Trans>
                  In your order; the first is the one Search with… suggests. Choose none and
                  every eligible engine is offered.
                </Trans>
              </span>
              {engineIds.length === 0 ? (
                <p className="text-[0.6875rem] text-dim">
                  <Trans>Every eligible engine is offered.</Trans>
                </p>
              ) : (
                <ul className="flex flex-col gap-1" data-testid="correspondence-engine-order">
                  {engineIds.map((id, at) => (
                    <li
                      key={id}
                      className="flex items-center gap-2 rounded-md border border-line bg-elevated px-2 py-1"
                    >
                      <span className="min-w-0 flex-1 truncate text-[0.71875rem] text-body">
                        {nameOf(id)}
                      </span>
                      {at === 0 ? (
                        <span className="font-mono text-[0.5625rem] text-dim-2 uppercase">
                          <Trans>default</Trans>
                        </span>
                      ) : null}
                      <OrderButton
                        label={t`Move ${nameOf(id)} up`}
                        disabled={at === 0}
                        onClick={() => move(at, -1)}
                      >
                        <ChevronUp aria-hidden />
                      </OrderButton>
                      <OrderButton
                        label={t`Move ${nameOf(id)} down`}
                        disabled={at === engineIds.length - 1}
                        onClick={() => move(at, 1)}
                      >
                        <ChevronDown aria-hidden />
                      </OrderButton>
                      <OrderButton
                        label={t`Remove ${nameOf(id)}`}
                        onClick={() => setChosen(engineIds.filter((one) => one !== id))}
                      >
                        <X aria-hidden />
                      </OrderButton>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {offered
                  .filter((engine) => !engineIds.includes(engine.engine_id))
                  .map((engine) => (
                    <button
                      key={engine.engine_id}
                      type="button"
                      onClick={() => setChosen([...engineIds, engine.engine_id])}
                      className={cn(
                        'rounded-md border border-edge px-2 py-1 text-[0.6875rem] text-dim',
                        'transition-colors hover:border-edge-hover hover:text-ink',
                      )}
                    >
                      + {engine.name}
                    </button>
                  ))}
                {offered.length === 0 ? (
                  <span className="text-[0.6875rem] text-dim-2">
                    <Trans>
                      No engine here can run a search: one is needed that is switched on,
                      speaks UCI and can drive a board.
                    </Trans>
                  </span>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-col items-stretch gap-1">
            <CardTitle>
              <Trans>Tasks</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                A task is one bounded look at one position, through the ordinary analysis
                queue — it takes no search slot, and an expansion is a dozen of them at
                once. Unlike a search, it can run on a remote runner.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex max-w-md flex-col gap-1.5">
              <Label htmlFor="correspondence-task-engine">
                <Trans>Task engine</Trans>
              </Label>
              <select
                id="correspondence-task-engine"
                value={taskEngineId === null ? '' : String(taskEngineId)}
                onChange={(event) =>
                  setTaskEngine(event.target.value === '' ? null : Number(event.target.value))
                }
                className="h-8 w-full min-w-0 rounded-md border border-input bg-elevated px-2 text-xs text-ink outline-none transition-colors hover:border-edge-hover focus-visible:border-accent-teal/50"
              >
                <option value="">{t`Whichever engine holds the deep role`}</option>
                {/* An engine that was chosen and has since been switched off or deleted is
                    still what is stored, and a select showing something else would be
                    lying about that. */}
                {taskEngineId !== null &&
                !taskEngines.some((host) => host.engineId === taskEngineId) ? (
                  <option value={String(taskEngineId)}>{t`Engine ${taskEngineId}`}</option>
                ) : null}
                {taskEngines.map((host) => (
                  <option key={host.engineId} value={String(host.engineId)}>
                    {host.runnerName ? `${host.name} · ${host.runnerName}` : host.name}
                  </option>
                ))}
              </select>
              <span className="text-[0.625rem] leading-[1.5] text-dim-2">
                <Trans>
                  Every engine that is switched on and speaks UCI, on this machine and on
                  your runners. A machine of its own is the setup this mode is happiest in.
                </Trans>
              </span>
            </div>
            <div className="flex flex-wrap gap-4 border-t border-hairline pt-3">
              {taskFields.map((field) => (
                <SettingField
                  key={field.key}
                  field={field}
                  value={text(field.key)}
                  onChange={(next) => setDraft({ ...draft, [field.key]: next })}
                />
              ))}
              <p className="max-w-xs pt-6 text-[0.625rem] leading-[1.6] text-dim-2">
                <Trans>
                  Forty million nodes is a minute or two of a modern engine. The line count
                  is also how wide an expansion can be, since the branches are made from
                  those lines. Below the stale depth a stored verdict is marked on the tree
                  as one to ask again.
                </Trans>
              </p>
            </div>
          </CardContent>
        </Card>
        {save.isError ? (
          <p role="alert" className="text-[0.6875rem] text-blunder">
            {save.error.message}
          </p>
        ) : null}
        <SaveRow
          dirty={dirty}
          pending={save.isPending}
          onRevert={() => {
            setDraft({})
            setChosen(null)
            setTaskEngine(undefined)
          }}
        />
      </form>
    </PageBody>
  )
}

/** A square icon press inside the engine list — three of them per row, all the same shape. */
function OrderButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-5 flex-none items-center justify-center rounded-sm text-dim transition-colors hover:bg-raised hover:text-ink disabled:cursor-default disabled:opacity-30 [&_svg]:size-3"
    >
      {children}
    </button>
  )
}

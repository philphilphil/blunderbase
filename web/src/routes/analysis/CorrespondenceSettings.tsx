/**
 * **Analysis → Correspondence**: whether the mode exists at all, and the two numbers a new
 * game and a new search start from.
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  completeUpdate,
  parseSetting as parse,
  settingText as storedText,
  SETTING_DEFAULTS as DEFAULTS,
} from '@/lib/api/appSettings'
import { useAppSettings, useCorrespondenceStatus, useSaveAppSettings } from '@/lib/api/queries'
import { cn } from '@/lib/utils'

type NumberKey =
  | 'correspondence_days_per_move'
  | 'correspondence_multipv'
  | 'correspondence_slots'

export function CorrespondenceSettingsPage() {
  const { t } = useLingui()
  const settings = useAppSettings()
  // The engines a search could run on, from the same endpoint the picker itself reads —
  // `enabled && uci && streams && !runner_id`, decided once on the server so this page and
  // the dialog cannot disagree about what "eligible" means. `status.engines` is the
  // picker's list, which is this setting already applied; this page needs the pool it is
  // chosen out of.
  const status = useCorrespondenceStatus()
  const save = useSaveAppSettings({
    onSuccess: () => {
      setDraft({})
      setChosen(null)
    },
  })
  const [draft, setDraft] = useState<
    Partial<Record<NumberKey | 'correspondence_enabled', string>>
  >({})
  /** null while the stored list stands; an array as soon as the owner has moved anything. */
  const [chosen, setChosen] = useState<number[] | null>(null)

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
  const keys = [
    'correspondence_enabled',
    ...fields.map((field) => field.key),
    slots.key,
  ] as const

  // `eligible_engines`, not `engines`: the latter is already this setting applied, so
  // choosing one engine would hide every other one from this page for good.
  const offered = status.data?.eligible_engines ?? []
  const storedEngines = stored.correspondence_search_engine_ids ?? []
  const engineIds = chosen ?? storedEngines
  const dirty =
    keys.some((key) => text(key) !== storedText(stored, key)) ||
    (chosen !== null && chosen.join(',') !== storedEngines.join(','))

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

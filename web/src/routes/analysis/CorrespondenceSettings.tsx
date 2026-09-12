/**
 * **Analysis → Correspondence**: whether the mode exists at all, and the numbers a new
 * game, a new search and a new task start from.
 *
 * It is a small page on purpose. Correspondence mode is off by default — most owners never
 * play it and should never see the rail entry — so the first thing on the page is the
 * switch that brings it into existence, and everything under it is what that mode will do
 * once it is on.
 *
 * **Search slots is not here.** How many searches run at once is a fact about a machine —
 * the twin of the queue's own cap, added to it, both against the same cores — so it is set
 * on Compute → Machines beside that cap, and this page only says so. Nothing here needs a
 * restart.
 *
 * **There is no engine setting here.** Every enabled UCI engine is offered wherever an
 * engine is chosen — the search dialog, Queue task, Expand, Refresh — with the deep role's
 * preselected; a search greys out the engines it cannot run on and says why. A list kept
 * here was a second place for the same choice, and one that hid engines from the dialogs.
 *
 * The form saves through `completeUpdate` like the other two settings pages: `PUT
 * /settings` is a replace, so a page that sent only its own fields would clear everything
 * Maia and Engine passes hold.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { useState, type FormEvent } from 'react'
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
import { useAppSettings, useSaveAppSettings } from '@/lib/api/queries'

type NumberKey =
  | 'correspondence_multipv'
  | 'correspondence_task_nodes'
  | 'correspondence_task_multipv'
  | 'correspondence_stale_depth'

export function CorrespondenceSettingsPage() {
  const { t } = useLingui()
  const settings = useAppSettings()
  const save = useSaveAppSettings({ onSuccess: () => setDraft({}) })
  const [draft, setDraft] = useState<
    Partial<Record<NumberKey | 'correspondence_enabled', string>>
  >({})

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
      key: 'correspondence_multipv',
      label: t`Lines per search`,
      min: 1,
      max: 5,
      step: 1,
      unset: t`Default 3`,
    },
  ]
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
    ...taskFields.map((field) => field.key),
  ] as const

  const dirty = keys.some((key) => text(key) !== storedText(stored, key))

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!dirty) return
    save.mutate({
      ...completeUpdate(stored),
      correspondence_enabled: enabled ? 1 : 0,
      correspondence_multipv: parse(text('correspondence_multipv')),
      correspondence_task_nodes: parse(text('correspondence_task_nodes')),
      correspondence_task_multipv: parse(text('correspondence_task_multipv')),
      correspondence_stale_depth: parse(text('correspondence_stale_depth')),
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
              <Trans>Defaults for a new search</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                How many lines a search over one position keeps unless the search dialog
                says otherwise. There is no default deadline: the server a game is played on
                owns its clock, and you type the date off that page.
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
          <CardContent className="flex flex-col gap-3">
            <p className="text-[0.625rem] leading-[1.6] text-dim-2">
              <Trans>
                How many searches this machine runs at once is set on{' '}
                <Link to="/compute/machines" className="text-accent-teal hover:text-accent-link">
                  Machines
                </Link>
                , beside the queue&rsquo;s own cap — the two are added, and both are read when
                the server starts.
              </Trans>
            </p>
            <p className="border-t border-hairline pt-3 text-[0.625rem] leading-[1.6] text-dim-2">
              <Trans>
                Which engine searches is chosen on the position: Search with… offers every
                engine that is switched on, with the one holding the deep role suggested.
              </Trans>
            </p>
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
                once. Unlike a search, it can run on a remote runner; which engine is
                chosen when the task is queued, with the deep role&rsquo;s suggested.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-4">
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
          onRevert={() => setDraft({})}
        />
      </form>
    </PageBody>
  )
}

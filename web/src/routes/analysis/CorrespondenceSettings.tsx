/**
 * **Analysis → Correspondence**: whether the mode exists at all, and the two numbers a new
 * game and a new search start from.
 *
 * It is a small page on purpose. Correspondence mode is off by default — most owners never
 * play it and should never see the rail entry — so the first thing on the page is the
 * switch that brings it into existence, and everything under it is what that mode will do
 * once it is on. Step 2 of `docs/correspondence.md` grows this page with search slots, the
 * engines to offer and the task budgets; the shape it grows into is this one.
 *
 * The form saves through `completeUpdate` like the other two settings pages: `PUT
 * /settings` is a replace, so a page that sent only its own three fields would clear
 * everything Maia and Engine passes hold.
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

type NumberKey = 'correspondence_days_per_move' | 'correspondence_multipv'

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
  const keys = ['correspondence_enabled', ...fields.map((field) => field.key)] as const
  const dirty = keys.some((key) => text(key) !== storedText(stored, key))

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!dirty) return
    save.mutate({
      ...completeUpdate(stored),
      correspondence_enabled: enabled ? 1 : 0,
      correspondence_days_per_move: parse(text('correspondence_days_per_move')),
      correspondence_multipv: parse(text('correspondence_multipv')),
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
        {save.isError ? (
          <p role="alert" className="text-[0.6875rem] text-blunder">
            {save.error.message}
          </p>
        ) : null}
        <SaveRow dirty={dirty} pending={save.isPending} onRevert={() => setDraft({})} />
      </form>
    </PageBody>
  )
}

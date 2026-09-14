/**
 * The two configuration pages under Analysis: **Engine passes** and **Maia**.
 *
 * One Settings page held both, plus the board preferences and the danger zone, which meant
 * a form of eleven boxes where nothing said which of them belonged together or which pass
 * a change would show up in. Split by the question being asked instead — how hard the
 * engine works and where the move labels fall, versus which humans Maia speaks for and
 * when it is asked — each page is one screen the owner can read to the bottom.
 *
 * They share this file because they share a shape — a draft over the stored settings, a
 * Save that sends the whole of them (`lib/api/appSettings.ts`) — and because a reader
 * comparing the two pages should not have to open two. What is *not* here is queueing work
 * over the library: that is not configuration, and stays on the Analysis overview
 * (`LibraryActions`) — the Maia page links out to it.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { Plus, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { Toggle } from '@/components/analysis/AnalysisControls'
import { SaveRow, SettingField, type SettingSpec } from '@/components/settings/SettingField'
import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  completeUpdate,
  parseSetting as parse,
  settingText as storedText,
  SETTING_DEFAULTS as DEFAULTS,
} from '@/lib/api/appSettings'
import { useAppSettings, useSaveAppSettings } from '@/lib/api/queries'
import {
  DEFAULT_MAIA_TARGET_ELO,
  MAIA_ELO_STEP,
  MAIA_MAX_ELO,
  MAIA_MIN_ELO,
  MAX_MAIA_ELOS,
  type AppSettings,
} from '@/lib/api/types'

type EngineKey =
  | 'analysis_nodes'
  | 'analysis_multipv'
  | 'inaccuracy_threshold'
  | 'mistake_threshold'
  | 'blunder_threshold'
type MaiaFlagKey = 'maia_on_analysis' | 'maia_both_sides'

/** Every Maia flag the page edits, for the dirty check that compares them all. */
const MAIA_FLAG_KEYS: readonly MaiaFlagKey[] = ['maia_on_analysis', 'maia_both_sides']

/**
 * The same spec `SettingField` takes, with the two strings a reader sees held as messages
 * until the page renders them — a table filled in at import time would freeze the wording
 * in whichever language the tab was opened in.
 */
interface EngineSpec extends Omit<SettingSpec<EngineKey>, 'label' | 'unset'> {
  label: MessageDescriptor
  unset: MessageDescriptor
}

/**
 * One budget and one line count, because there is one pass. The line cap is 5 rather than
 * the 10 the old deep lines allowed: every run over a game — this pass or one asked for in
 * the Analyse dialog — keeps at most five, and a setting above what a run may carry would
 * be refused by the backend on save.
 */
const PASS_FIELDS: EngineSpec[] = [
  {
    key: 'analysis_nodes',
    label: msg`Nodes per move`,
    min: 1,
    step: 50_000,
    unset: msg`Default 500,000`,
  },
  { key: 'analysis_multipv', label: msg`Lines`, min: 1, max: 5, step: 1, unset: msg`Default 2` },
]

const CLASSIFICATION_FIELDS: EngineSpec[] = [
  {
    key: 'inaccuracy_threshold',
    label: msg`Inaccuracy`,
    min: 0,
    max: 100,
    step: 1,
    unset: msg`Default 5`,
  },
  { key: 'mistake_threshold', label: msg`Mistake`, min: 0, max: 100, step: 1, unset: msg`Default 10` },
  { key: 'blunder_threshold', label: msg`Blunder`, min: 0, max: 100, step: 1, unset: msg`Default 15` },
]

const FLAGS: { key: MaiaFlagKey; label: MessageDescriptor; caption: MessageDescriptor }[] = [
  {
    key: 'maia_on_analysis',
    label: msg`Maia on the analysis pass`,
    caption: msg`Adds human-move predictions to every pass — the one each imported game receives and the ones you ask for with Analyse…`,
  },
  {
    key: 'maia_both_sides',
    label: msg`Ask about both sides`,
    caption: msg`Off asks only about your moves; on also predicts what the opponent is likely to play.`,
  },
]

function LoadingOrError({
  pending,
  error,
  retry,
}: {
  pending: boolean
  error: Error | null
  retry: () => void
}) {
  if (pending) return <Skeleton className="h-28 w-full max-w-3xl" data-testid="settings-loading" />
  if (!error) return null
  return (
    <div className="max-w-2xl rounded-md border border-blunder/28 bg-blunder/5 px-3 py-2.5">
      <p className="text-[0.75rem] text-blunder">
        <Trans>The analysis configuration could not be read.</Trans>
      </p>
      <p className="mt-1 font-mono text-[0.6875rem] text-blunder/80">{error.message}</p>
      <Button type="button" variant="outline" size="sm" className="mt-2.5" onClick={retry}>
        <Trans>Try again</Trans>
      </Button>
    </div>
  )
}

/**
 * What a pass costs and what it calls a mistake — the two things that decide what the rest
 * of the app says about a game. Both cards are numbers with an empty box meaning "the
 * default", never zero, which is why every field spells its default underneath.
 */
export function EnginePassesPage() {
  const { i18n, t } = useLingui()
  const settings = useAppSettings()
  const save = useSaveAppSettings({
    onSuccess: () => {
      setDraft({})
      setHideNew(null)
    },
  })
  const [draft, setDraft] = useState<Partial<Record<EngineKey, string>>>({})
  // The one switch on this page: null while the reader has not touched it, so the stored
  // value shows through and "dirty" means what it says.
  const [hideNew, setHideNew] = useState<boolean | null>(null)
  const value = (key: EngineKey) => draft[key] ?? storedText(settings.data, key)
  const fields = [...PASS_FIELDS, ...CLASSIFICATION_FIELDS]
  const storedHideNew =
    (settings.data?.hide_engine_new_games ?? DEFAULTS.hide_engine_new_games) === 1
  const hideNewShown = hideNew ?? storedHideNew
  const dirty =
    fields.some((field) => value(field.key) !== storedText(settings.data, field.key)) ||
    hideNewShown !== storedHideNew
  /** The two strings the box shows, in the reader's language. */
  const spec = (field: EngineSpec): SettingSpec<EngineKey> => ({
    ...field,
    label: i18n._(field.label),
    unset: i18n._(field.unset),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!dirty || !settings.data) return
    const body = completeUpdate(settings.data)
    for (const field of fields) body[field.key] = parse(value(field.key))
    body.hide_engine_new_games = hideNewShown ? 1 : 0
    save.mutate(body)
  }

  return (
    <PageBody>
      <SetPageChrome
        breadcrumb={[{ label: t`Analysis`, to: '/analysis' }, { label: t`Engine passes` }]}
        manual="guide/analysis#how-much-work-does-a-pass-do"
      />
      <PageHeader
        title={t`Engine passes`}
        description={t`How much work the analysis pass does, and how its results become move labels.`}
      />
      <LoadingOrError pending={settings.isPending} error={settings.error} retry={() => void settings.refetch()} />
      {settings.data ? (
        <form noValidate onSubmit={submit} className="flex max-w-3xl flex-col gap-3">
          <Card>
            <CardHeader className="flex-col items-stretch gap-1">
              <CardTitle>
                <Trans>Analysis pass</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Runs automatically on every imported game and on a backfill. Deeper work on
                  one game is asked for there, with Analyse…, which starts from these numbers.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-4">
              {PASS_FIELDS.map((field) => (
                <SettingField key={field.key} field={spec(field)} value={value(field.key)} onChange={(next) => setDraft({ ...draft, [field.key]: next })} />
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-col items-stretch gap-1">
              <CardTitle>
                <Trans>Move classification</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Win-percentage points lost by the mover. The three thresholds must rise.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-4">
              {CLASSIFICATION_FIELDS.map((field) => (
                <SettingField key={field.key} field={spec(field)} value={value(field.key)} onChange={(next) => setDraft({ ...draft, [field.key]: next })} />
              ))}
            </CardContent>
          </Card>
          {/*
            Not a budget, but it belongs beside them: it decides what the analysis pass every
            new game receives is allowed to *show* before the owner has read the game. The
            browser-wide ⇧E mode hides everything everywhere; this is the per-game version,
            stored on the game, so it survives a second browser and comes off one game at
            a time.
          */}
          <Card>
            <CardHeader className="flex-col items-stretch gap-1">
              <CardTitle>
                <Trans>New games</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Read a game yourself before the engine tells you where it went wrong.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-start gap-2">
                <Toggle
                  checked={hideNewShown}
                  onChange={setHideNew}
                  label={t`Hide the engine on new games`}
                />
                <div className="flex flex-col gap-0.5 pt-1.5">
                  <span className="text-[0.71875rem] text-body">
                    <Trans>Hide the engine on new games</Trans>
                  </span>
                  <span className="text-[0.625rem] leading-[1.5] text-dim-2">
                    <Trans>
                      Every game you import from now on is analysed as usual but shows no
                      evaluation, badge or line until you press <strong>Show the engine</strong> on
                      that game. Games already in the library are left as they are.
                    </Trans>
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
          {save.isError ? <p role="alert" className="text-[0.6875rem] text-blunder">{save.error.message}</p> : null}
          <SaveRow
            dirty={dirty}
            pending={save.isPending}
            onRevert={() => {
              setDraft({})
              setHideNew(null)
            }}
          />
        </form>
      ) : null}
    </PageBody>
  )
}

function normalizeElo(value: number): number {
  return Math.min(MAIA_MAX_ELO, Math.max(MAIA_MIN_ELO, Math.round(value / MAIA_ELO_STEP) * MAIA_ELO_STEP))
}

function storedElos(settings: AppSettings): number[] {
  return settings.maia_elos?.length ? [...new Set(settings.maia_elos)].sort((a, b) => a - b) : [settings.maia_target_elo]
}

function MaiaLevels({ elos, onChange }: { elos: number[]; onChange: (next: number[]) => void }) {
  const { t } = useLingui()
  const [text, setText] = useState('')
  const full = elos.length >= MAX_MAIA_ELOS
  const typed = parse(text)
  const candidate = typed === null ? null : normalizeElo(typed)
  const addable = candidate !== null && !full && !elos.includes(candidate)

  function add(elo: number) {
    onChange([...new Set([...elos, elo])].sort((a, b) => a - b))
    setText('')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-6 flex-wrap items-center gap-1.5" data-testid="maia-elos">
        {elos.map((elo) => (
          <span key={elo} className="inline-flex items-center gap-1 rounded-full border border-brilliant/35 bg-brilliant/10 py-0.5 pl-2 pr-1 font-mono text-[0.6875rem] text-brilliant">
            {elo}
            <button type="button" aria-label={t`Remove ${elo}`} disabled={elos.length < 2} onClick={() => onChange(elos.filter((each) => each !== elo))} className="rounded-full p-px disabled:opacity-40">
              <X className="size-2.5" aria-hidden />
            </button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex w-28 flex-none flex-col gap-1.5">
          <Label htmlFor="maia-level">
            <Trans>Add a level</Trans>
          </Label>
          <Input
            id="maia-level"
            type="number"
            min={MAIA_MIN_ELO}
            max={MAIA_MAX_ELO}
            step={MAIA_ELO_STEP}
            value={text}
            placeholder={String(DEFAULT_MAIA_TARGET_ELO)}
            disabled={full}
            className="font-mono"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              if (addable && candidate !== null) add(candidate)
            }}
          />
        </div>
        <Button type="button" variant="outline" size="sm" disabled={!addable} onClick={() => candidate !== null && add(candidate)}>
          <Plus aria-hidden /> <Trans context="button">Add</Trans>
        </Button>
      </div>
    </div>
  )
}

/**
 * Which humans Maia speaks for, and whether the analysis pass pays for the answer.
 *
 * The levels are a set, not a number, because the reading is a comparison — what a 1500
 * plays here beside what a 1900 plays here — and every surface asks the same set, so the
 * board and the coach never quote two different humans. Changing them only affects games
 * analysed afterwards, hence the link out to the fill on the Analysis overview.
 */
export function MaiaSettingsPage() {
  const { i18n, t } = useLingui()
  const settings = useAppSettings()
  const save = useSaveAppSettings({ onSuccess: () => { setDraft({}); setElos(null) } })
  const [draft, setDraft] = useState<Partial<Record<MaiaFlagKey, string>>>({})
  const [elos, setElos] = useState<number[] | null>(null)

  if (!settings.data) {
    return (
      <PageBody>
        <SetPageChrome
          breadcrumb={[{ label: t`Analysis`, to: '/analysis' }, { label: 'Maia' }]}
          manual="guide/analysis#what-is-maia-asked"
        />
        <PageHeader title="Maia" description={t`Which human levels the analysis asks about and when it asks them.`} />
        <LoadingOrError pending={settings.isPending} error={settings.error} retry={() => void settings.refetch()} />
      </PageBody>
    )
  }

  const stored = settings.data
  const levels = elos ?? storedElos(stored)
  const text = (key: MaiaFlagKey) => draft[key] ?? storedText(stored, key)
  const flag = (key: MaiaFlagKey) => (parse(text(key)) ?? DEFAULTS[key]) === 1
  const dirty =
    levels.join(',') !== storedElos(stored).join(',') ||
    MAIA_FLAG_KEYS.some((key) => text(key) !== storedText(stored, key))

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!dirty) return
    save.mutate({
      ...completeUpdate(stored),
      maia_elos: levels,
      maia_target_elo: null,
      maia_on_analysis: flag('maia_on_analysis') ? 1 : 0,
      maia_both_sides: flag('maia_both_sides') ? 1 : 0,
    })
  }

  return (
    <PageBody>
      <SetPageChrome
        breadcrumb={[{ label: t`Analysis`, to: '/analysis' }, { label: 'Maia' }]}
        manual="guide/analysis#what-is-maia-asked"
      />
      <PageHeader title="Maia" description={t`Which human levels the analysis asks about and when it asks them.`} />
      <form noValidate onSubmit={submit} className="flex max-w-3xl flex-col gap-3">
        <Card>
          <CardHeader className="flex-col items-stretch gap-1">
            <CardTitle>
              <Trans>Human levels</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Choose up to {MAX_MAIA_ELOS} rating levels. Every position is asked at all of
                them, so the answers can be read against each other.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <MaiaLevels elos={levels} onChange={setElos} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-col items-stretch gap-1">
            <CardTitle>
              <Trans>When Maia runs</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Choose whether passes pay for human-move predictions and whose moves they cover.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {FLAGS.map((item) => {
              const label = i18n._(item.label)
              return (
                <div key={item.key} className="flex items-start gap-2">
                  <Toggle checked={flag(item.key)} onChange={(next) => setDraft({ ...draft, [item.key]: next ? '1' : '0' })} label={label} />
                  <div className="flex flex-col gap-0.5 pt-1.5">
                    <span className="text-[0.71875rem] text-body">{label}</span>
                    <span className="text-[0.625rem] leading-[1.5] text-dim-2">{i18n._(item.caption)}</span>
                  </div>
                </div>
              )
            })}
            <p className="border-t border-hairline pt-3 text-[0.625rem] text-dim-2">
              <Trans>
                Changed the levels? <Link to="/analysis" className="text-accent-teal hover:text-accent-link">Fill missing levels</Link> from Analysis overview.
              </Trans>
            </p>
          </CardContent>
        </Card>
        {save.isError ? <p role="alert" className="text-[0.6875rem] text-blunder">{save.error.message}</p> : null}
        <SaveRow dirty={dirty} pending={save.isPending} onRevert={() => { setDraft({}); setElos(null) }} />
      </form>
    </PageBody>
  )
}

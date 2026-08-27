import { Loader2, RotateCcw, Save, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppSettings, useGames, useSaveAppSettings } from '@/lib/api/queries'
import { DEFAULT_MAIA_TARGET_ELO } from '@/lib/api/types'
import type { AppSettings, AppSettingsUpdate, GamesDeleted } from '@/lib/api/types'

import { DeleteAllGamesDialog } from './DeleteAllGamesDialog'

/** What Maia was trained on. Anything outside is clamped by the backend, not refused. */
export const MIN_TARGET_ELO = 1100
export const MAX_TARGET_ELO = 2000

/**
 * The defaults the backend falls back to under an empty box (`services/app_settings.py`).
 * Repeated here rather than fetched because they are what the *page* has to say about a
 * field nobody has set, and a second call to learn them would leave the form blank while
 * it landed.
 */
export const DEFAULTS = {
  maia_target_elo: DEFAULT_MAIA_TARGET_ELO,
  quick_nodes: 250_000,
  deep_nodes: 2_000_000,
  deep_multipv: 4,
  inaccuracy_threshold: 5,
  mistake_threshold: 10,
  blunder_threshold: 15,
  default_owner_rating: 1500,
} as const

type Key = keyof AppSettings

interface Field {
  key: Key
  label: string
  /** The box's range and step. `min`/`max` bound the spinner; the backend owns the rule. */
  min: number
  max?: number
  step: number
  /** What is in force when the box is empty, spelled the way the row wants it read. */
  unset: string
}

const MAIA_FIELD: Field = {
  key: 'maia_target_elo',
  label: 'Target elo',
  min: MIN_TARGET_ELO,
  max: MAX_TARGET_ELO,
  step: 50,
  unset: `Default ${DEFAULTS.maia_target_elo}`,
}

const ANALYSIS_FIELDS: Field[] = [
  {
    key: 'quick_nodes',
    label: 'Quick nodes',
    min: 1,
    step: 10_000,
    unset: `Default ${DEFAULTS.quick_nodes.toLocaleString('en-US')}`,
  },
  {
    key: 'deep_nodes',
    label: 'Deep nodes',
    min: 1,
    step: 100_000,
    unset: `Default ${DEFAULTS.deep_nodes.toLocaleString('en-US')}`,
  },
  {
    key: 'deep_multipv',
    label: 'Deep lines',
    min: 1,
    max: 10,
    step: 1,
    unset: `Default ${DEFAULTS.deep_multipv}`,
  },
]

const CLASSIFICATION_FIELDS: Field[] = [
  {
    key: 'inaccuracy_threshold',
    label: 'Inaccuracy',
    min: 0,
    max: 100,
    step: 1,
    unset: `Default ${DEFAULTS.inaccuracy_threshold}`,
  },
  {
    key: 'mistake_threshold',
    label: 'Mistake',
    min: 0,
    max: 100,
    step: 1,
    unset: `Default ${DEFAULTS.mistake_threshold}`,
  },
  {
    key: 'blunder_threshold',
    label: 'Blunder',
    min: 0,
    max: 100,
    step: 1,
    unset: `Default ${DEFAULTS.blunder_threshold}`,
  },
]

const DEFAULTS_FIELDS: Field[] = [
  {
    key: 'default_owner_rating',
    label: 'Owner rating',
    min: 1,
    step: 50,
    unset: `Default ${DEFAULTS.default_owner_rating}`,
  },
]

const FIELDS: Field[] = [
  MAIA_FIELD,
  ...ANALYSIS_FIELDS,
  ...CLASSIFICATION_FIELDS,
  ...DEFAULTS_FIELDS,
]

/**
 * The stored value as the box shows it: empty is "nobody has set this one". The target elo
 * never comes back empty — the deployment always has a level — so its box always has a
 * number in it, and emptying it is how the default is asked for.
 */
function storedText(settings: AppSettings | undefined, key: Key): string {
  const value = settings?.[key]
  return value === null || value === undefined ? '' : String(value)
}

/** An empty box is a cleared setting; there is one way to be unset. */
function parse(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/** A count with the noun it counts, so no sentence has to say "1 games". */
function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

/**
 * The one control in the app that destroys rather than changes.
 *
 * At the bottom, in its own card and behind its own dialog, because a settings page is
 * somewhere an owner goes to read as often as to act. The count beside the button is the
 * same one the dialog names — it is what tells them which database this is before the
 * password is asked for.
 */
function DangerZone() {
  const games = useGames({ limit: 1 })
  const [asking, setAsking] = useState(false)
  const [deleted, setDeleted] = useState<GamesDeleted | null>(null)
  const total = games.data?.total

  return (
    <Card className="max-w-3xl border-blunder/28">
      <CardHeader className="flex-col items-stretch gap-1">
        <CardTitle className="text-blunder">Danger zone</CardTitle>
        <CardDescription>
          Deleting the games removes every game, its analysis and its notes, and the sync
          history with them — the next sync re-imports from the beginning. Accounts, engines
          and notes about a position stay.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-blunder/40 text-blunder hover:border-blunder hover:text-blunder"
          onClick={() => {
            setDeleted(null)
            setAsking(true)
          }}
        >
          <Trash2 aria-hidden />
          Delete all games…
        </Button>
        {deleted ? (
          <p role="status" className="text-[0.6875rem] leading-[1.5] text-dim">
            {`Deleted ${plural(deleted.games, 'game')}, ${plural(deleted.runs, 'analysis run')} and ${plural(deleted.notes, 'note')}.`}
          </p>
        ) : total === undefined ? null : (
          <p className="text-[0.6875rem] leading-[1.5] text-dim-2">
            {`${plural(total, 'game')} in the database.`}
          </p>
        )}
      </CardContent>

      {asking ? (
        <DeleteAllGamesDialog
          games={total}
          onClose={() => setAsking(false)}
          onDone={(result) => {
            setDeleted(result)
            setAsking(false)
          }}
        />
      ) : null}
    </Card>
  )
}

/**
 * Settings. Four cards over the eight numbers a deployment keeps in its database rather
 * than in its environment, and the danger zone under them.
 *
 * Each box is a draft over the stored value rather than a copy of it: a key missing from
 * `draft` means "showing what the server said", which is what makes a save land in the
 * boxes without an effect chasing the query. The backend clamps rather than refuses, so
 * the answer to a save is what is actually in force — and dropping the drafts on success
 * is how that answer, not the typing, is what stays on screen.
 *
 * One Save for the form, because a PUT is the whole of the settings rather than a patch of
 * them. The one refusal is a set of classification thresholds that does not rise, which
 * comes back as a 422 and is shown against the form.
 */
export function SettingsPage() {
  const settings = useAppSettings()
  const save = useSaveAppSettings({ onSuccess: () => setDraft({}) })
  const [draft, setDraft] = useState<Partial<Record<Key, string>>>({})

  const text = (key: Key) => draft[key] ?? storedText(settings.data, key)
  const dirty = FIELDS.some((field) => text(field.key) !== storedText(settings.data, field.key))

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!dirty) return
    // Spelled out rather than folded over `FIELDS`: a PUT is the whole of the settings,
    // and this is the one place that has to name every one of them.
    const body: AppSettingsUpdate = {
      maia_target_elo: parse(text('maia_target_elo')),
      quick_nodes: parse(text('quick_nodes')),
      deep_nodes: parse(text('deep_nodes')),
      deep_multipv: parse(text('deep_multipv')),
      inaccuracy_threshold: parse(text('inaccuracy_threshold')),
      mistake_threshold: parse(text('mistake_threshold')),
      blunder_threshold: parse(text('blunder_threshold')),
      default_owner_rating: parse(text('default_owner_rating')),
    }
    save.mutate(body)
  }

  function row(field: Field) {
    const id = field.key.replace(/_/g, '-')
    return (
      <div key={field.key} className="flex w-32 flex-none flex-col gap-1.5">
        <Label htmlFor={id}>{field.label}</Label>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={field.min}
          max={field.max}
          step={field.step}
          value={text(field.key)}
          placeholder="not set"
          autoComplete="off"
          className="w-full font-mono tabular"
          onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
        />
        <span className="font-mono text-[0.625rem] text-dim-2 tabular">{field.unset}</span>
      </div>
    )
  }

  return (
    <PageBody>
      <SetPageChrome breadcrumb={[{ label: 'Settings', to: '/settings' }, { label: 'General' }]} />
      <PageHeader
        title="Settings"
        description="How this deployment is set up, beyond the engines it runs."
      />

      {settings.isPending ? (
        <Skeleton className="h-8 w-40" data-testid="settings-loading" />
      ) : settings.isError ? (
        <div className="max-w-2xl rounded-md border border-blunder/28 bg-blunder/5 px-3 py-2.5">
          <p className="text-[0.75rem] text-blunder">The settings could not be read.</p>
          <p className="mt-1 font-mono text-[0.6875rem] text-blunder/80">
            {settings.error.message}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2.5"
            onClick={() => void settings.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : (
        /*
          `noValidate` on purpose: `min`/`max` on the boxes bound their spinners and tell a
          screen reader the range, but the *rule* is the backend's clamp, and there is one
          of it. Left to validate, the browser would refuse to submit 2400 with a bubble of
          its own wording, where the deployment's answer is simply 2000.
        */
        <form noValidate onSubmit={submit} className="flex max-w-3xl flex-col gap-3">
          {/* Two single-number cards share a row; the three-number cards run their boxes
              across rather than down. Dense on a laptop, still one column on a phone. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Card>
              <CardHeader className="flex-col items-stretch gap-1">
                <CardTitle>Maia</CardTitle>
                <CardDescription>
                  The one rating Maia is asked at everywhere — the batch pass over both sides
                  of every game, and the analysis board&rsquo;s live column. Set it to the
                  rating you are playing towards; one level for every game is what makes two
                  of them comparable. Emptied, it goes back to {DEFAULTS.maia_target_elo}.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-4">{row(MAIA_FIELD)}</CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-col items-stretch gap-1">
                <CardTitle>Defaults</CardTitle>
                <CardDescription>
                  The rating to stand in for yours where a game carries none — an
                  over-the-board PGN, an unrated game.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-4">{DEFAULTS_FIELDS.map(row)}</CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex-col items-stretch gap-1">
              <CardTitle>Analysis</CardTitle>
              <CardDescription>
                What one position costs the engine. Quick is the automatic pass on import and is
                sized to keep up with an archive sync; deep is the one someone is waiting on, and
                keeps several lines per position.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-4">{ANALYSIS_FIELDS.map(row)}</CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-col items-stretch gap-1">
              <CardTitle>Classification</CardTitle>
              <CardDescription>
                What a move has to give away to earn each name, in win-percentage points lost by
                the mover — not centipawns, which overweight a swing between two already-winning
                positions. The three have to rise.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-4">
              {CLASSIFICATION_FIELDS.map(row)}
            </CardContent>
          </Card>

          {save.isError ? (
            <p role="alert" className="text-[0.6875rem] leading-[1.5] text-blunder">
              {save.error.message}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <p className="flex-1 text-[0.6875rem] leading-[1.5] text-dim-2">
              An empty box is that setting cleared, back to its default. Budgets and thresholds
              apply to analysis from here on: a game already analysed keeps the numbers it was
              analysed with until a fresh pass runs over it.
            </p>
            {dirty ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={save.isPending}
                onClick={() => setDraft({})}
              >
                <RotateCcw aria-hidden />
                Revert
              </Button>
            ) : null}
            <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
              {save.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Save aria-hidden />
              )}
              Save
            </Button>
          </div>
        </form>
      )}

      <DangerZone />
    </PageBody>
  )
}

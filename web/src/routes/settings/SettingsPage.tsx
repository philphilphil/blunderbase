import { Loader2, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { Toggle } from '@/components/analysis/AnalysisControls'
import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppSettings, useGames, useSaveAppSettings } from '@/lib/api/queries'
import {
  DEFAULT_MAIA_TARGET_ELO,
  MAIA_ELO_STEP,
  MAIA_MAX_ELO,
  MAIA_MIN_ELO,
  MAX_MAIA_ELOS,
} from '@/lib/api/types'
import type { AppSettings, AppSettingsUpdate, GamesDeleted } from '@/lib/api/types'

import { BoardPreviewCard } from './BoardPreviewCard'
import { DeleteAllGamesDialog } from './DeleteAllGamesDialog'

/** What Maia was trained on. Anything outside is clamped by the backend, not refused. */
export const MIN_TARGET_ELO = MAIA_MIN_ELO
export const MAX_TARGET_ELO = MAIA_MAX_ELO

/**
 * The defaults the backend falls back to under an empty box (`services/app_settings.py`).
 * Repeated here rather than fetched because they are what the *page* has to say about a
 * field nobody has set, and a second call to learn them would leave the form blank while
 * it landed.
 */
export const DEFAULTS = {
  maia_target_elo: DEFAULT_MAIA_TARGET_ELO,
  maia_on_quick: 1,
  maia_on_deep: 0,
  maia_both_sides: 1,
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

/**
 * Every plain-number field. The Maia levels are not among them: they are a list, edited as
 * chips, and the one setting whose PUT value is not the text of a box.
 */
const FIELDS: Field[] = [...ANALYSIS_FIELDS, ...CLASSIFICATION_FIELDS, ...DEFAULTS_FIELDS]

/**
 * The three switches over the Maia pass, which are 0/1 rows of the same settings table and
 * so ride in the same draft as the boxes — the toggle writes `'1'` or `'0'` where a box
 * writes its text.
 *
 * They are on this page rather than on a run because they are what a pass *costs*: the
 * Maia pass is 40-70% of a quick run, and which tiers pay for it is a standing choice.
 */
interface Flag {
  key: FlagKey
  label: string
  caption: string
}

type FlagKey = 'maia_on_quick' | 'maia_on_deep' | 'maia_both_sides'

const FLAGS: Flag[] = [
  {
    key: 'maia_on_quick',
    label: 'Run Maia on quick passes',
    caption:
      'The quick pass is the one every imported game gets, so it is where the human-move columns are worth their extra minutes.',
  },
  {
    key: 'maia_on_deep',
    label: 'Run Maia on deep passes',
    caption:
      'Off by default. Maia answers a position, not a search budget, so a deep pass would recompute the policy the quick pass already stored — the fill on the Analysis page is what adds a level to a game that only ever had a deep pass.',
  },
  {
    key: 'maia_both_sides',
    label: 'Ask about both sides',
    caption:
      'Off halves what the pass costs by asking only about your own moves. On is what answers “what will my opponent fall into” — that is a question about the plies they move in.',
  },
]

const FLAG_KEYS: FlagKey[] = FLAGS.map((flag) => flag.key)

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

// --- the Maia levels -------------------------------------------------------

/**
 * A level as the list keeps it: on the 50-point grid Maia's weights are named on, inside
 * the band they cover. The backend clamps too — this only stops the box offering a level
 * that would come back as a different number.
 */
function normalizeElo(value: number): number {
  const stepped = Math.round(value / MAIA_ELO_STEP) * MAIA_ELO_STEP
  return Math.min(MAIA_MAX_ELO, Math.max(MAIA_MIN_ELO, stepped))
}

/** The levels in force, sorted and deduped the way the backend stores them. */
function storedElos(settings: AppSettings | undefined): number[] {
  if (!settings) return []
  const elos = settings.maia_elos
  if (Array.isArray(elos) && elos.length > 0) {
    return [...new Set(elos)].sort((left, right) => left - right)
  }
  return [settings.maia_target_elo]
}

/**
 * The levels this deployment asks Maia at — a list rather than a number, because the
 * interesting reading of a move is rarely one level's ("62% of 1500s play this, and 8% of
 * 2000s do" is the reading, and it needs both).
 *
 * Chips rather than five boxes: the levels are a set, order carries nothing, and adding one
 * is the common action while editing one in place is not an action at all — a level is a
 * name for a set of weights, so a mistyped level is removed and re-added.
 */
function MaiaLevels({
  elos,
  ownerRating,
  onChange,
}: {
  elos: number[]
  ownerRating: number
  onChange: (next: number[]) => void
}) {
  const [text, setText] = useState('')
  const full = elos.length >= MAX_MAIA_ELOS
  const typed = parse(text)
  const candidate = typed === null ? null : normalizeElo(typed)
  const addable = candidate !== null && !full && !elos.includes(candidate)
  // The owner's own rating, on the grid: the level that answers "would a player like me
  // have played this", which is the first level anybody wants and the fiddliest to type.
  const mine = normalizeElo(ownerRating)
  const quick = full || elos.includes(mine) ? null : mine

  function add(elo: number) {
    onChange([...new Set([...elos, elo])].sort((left, right) => left - right))
    setText('')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-6 flex-wrap items-center gap-1.5" data-testid="maia-elos">
        {elos.length === 0 ? (
          <span className="font-mono text-[0.625rem] text-dim-2">no levels</span>
        ) : (
          elos.map((elo) => (
            <span
              key={elo}
              className="inline-flex items-center gap-1 rounded-full border border-brilliant/35 bg-brilliant/10 py-0.5 pl-2 pr-1 font-mono text-[0.6875rem] tabular text-brilliant"
            >
              {elo}
              <button
                type="button"
                aria-label={`Remove ${elo}`}
                // Never none: there is no such thing as a deployment that asks Maia at no
                // rating, so the last chip is not removable — it is replaced.
                disabled={elos.length < 2}
                onClick={() => onChange(elos.filter((each) => each !== elo))}
                className="rounded-full p-px text-brilliant/70 hover:bg-brilliant/20 hover:text-brilliant disabled:pointer-events-none disabled:opacity-40"
              >
                <X className="size-2.5" aria-hidden />
              </button>
            </span>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex w-24 flex-none flex-col gap-1.5">
          <Label htmlFor="maia-level">Add a level</Label>
          <Input
            id="maia-level"
            type="number"
            inputMode="numeric"
            min={MAIA_MIN_ELO}
            max={MAIA_MAX_ELO}
            step={MAIA_ELO_STEP}
            value={text}
            placeholder={String(mine)}
            autoComplete="off"
            disabled={full}
            className="w-full font-mono tabular"
            onChange={(event) => setText(event.target.value)}
            // Enter in this box adds the level rather than saving the form: the box is a
            // list's entry field, and a Save that swallowed the typed level would store the
            // list without it.
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              if (addable && candidate !== null) add(candidate)
            }}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!addable}
          onClick={() => (candidate === null ? undefined : add(candidate))}
        >
          <Plus aria-hidden />
          Add
        </Button>
        {quick === null ? null : (
          <Button type="button" variant="ghost" size="sm" onClick={() => add(quick)}>
            {`Your rating (${quick})`}
          </Button>
        )}
        {full ? (
          <span className="text-[0.625rem] leading-[1.5] text-dim-2">
            {`${MAX_MAIA_ELOS} levels is the most one pass can afford.`}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * One switch with its label and the sentence that says what turning it off buys.
 *
 * The caption is not decoration: each of these three trades money for an answer — engine
 * minutes against a human-move column — and a bare label leaves the owner guessing which
 * way the trade runs.
 */
function FlagRow({
  flag,
  checked,
  onChange,
}: {
  flag: Flag
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-start gap-2">
      <Toggle checked={checked} onChange={onChange} label={flag.label} />
      <div className="flex flex-col gap-0.5 pt-1.5">
        <span className="text-[0.71875rem] leading-[1.4] text-body">{flag.label}</span>
        <span className="text-[0.625rem] leading-[1.5] text-dim-2">{flag.caption}</span>
      </div>
    </div>
  )
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
 * Settings. Four cards over the eleven numbers a deployment keeps in its database rather
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
  const save = useSaveAppSettings({
    onSuccess: () => {
      setDraft({})
      setElos(null)
    },
  })
  const [draft, setDraft] = useState<Partial<Record<Key, string>>>({})
  // The levels are a list rather than the text of a box, so they draft on their own; null
  // is "showing what the server said", exactly as a missing key is for the boxes.
  const [elos, setElos] = useState<number[] | null>(null)

  const text = (key: Key) => draft[key] ?? storedText(settings.data, key)
  const stored = storedElos(settings.data)
  const levels = elos ?? stored
  // A flag nobody has set comes back null, and what is in force is the default — which is
  // the position the switch has to show, since a switch has no third state to mean "unset".
  const flag = (key: FlagKey) => (parse(text(key)) ?? DEFAULTS[key]) === 1
  const dirty =
    FIELDS.some((field) => text(field.key) !== storedText(settings.data, field.key)) ||
    FLAG_KEYS.some((key) => text(key) !== storedText(settings.data, key)) ||
    levels.join(',') !== stored.join(',')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!dirty) return
    // Spelled out rather than folded over `FIELDS`: a PUT is the whole of the settings,
    // and this is the one place that has to name every one of them.
    const body: AppSettingsUpdate = {
      // The list is what is sent; the older single-level field goes as null, which the
      // backend reads as "the list said it" rather than as a level being cleared.
      maia_elos: levels,
      maia_target_elo: null,
      // The switch's visible position rather than the row behind it: a PUT is the whole of
      // the settings, and leaving these out is what silently put all three back to their
      // defaults every time anything else on this page was saved.
      maia_on_quick: flag('maia_on_quick') ? 1 : 0,
      maia_on_deep: flag('maia_on_deep') ? 1 : 0,
      maia_both_sides: flag('maia_both_sides') ? 1 : 0,
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
                  The ratings Maia is asked at everywhere — the batch pass over every game,
                  and the analysis board&rsquo;s live column. One is the rating you are
                  playing towards; a second and a third are what make a move&rsquo;s
                  popularity a curve rather than a number. Up to {MAX_MAIA_ELOS}, and never
                  none: cleared, they go back to {DEFAULTS.maia_target_elo}. Under them,
                  which passes pay for that column at all.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <MaiaLevels
                  elos={levels}
                  ownerRating={
                    parse(text('default_owner_rating')) ?? DEFAULTS.default_owner_rating
                  }
                  onChange={setElos}
                />

                <div className="flex flex-col gap-3 border-t border-hairline pt-3">
                  {FLAGS.map((each) => (
                    <FlagRow
                      key={each.key}
                      flag={each}
                      checked={flag(each.key)}
                      onChange={(next) => setDraft({ ...draft, [each.key]: next ? '1' : '0' })}
                    />
                  ))}
                </div>

                {/* The fill used to be a button here. It is a library operation — thousands
                    of runs over games that are already analysed — not a setting, so it
                    lives with the other library-wide passes and this is the signpost. */}
                <p className="border-t border-hairline pt-3 text-[0.625rem] leading-[1.5] text-dim-2">
                  Adding a level to games that already have a pass is a{' '}
                  <Link to="/analysis" className="text-accent-teal hover:text-accent-link">
                    fill on the Analysis page
                  </Link>
                  , with the rest of the library-wide work.
                </p>
              </CardContent>
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

      <BoardPreviewCard />

      <DangerZone />
    </PageBody>
  )
}

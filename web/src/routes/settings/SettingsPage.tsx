import { Loader2, RotateCcw, Save } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppSettings, useSaveAppSettings } from '@/lib/api/queries'

/** What Maia was trained on. Anything outside is clamped by the backend, not refused. */
export const MIN_TARGET_ELO = 1100
export const MAX_TARGET_ELO = 2000

/**
 * Settings. One card so far, and it is the one number that changes what every Maia answer
 * in the app means.
 *
 * The field is a draft over the stored value rather than a copy of it: `draft === null`
 * means "showing what the server said", which is what makes a save or a clear land in the
 * box without an effect chasing the query. The backend clamps rather than refuses, so the
 * answer to a save is what is actually in force — and dropping the draft on success is how
 * that answer, not the typing, is what stays on screen.
 */
export function SettingsPage() {
  const settings = useAppSettings()
  const save = useSaveAppSettings({ onSuccess: () => setDraft(null) })
  const [draft, setDraft] = useState<string | null>(null)

  const stored = settings.data?.maia_target_elo ?? null
  const storedText = stored === null ? '' : String(stored)
  const value = draft ?? storedText
  const dirty = value !== storedText

  const parsed = Number.parseInt(value.trim(), 10)
  const empty = value.trim() === ''
  const valid = !empty && Number.isFinite(parsed)
  const outOfRange = valid && (parsed < MIN_TARGET_ELO || parsed > MAX_TARGET_ELO)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!dirty) return
    // An emptied box is the same request as the clear button: there is one way to be unset.
    save.mutate({ maia_target_elo: valid ? parsed : null })
  }

  return (
    <PageBody>
      <SetPageChrome breadcrumb={[{ label: 'Settings', to: '/settings' }, { label: 'General' }]} />
      <PageHeader
        title="Settings"
        description="How this deployment is set up, beyond the engines it runs."
      />

      {/*
        `noValidate` on purpose: `min`/`max` below bound the spinner and tell a screen
        reader the range, but the *rule* is the backend's clamp, and there is one of it.
        Left to validate, the browser would refuse to submit 2400 with a bubble of its own
        wording, where the deployment's answer is simply 2000.
      */}
      <form
        noValidate
        onSubmit={submit}
        className="flex max-w-2xl flex-col gap-3 rounded-xl border border-line bg-panel px-3.5 py-3.5"
      >
        <div className="flex flex-col gap-[0.1875rem]">
          <span className="text-xs font-semibold text-ink">Maia target elo</span>
          <p className="text-[0.71875rem] leading-[1.55] text-dim">
            The one rating Maia is asked at everywhere — the batch pass over both sides of
            every game, and the analysis board&rsquo;s live column. Set it to the rating you
            are playing towards, not the one you have.
          </p>
        </div>

        {settings.isPending ? (
          <Skeleton className="h-8 w-40" data-testid="settings-loading" />
        ) : settings.isError ? (
          <div className="rounded-md border border-blunder/28 bg-blunder/5 px-3 py-2.5">
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
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="maia-target-elo">Target elo</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="maia-target-elo"
                  type="number"
                  inputMode="numeric"
                  min={MIN_TARGET_ELO}
                  max={MAX_TARGET_ELO}
                  step={50}
                  value={value}
                  placeholder="not set"
                  autoComplete="off"
                  className="w-32 font-mono tabular"
                  onChange={(event) => setDraft(event.target.value)}
                />
                <span className="font-mono text-[0.65625rem] text-dim-2 tabular">
                  {MIN_TARGET_ELO}–{MAX_TARGET_ELO}
                </span>
              </div>
            </div>

            <p className="text-[0.6875rem] leading-[1.5] text-dim-2">
              {stored === null
                ? 'Not set: Maia is asked about your own moves, at levels around the rating each game was played at.'
                : `In force at ${stored}. Games already analysed keep the level they were analysed at until a fresh Maia pass runs over them.`}
            </p>

            {outOfRange ? (
              <p className="text-[0.6875rem] text-dim">
                That is outside what Maia was trained on; it will be saved as{' '}
                {Math.min(MAX_TARGET_ELO, Math.max(MIN_TARGET_ELO, parsed))}.
              </p>
            ) : null}

            {save.isError ? (
              <p className="text-[0.6875rem] text-blunder">{save.error.message}</p>
            ) : null}

            <div className="flex items-center gap-2">
              <div className="flex-1" />
              {stored === null ? null : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={save.isPending}
                  onClick={() => save.mutate({ maia_target_elo: null })}
                >
                  <RotateCcw aria-hidden />
                  Clear
                </Button>
              )}
              <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
                {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
                Save
              </Button>
            </div>
          </>
        )}
      </form>
    </PageBody>
  )
}

/**
 * One connected account, as a box in the Accounts grid.
 *
 * Everything that is true of the account all the time is one line — who it is, how many
 * games came from it, when it last ran — and the username stays an editable field because
 * "connect" and "sync" are the same button pressed twice: the adapters take a name and
 * keep their own cursor.
 *
 * The box's name is its heading (the source's dot and its name), not a tinted chip: a chip
 * in the corner read as a tag on the box rather than as what the box is. The count beside
 * it is a readout. Its Sync / Connect is a secondary face, not a fill: the Accounts region's
 * one primary is Sync all at its head, and three filled buttons in a row had said nothing
 * about which one the region exists for.
 *
 * Nothing else is per-source. What a run is told — how far back, how many, whether to
 * queue an evaluation pass — belongs to the head above the grid; a box owns only its name
 * and its button. The one thing it grows is the sync in flight, in the box that is doing
 * it rather than in a block appended under the grid — and, on Lichess alone, the sign-in
 * line (`LichessLive`), because Lichess is the one source that can tell us a game ended.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { SourceBadge } from '@/components/badges/SourceBadge'
import { Readout } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSyncSchedule, useUpdateSyncSchedule, useStartImport } from '@/lib/api/queries'
import type { AccountSummary, ImportJob, Source } from '@/lib/api/types'
import { relative } from '@/lib/mcp/status'
import { cn } from '@/lib/utils'

import { SyncCheckbox } from './SyncCheckbox'
import { JobProgress, progressChrome } from './JobProgress'
import { LichessLive } from './LichessLive'
import type { SyncOptions } from './SourcesPanel'
import { syncBody, usernameOf } from './syncRequest'
import type { SourceProgress } from './useImportProgress'

const COPY: Record<
  'lichess' | 'chesscom' | 'fics',
  { title: string; hint: MessageDescriptor; placeholder: MessageDescriptor }
> = {
  lichess: {
    title: 'Lichess',
    hint: msg`Walks the NDJSON archive from the last cursor. The first sync of a long account takes minutes.`,
    placeholder: msg`lichess username`,
  },
  chesscom: {
    title: 'Chess.com',
    hint: msg`Reads the monthly archives from the last cursor, newest month last.`,
    placeholder: msg`chess.com username`,
  },
  fics: {
    title: 'FICS',
    hint: msg`Reads yearly player archives from the FICS Games Database and resumes at the last date.`,
    placeholder: msg`FICS username`,
  },
}

export function AccountCard({
  source,
  account,
  lastJob,
  progress,
  options,
}: {
  source: 'lichess' | 'chesscom' | 'fics'
  account?: AccountSummary
  lastJob?: ImportJob
  progress?: SourceProgress
  /** What the strip above the grid says this run should be told. */
  options: SyncOptions
}) {
  const { t, i18n } = useLingui()
  const copy = COPY[source]
  const suggested = account?.username ?? usernameOf(lastJob) ?? ''
  const [username, setUsername] = useState(suggested)
  const [invalid, setInvalid] = useState<string | null>(null)
  // The suggestion arrives with the profile, a render or two after the field exists, so
  // it fills an untouched field and never overwrites what is being typed.
  const edited = useRef(false)
  useEffect(() => {
    if (!edited.current && suggested) setUsername(suggested)
  }, [suggested])

  const schedule = useSyncSchedule()
  const updateSchedule = useUpdateSyncSchedule()
  const start = useStartImport()
  const running = progress?.running === true || start.isPending
  const when = lastJob ? relative(lastJob.finished_at ?? lastJob.created_at) : null

  function submit() {
    const name = username.trim()
    if (!name) {
      const platform = copy.title
      setInvalid(t`a ${platform} sync needs the username whose games to read`)
      return
    }
    setInvalid(null)
    start.mutate({ source: source as Source, body: syncBody(name, options) })
  }

  return (
    <div
      data-source={source}
      className={cn(
        'flex flex-col gap-2 rounded-lg border bg-elevated-2 p-3',
        progressChrome(progress),
      )}
    >
      <div className="flex items-center gap-2">
        {/* The heading is the name; a word beside it saying the same thing is noise. */}
        <h3 className="flex">
          <SourceBadge
            source={source}
            variant="plain"
            title={i18n._(copy.hint)}
            className="gap-2 text-data font-medium text-ink"
          />
        </h3>
        <div className="flex-1" />
        {/* An account nobody has connected has no count to give, and a bare em dash in a
            box says less than the reason there is no number. */}
        {account ? (
          <Readout num className="text-label text-body">
            {account.games?.toLocaleString() ?? '—'}
            <span className="ml-1 font-sans text-dim">
              <Trans>games</Trans>
            </span>
          </Readout>
        ) : (
          <Readout className="text-faint">
            <Trans>not connected</Trans>
          </Readout>
        )}
      </div>

      <SyncCheckbox
        label={t`Include in sync`}
        title={t`Include this source in automatic sync and Sync all. You can still sync it manually.`}
        checked={!schedule.data?.disabled_sources?.includes(source)}
        disabled={!schedule.data || updateSchedule.isPending}
        onChange={(enabled) => updateSchedule.mutate({
          minutes: schedule.data?.minutes ?? null,
          disabled_sources: enabled
            ? (schedule.data?.disabled_sources ?? []).filter((value) => value !== source)
            : [...(schedule.data?.disabled_sources ?? []), source],
        })}
      />
      {schedule.isError || updateSchedule.isError ? <p role="alert" className="text-data text-blunder">{schedule.error?.message ?? updateSchedule.error?.message}</p> : null}
      <Label htmlFor={`${source}-username`} className="sr-only">
        <Trans>Username</Trans>
      </Label>
      <Input
        id={`${source}-username`}
        value={username}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid !== null}
        placeholder={i18n._(copy.placeholder)}
        className="h-7 w-full"
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          if (!running) submit()
        }}
        onChange={(event) => {
          edited.current = true
          setUsername(event.target.value)
          if (invalid) setInvalid(null)
        }}
      />
      {invalid ? <p className="text-label text-blunder">{invalid}</p> : null}
      {start.isError ? (
        <p className="text-label text-blunder">{start.error.message}</p>
      ) : null}

      <div className="flex items-center gap-2">
        <span className="font-mono text-label text-dim tabular">
          {when === null ? t`never synced` : t`synced ${when}`}
        </span>
        <div className="flex-1" />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={running}
          title={running ? t`This account is syncing` : undefined}
          onClick={submit}
        >
          {running ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
          {progress?.running ? t`Syncing` : account ? t`Sync` : t`Connect`}
        </Button>
      </div>

      {progress ? <JobProgress progress={progress} /> : null}

      {source === 'lichess' ? <LichessLive /> : null}
    </div>
  )
}

import { Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { SourceBadge } from '@/components/badges/SourceBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AccountSummary, ImportJob, Source } from '@/lib/api/types'
import { useStartImport } from '@/lib/api/queries'
import { relative } from '@/lib/mcp/status'
import { cn } from '@/lib/utils'

import { JobProgress } from './JobProgress'
import type { SourceProgress } from './useImportProgress'

/**
 * The username a previous sync used, if that sync got far enough to record one.
 *
 * `ImportJob.message` carries the username the adapter was given (`adapters/lichess.py`,
 * `adapters/chesscom.py`) — but a failed job overwrites it with the exception text
 * (`services/import_service.py`), so a failed sync must never seed the field or the next
 * Connect would post `AdapterError: …` as the username and fail again.
 */
function usernameOf(job: ImportJob | undefined): string | undefined {
  if (!job || job.status === 'failed') return undefined
  return job.message?.trim() || undefined
}

const COPY: Record<'lichess' | 'chesscom', { title: string; hint: string; placeholder: string }> = {
  lichess: {
    title: 'Lichess',
    hint: 'Walks the NDJSON archive from the last cursor. The first sync of a long account takes minutes.',
    placeholder: 'lichess username',
  },
  chesscom: {
    title: 'Chess.com',
    hint: 'Reads the monthly archives from the last cursor, newest month last.',
    placeholder: 'chess.com username',
  },
}

/**
 * One account, connected by name: the adapters take a username and keep their own cursor,
 * so "connect" and "sync" are the same button pressed twice.
 */
export function ConnectAccount({
  source,
  account,
  lastJob,
  progress,
}: {
  source: 'lichess' | 'chesscom'
  account?: AccountSummary
  lastJob?: ImportJob
  progress?: SourceProgress
}) {
  const copy = COPY[source]
  const suggested = account?.username ?? usernameOf(lastJob) ?? ''
  const [username, setUsername] = useState(suggested)
  const [since, setSince] = useState('')
  const [maxGames, setMaxGames] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [invalid, setInvalid] = useState<string | null>(null)
  // The suggestion arrives with the profile, a render or two after the field exists, so
  // it fills an untouched field and never overwrites what is being typed.
  const edited = useRef(false)
  useEffect(() => {
    if (!edited.current && suggested) setUsername(suggested)
  }, [suggested])

  const start = useStartImport()
  const running = progress?.running === true || start.isPending

  function submit(event: FormEvent) {
    event.preventDefault()
    const name = username.trim()
    if (!name) {
      setInvalid(`a ${copy.title} sync needs the username whose games to read`)
      return
    }
    setInvalid(null)
    const games = Number.parseInt(maxGames, 10)
    start.mutate({
      source: source as Source,
      body: {
        username: name,
        since: since.trim() || undefined,
        max_games: Number.isFinite(games) && games > 0 ? games : undefined,
      },
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-2.5 border-b border-hairline px-3.5 py-3">
        <SourceBadge source={source} size="sm" />
        <span className="text-xs font-semibold text-ink">{copy.title}</span>
        <div className="flex-1" />
        <span className="font-mono text-[0.625rem] text-dim">
          {account
            ? `${account.games?.toLocaleString() ?? 0} games`
            : lastJob
              ? relative(lastJob.finished_at ?? lastJob.created_at)
              : 'not connected'}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-3.5 py-3.5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${source}-username`}>Username</Label>
          <Input
            id={`${source}-username`}
            value={username}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={invalid !== null}
            placeholder={copy.placeholder}
            onChange={(event) => {
              edited.current = true
              setUsername(event.target.value)
              if (invalid) setInvalid(null)
            }}
          />
        </div>

        <p className="text-[0.6875rem] leading-[1.5] text-dim">{copy.hint}</p>

        {advanced ? (
          <div className="grid grid-cols-2 gap-2.5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${source}-since`}>Since</Label>
              <Input
                id={`${source}-since`}
                value={since}
                spellCheck={false}
                placeholder="2024-01-01 · all"
                className="font-mono"
                onChange={(event) => setSince(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${source}-max`}>Max games</Label>
              <Input
                id={`${source}-max`}
                value={maxGames}
                inputMode="numeric"
                placeholder="all"
                className="font-mono"
                onChange={(event) => setMaxGames(event.target.value)}
              />
            </div>
          </div>
        ) : null}

        {invalid ? <p className="text-[0.6875rem] text-blunder">{invalid}</p> : null}
        {start.isError ? (
          <p className="text-[0.6875rem] text-blunder">{start.error.message}</p>
        ) : null}

        <div className="flex-1" />

        {progress ? <JobProgress progress={progress} /> : null}
      </div>

      <div className="flex items-center gap-2 border-t border-hairline px-3.5 py-2.5">
        <button
          type="button"
          onClick={() => setAdvanced((open) => !open)}
          className={cn(
            'text-[0.6875rem] transition-colors',
            advanced ? 'text-soft hover:text-ink' : 'text-dim hover:text-ink',
          )}
        >
          {advanced ? 'Hide options' : 'Options'}
        </button>
        <div className="flex-1" />
        <Button type="submit" size="sm" disabled={running}>
          {running ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <RefreshCw aria-hidden />
          )}
          {progress?.running ? 'Syncing' : account ? 'Sync' : 'Connect'}
        </Button>
      </div>
    </form>
  )
}

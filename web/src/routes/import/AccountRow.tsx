/**
 * One connected account, as a row of the sources table.
 *
 * It was a card the height of a dashboard tile for a screen that is visited to press Sync
 * and leave. Everything that is true of the account all the time — who it is, how many
 * games came from it, when it last ran — is now a cell, and the username stays an editable
 * box in its own column because "connect" and "sync" are the same button pressed twice:
 * the adapters take a name and keep their own cursor.
 *
 * Nothing else is per-row. What a run is told — how far back, how many, whether to queue
 * an evaluation pass — is the table's, above; a row owns only its name and its button. The
 * one thing it grows is the progress of a sync in flight, under the row it is about.
 */
import { Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { SourceBadge } from '@/components/badges/SourceBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TableCell, TableRow } from '@/components/ui/table'
import { useStartImport } from '@/lib/api/queries'
import type { AccountSummary, ImportJob, Source } from '@/lib/api/types'
import { relative } from '@/lib/mcp/status'

import { JobProgress } from './JobProgress'
import type { SyncOptions } from './SourcesTable'
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

export function AccountRow({
  source,
  account,
  lastJob,
  progress,
  options,
}: {
  source: 'lichess' | 'chesscom'
  account?: AccountSummary
  lastJob?: ImportJob
  progress?: SourceProgress
  /** What the table's own controls say this run should be told. */
  options: SyncOptions
}) {
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

  const start = useStartImport()
  const running = progress?.running === true || start.isPending

  function submit() {
    const name = username.trim()
    if (!name) {
      setInvalid(`a ${copy.title} sync needs the username whose games to read`)
      return
    }
    setInvalid(null)
    const games = Number.parseInt(options.maxGames, 10)
    start.mutate({
      source: source as Source,
      body: {
        username: name,
        since: options.since.trim() || undefined,
        max_games: Number.isFinite(games) && games > 0 ? games : undefined,
        // Only ever sent to turn evaluation off; left out, the backend queues the pass.
        analyze: options.skipEvaluation ? false : undefined,
      },
    })
  }

  return (
    <>
      <TableRow data-state={progress ? 'selected' : undefined}>
        <TableCell>
          {/* The badge is the name; a word beside it saying the same thing is noise. */}
          <SourceBadge source={source} title={copy.hint} />
        </TableCell>

        <TableCell>
          <Label htmlFor={`${source}-username`} className="sr-only">
            Username
          </Label>
          <Input
            id={`${source}-username`}
            value={username}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={invalid !== null}
            placeholder={copy.placeholder}
            className="h-7 w-full max-w-md"
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
          {invalid ? <p className="mt-1 text-[0.6875rem] text-blunder">{invalid}</p> : null}
          {start.isError ? (
            <p className="mt-1 text-[0.6875rem] text-blunder">{start.error.message}</p>
          ) : null}
        </TableCell>

        {/* Hidden below `md` with their headers — see `SourcesTable`. */}
        <TableCell className="text-right font-mono text-[0.71875rem] text-body tabular max-md:hidden">
          {account?.games?.toLocaleString() ?? <span className="text-faint">—</span>}
        </TableCell>

        <TableCell className="font-mono text-[0.71875rem] text-dim tabular max-md:hidden">
          {lastJob ? relative(lastJob.finished_at ?? lastJob.created_at) : '—'}
        </TableCell>

        <TableCell className="text-right">
          <Button type="button" size="sm" disabled={running} onClick={submit}>
            {running ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <RefreshCw aria-hidden />
            )}
            {progress?.running ? 'Syncing' : account ? 'Sync' : 'Connect'}
          </Button>
        </TableCell>
      </TableRow>

      {progress ? (
        <tr className="border-b border-hairline bg-surface-2">
          <td colSpan={5} className="px-2.5 py-3">
            <JobProgress progress={progress} />
          </td>
        </tr>
      ) : null}
    </>
  )
}

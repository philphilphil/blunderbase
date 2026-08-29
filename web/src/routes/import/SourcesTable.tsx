/**
 * Where games come from: three rows, one per source.
 *
 * This was three cards the height of dashboard tiles, and a dashboard is what they were
 * borrowed from — a shape for a screen you read, not one you press Sync on and leave. The
 * facts are one line each and line up down the page (who, how many, when, the button).
 * Same table as the sync history below it, which is the point: the two read as one screen
 * about imports.
 *
 * What a run is told lives once, in the strip above the table, because none of it was ever
 * a per-source answer: how far back to reach, how many games to stop at, and whether to
 * queue an evaluation pass behind the import. Three copies of that meant three places to
 * remember to tick before pressing a second Sync. A PGN takes none of them but the last,
 * and ignores the rest.
 */
import { useState } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { AccountSummary, ImportJob } from '@/lib/api/types'

import { AccountRow } from './AccountRow'
import { PgnRow } from './PgnRow'
import { SkipEvaluation } from './SkipEvaluation'
import type { ImportProgressState } from './useImportProgress'

/** What the strip above the table says the next import should be told. */
export interface SyncOptions {
  since: string
  maxGames: string
  skipEvaluation: boolean
}

export function SourcesTable({
  accounts,
  latestOf,
  progress,
}: {
  accounts: AccountSummary[]
  /** The newest job per source, which is what a row's "last sync" and username come from. */
  latestOf: (source: 'lichess' | 'chesscom' | 'pgn') => ImportJob | undefined
  progress: ImportProgressState
}) {
  const [since, setSince] = useState('')
  const [maxGames, setMaxGames] = useState('')
  const [skipEvaluation, setSkipEvaluation] = useState(false)
  const running = Object.values(progress).some((source) => source?.running)
  const options: SyncOptions = { since, maxGames, skipEvaluation }

  return (
    <section className="flex flex-col rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3 border-b border-hairline px-3.5 py-3">
        <span className="self-center text-xs font-semibold text-ink">Sources</span>
        <div className="flex-1" />
        <div className="flex w-40 flex-col gap-1.5">
          <Label htmlFor="sync-since">Since</Label>
          {/*
            A native date input: it already yields the `YYYY-MM-DD` the adapters take, and
            it is one keystroke or one click either way. Empty means every game there is.
          */}
          <Input
            id="sync-since"
            type="date"
            value={since}
            className="h-7 font-mono"
            onChange={(event) => setSince(event.target.value)}
          />
        </div>
        <div className="flex w-28 flex-col gap-1.5">
          <Label htmlFor="sync-max">Max games</Label>
          <Input
            id="sync-max"
            value={maxGames}
            inputMode="numeric"
            placeholder="all"
            className="h-7 font-mono"
            onChange={(event) => setMaxGames(event.target.value)}
          />
        </div>
        <SkipEvaluation
          checked={skipEvaluation}
          onChange={setSkipEvaluation}
          disabled={running}
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-28">Source</TableHead>
            <TableHead>Account</TableHead>
            <TableHead className="w-24 text-right">Games</TableHead>
            <TableHead className="w-28">Last sync</TableHead>
            <TableHead className="w-28" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <AccountRow
            source="lichess"
            account={accounts.find((account) => account.platform === 'lichess')}
            lastJob={latestOf('lichess')}
            progress={progress.lichess}
            options={options}
          />
          <AccountRow
            source="chesscom"
            account={accounts.find((account) => account.platform === 'chesscom')}
            lastJob={latestOf('chesscom')}
            progress={progress.chesscom}
            options={options}
          />
          <PgnRow
            lastJob={latestOf('pgn')}
            progress={progress.pgn}
            skipEvaluation={skipEvaluation}
          />
        </TableBody>
      </Table>
    </section>
  )
}

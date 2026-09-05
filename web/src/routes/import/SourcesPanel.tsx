/**
 * Where games come from: one box per source.
 *
 * It was a five-column table across the page, and a table is a promise about its content
 * that four sources do not keep — a username, a count and a date left most of every row
 * empty, and the sync in flight had nowhere to go but a block appended underneath, which
 * read as a second thing happening rather than as this source working. A box is the size
 * of what it holds: the account, its count, its button, and its own progress, in the box
 * that is doing it.
 *
 * Four across where there is room, two on a laptop, one on a phone. The column count is
 * chosen to keep a box about the same width at every size rather than to fill the page
 * with two very wide ones — the width a box wants is the width of a username field and a
 * button beside it.
 *
 * What a run is told lives once, in the strip above the grid, because none of it was ever
 * a per-source answer: how far back to reach, how many games to stop at, and whether to
 * queue an evaluation pass behind the import. Four copies of that would mean four places
 * to remember to tick before pressing a second Sync. A PGN takes none of them but the
 * last, and ignores the rest.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { useState } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AccountSummary, ImportJob } from '@/lib/api/types'

import { AccountCard } from './AccountCard'
import { AutoSyncControl } from './AutoSyncControl'
import { PgnCard } from './PgnCard'
import { SyncCheckbox } from './SyncCheckbox'
import type { ImportProgressState } from './useImportProgress'

/** What the strip above the grid says the next import should be told. */
export interface SyncOptions {
  since: string
  maxGames: string
  skipEvaluation: boolean
  /** Ignore the stored cursor and read the account's archive from its first game. */
  fromTheBeginning: boolean
}

export function SourcesPanel({
  accounts,
  latestOf,
  progress,
}: {
  accounts: AccountSummary[]
  /** The newest job per account source, which is what a box's stamp and username read. */
  latestOf: (source: 'lichess' | 'chesscom' | 'fics') => ImportJob | undefined
  progress: ImportProgressState
}) {
  const { t } = useLingui()
  const [since, setSince] = useState('')
  const [maxGames, setMaxGames] = useState('')
  const [skipEvaluation, setSkipEvaluation] = useState(false)
  const [fromTheBeginning, setFromTheBeginning] = useState(false)
  const running = Object.values(progress).some((source) => source?.running)
  const options: SyncOptions = { since, maxGames, skipEvaluation, fromTheBeginning }

  return (
    <section data-tour="sources" className="flex flex-col rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3 border-b border-hairline px-3.5 py-3">
        <span className="self-center text-xs font-semibold text-ink">
          <Trans>Sources</Trans>
        </span>
        <div className="flex-1" />
        <div className="flex w-40 flex-col gap-1.5">
          <Label htmlFor="sync-since">
            <Trans>Since</Trans>
          </Label>
          {/*
            A native date input: it already yields the `YYYY-MM-DD` the adapters take, and
            it is one keystroke or one click either way. Empty is not "everything" — it is
            "wherever the last sync of this account got to", which is what the box beside
            it overrides.
          */}
          <Input
            id="sync-since"
            type="date"
            value={since}
            disabled={fromTheBeginning}
            className="h-7 font-mono"
            onChange={(event) => setSince(event.target.value)}
          />
        </div>
        <div className="flex w-28 flex-col gap-1.5">
          <Label htmlFor="sync-max">
            <Trans>Max games</Trans>
          </Label>
          <Input
            id="sync-max"
            value={maxGames}
            inputMode="numeric"
            placeholder={t`all`}
            className="h-7 font-mono"
            onChange={(event) => setMaxGames(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5 self-center pt-4">
          {/* The two are one idea apart: where a sync starts, and what it does with what it
              finds. A date and "from the beginning" are two answers to the first question,
              so choosing this one takes the date out of the argument. */}
          <SyncCheckbox
            label={t`From the beginning`}
            title={t`Ignore the stored cursor and read the whole archive. Games already in the library are skipped, and games you deleted stay deleted.`}
            checked={fromTheBeginning}
            onChange={setFromTheBeginning}
            disabled={running}
          />
          <SyncCheckbox
            label={t`Skip evaluation`}
            title={t`Store the games and stop there — no quick pass is queued. Worth it on a first sync of a long archive; the library can queue the passes a few at a time afterwards.`}
            checked={skipEvaluation}
            onChange={setSkipEvaluation}
            disabled={running}
          />
        </div>
      </div>

      {/* `items-start` so a box that grows a progress block while it syncs takes the room
          it needs instead of stretching the three beside it to match. */}
      <div className="grid items-start gap-2.5 p-3.5 md:grid-cols-2 xl:grid-cols-4">
        <AccountCard
          source="lichess"
          account={accounts.find((account) => account.platform === 'lichess')}
          lastJob={latestOf('lichess')}
          progress={progress.lichess}
          options={options}
        />
        <AccountCard
          source="chesscom"
          account={accounts.find((account) => account.platform === 'chesscom')}
          lastJob={latestOf('chesscom')}
          progress={progress.chesscom}
          options={options}
        />
        <AccountCard
          source="fics"
          account={accounts.find((account) => account.platform === 'fics')}
          lastJob={latestOf('fics')}
          progress={progress.fics}
          options={options}
        />
        <PgnCard progress={progress.pgn} skipEvaluation={skipEvaluation} />
      </div>

      {/* The same boxes, pressed for you on a clock — a footer, because it is about every
          press from now on rather than the next one the strip above describes. */}
      <AutoSyncControl />
    </section>
  )
}

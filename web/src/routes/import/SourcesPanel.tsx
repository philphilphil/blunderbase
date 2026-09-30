/**
 * Accounts: where synced games come from, one box per account.
 *
 * It was a five-column table across the page, and a table is a promise about its content
 * that three accounts do not keep — a username, a count and a date left most of every row
 * empty, and the sync in flight had nowhere to go but a block appended underneath, which
 * read as a second thing happening rather than as this source working. A box is the size
 * of what it holds: the account, its count, its button, and its own progress, in the box
 * that is doing it.
 *
 * Three across where there is room, two on a laptop, one on a phone. The column count is
 * chosen to keep a box about the same width at every size rather than to fill the page
 * with two very wide ones — the width a box wants is the width of a username field and a
 * button beside it.
 *
 * What a run is told lives once, in the head above the grid, because none of it was ever
 * a per-account answer: how far back to reach, how many games to stop at, and whether to
 * queue an evaluation pass behind the import. Three copies of that would mean three places
 * to remember to tick before pressing a second Sync. The head ends in the region's one
 * primary, Sync all, last in its row (the control grammar: one filled button per region);
 * each box keeps its own Sync as a secondary face.
 *
 * A PGN file is not an account and takes none of the head's options, so it is a region of
 * its own under this one (`PgnCard`). As a fourth box under this head nothing said whether
 * Since or Max games applied to a file.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useStartImport, useSyncSchedule } from '@/lib/api/queries'
import type { AccountSummary, ImportJob } from '@/lib/api/types'

import { AccountCard } from './AccountCard'
import { accountFor } from './accountFor'
import { AutoSyncControl } from './AutoSyncControl'
import { SyncCheckbox } from './SyncCheckbox'
import { syncBody, usernameOf } from './syncRequest'
import type { ImportProgressState } from './useImportProgress'

const ACCOUNTS = ['lichess', 'chesscom', 'fics'] as const
type AccountSource = (typeof ACCOUNTS)[number]

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
  const accountOf = (source: AccountSource) => accountFor(accounts, source, latestOf(source))

  return (
    <section
      data-tour="sources"
      aria-labelledby="accounts-title"
      className="flex flex-col rounded-xl border border-line bg-panel"
    >
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3 border-b border-hairline px-3.5 py-3">
        <h2 id="accounts-title" className="self-center text-data font-semibold text-ink">
          <Trans>Accounts</Trans>
        </h2>
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
            inputSize="sm"
            className="font-mono"
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
            inputSize="sm"
            className="font-mono"
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
            title={t`Store the games and stop there — no analysis pass is queued. Worth it on a first sync of a long archive; Backfill on the Analysis page queues the passes afterwards.`}
            checked={skipEvaluation}
            onChange={setSkipEvaluation}
            disabled={running}
          />
        </div>
        <SyncAll
          targets={ACCOUNTS.flatMap((source) => {
            const username = accountOf(source)?.username ?? usernameOf(latestOf(source))
            return username ? [{ source, username }] : []
          })}
          options={options}
          progress={progress}
        />
      </div>

      {/* `items-start` so a box that grows a progress block while it syncs takes the room
          it needs instead of stretching the ones beside it to match. */}
      <div className="grid items-start gap-2.5 p-3.5 md:grid-cols-2 xl:grid-cols-3">
        {ACCOUNTS.map((source) => (
          <AccountCard
            key={source}
            source={source}
            account={accountOf(source)}
            lastJob={latestOf(source)}
            progress={progress[source]}
            options={options}
          />
        ))}
      </div>

      {/* The same boxes, pressed for you on a clock — a footer, because it is about every
          press from now on rather than the next one the head above describes. */}
      <AutoSyncControl />
    </section>
  )
}

const PLATFORM: Record<AccountSource, string> = {
  lichess: 'Lichess',
  chesscom: 'Chess.com',
  fics: 'FICS',
}

/**
 * Sync all: every connected account that is included in sync, told what the head says.
 *
 * The same press as each box's Sync, once per account, so the head's Since / Max games /
 * options reach every one of them. It syncs the account each box shows (the name its
 * newest good sync used), not a name being typed into a box: connecting a new name is
 * that box's own Connect. Disabled, it says why in its title: nothing connected, every
 * account left out, or a sync already running.
 */
function SyncAll({
  targets,
  options,
  progress,
}: {
  targets: { source: AccountSource; username: string }[]
  options: SyncOptions
  progress: ImportProgressState
}) {
  const { t } = useLingui()
  const schedule = useSyncSchedule()
  const start = useStartImport()
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const included = targets.filter(
    (target) => !schedule.data?.disabled_sources?.includes(target.source),
  )
  // `/events` is the only thing that knows a sync is still walking the archive: the POST
  // has long since answered with a job id by then.
  const syncing = pending || included.some((target) => progress[target.source]?.running)

  async function syncAll() {
    setPending(true)
    setFailure(null)
    const results = await Promise.allSettled(
      included.map((target) =>
        start.mutateAsync({ source: target.source, body: syncBody(target.username, options) }),
      ),
    )
    const rejected = results.find((result) => result.status === 'rejected')
    setFailure(
      rejected
        ? ((rejected.reason as Error | undefined)?.message ?? t`the sync did not start`)
        : null,
    )
    setPending(false)
  }

  const why =
    targets.length === 0
      ? t`Connect an account first`
      : included.length === 0
        ? t`Every account is left out of sync`
        : syncing
          ? t`A sync is running`
          : included.map((target) => `${PLATFORM[target.source]}: ${target.username}`).join(' · ')

  return (
    <div className="flex items-center gap-2">
      {failure ? (
        <span role="alert" className="max-w-[24ch] truncate text-label text-blunder" title={failure}>
          {failure}
        </span>
      ) : null}
      <Button
        type="button"
        size="sm"
        disabled={!schedule.data || syncing || included.length === 0}
        aria-busy={syncing}
        title={why}
        onClick={() => void syncAll()}
      >
        {syncing ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
        {syncing ? t`Syncing` : t`Sync all`}
      </Button>
    </div>
  )
}

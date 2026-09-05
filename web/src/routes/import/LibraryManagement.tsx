import { plural } from '@lingui/core/macro'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { Download, HardDriveDownload, Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { saveDownload, saveUrlDownload } from '@/lib/api/client'
import { preparedBackupUrl } from '@/lib/api/endpoints'
import { useBackupEstimate, useExportLibrary, useGames, usePrepareBackup } from '@/lib/api/queries'
import type { GamesDeleted } from '@/lib/api/types'
import { useLocale } from '@/lib/i18n/I18nProvider'
import { manualUrl } from '@/lib/manual'

import { DeleteAllGamesDialog } from './DeleteAllGamesDialog'
import { DeletedGamesCard } from './DeletedGamesCard'

function fileSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} kB`
  return `${bytes} B`
}

/**
 * The database-wide actions, separated by what their files mean and by consequence. PGN is
 * the portable chess document; SQLite is the technical, lossless recovery copy; reset is
 * destructive and gets the only danger treatment. Keeping them in separate cards prevents
 * "backup" and "export" from reading like two spellings of the same promise.
 *
 * The deletion record sits under them and only appears once something has been deleted —
 * it is the undo for a delete made on the games page, and belongs with the other things
 * that are true of the whole library rather than of one screen.
 */
export function LibraryManagement() {
  const { t } = useLingui()
  const { locale } = useLocale()
  const games = useGames({ limit: 1 })
  const [asking, setAsking] = useState(false)
  const [deleted, setDeleted] = useState<GamesDeleted | null>(null)
  const exporting = useExportLibrary({ onSuccess: (download) => saveDownload(download) })
  const backupEstimate = useBackupEstimate()
  const backingUp = usePrepareBackup({
    onSuccess: (prepared) => {
      saveUrlDownload(preparedBackupUrl(prepared.token), prepared.filename)
    },
  })
  const total = games.data?.total

  const size = backupEstimate.data ? fileSize(backupEstimate.data.estimated_bytes) : null
  const estimate =
    size !== null
      ? t`Estimated backup size: about ${size}.`
      : backupEstimate.isError
        ? t`Backup size estimate unavailable.`
        : t`Estimating backup size…`

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3.5">
        <Download className="size-4 text-faint" aria-hidden />
        <div className="min-w-56 flex-1">
          <h2 className="text-xs font-semibold text-ink">
            <Trans>Portable PGN export</Trans>
          </h2>
          <p className="mt-1 text-[0.6875rem] leading-[1.5] text-dim">
            <Trans>
              Every game, note and saved line for another chess application. Engine analysis
              and settings are not part of PGN.
            </Trans>
          </p>
          {exporting.isError ? (
            <p role="alert" className="mt-1 text-[0.6875rem] text-blunder">
              {exporting.error.message}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={exporting.isPending}
          onClick={() => exporting.mutate()}
        >
          {exporting.isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Download aria-hidden />
          )}
          <Trans>Export PGN</Trans>
        </Button>
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3.5">
        <HardDriveDownload className="size-4 text-faint" aria-hidden />
        <div className="min-w-56 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold text-ink">
              <Trans>Database backup</Trans>
            </h2>
            <span className="rounded-sm border border-edge px-1.5 py-0.5 font-mono text-[0.5625rem] tracking-wide text-faint uppercase">
              <Trans>Technical</Trans>
            </span>
          </div>
          <p className="mt-1 text-[0.6875rem] leading-[1.5] text-dim">
            <Trans>
              A lossless SQLite copy including analysis, accounts and settings. Restoring it
              requires the CLI while Blunderbase is stopped.{' '}
              <a
                href={manualUrl(locale, 'operate/backup')}
                target="_blank"
                rel="noreferrer"
                className="text-accent-teal hover:text-accent-link"
              >
                Restore guide ↗
              </a>
            </Trans>
          </p>
          <p className="mt-1 text-[0.6875rem] text-faint">
            {estimate}{' '}
            <Trans>The download appears after Blunderbase prepares a consistent snapshot.</Trans>
          </p>
          {backingUp.isError ? (
            <p role="alert" className="mt-1 text-[0.6875rem] text-blunder">
              {backingUp.error.message}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={backingUp.isPending}
          onClick={() => backingUp.mutate()}
        >
          {backingUp.isPending ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <HardDriveDownload aria-hidden />
          )}
          <Trans>Download backup</Trans>
        </Button>
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-blunder/28 bg-panel px-4 py-3.5">
        <Trash2 className="size-4 text-blunder" aria-hidden />
        <div className="min-w-56 flex-1">
          <h2 className="text-xs font-semibold text-ink">
            <Trans>Reset imported Library</Trans>
          </h2>
          {deleted ? (
            <p role="status" className="mt-1 text-[0.6875rem] text-dim">
              {t`Deleted ${plural(deleted.games, { one: '# game', other: '# games' })}, ${plural(
                deleted.runs,
                { one: '# analysis run', other: '# analysis runs' },
              )} and ${plural(deleted.notes, { one: '# note', other: '# notes' })}.`}
            </p>
          ) : (
            <p className="mt-1 text-[0.6875rem] leading-[1.5] text-dim">
              {total === undefined ? (
                <Trans>Delete the imported games and everything attached to them.</Trans>
              ) : (
                <Plural
                  value={total}
                  one="Delete # game and everything attached to it."
                  other="Delete # games and everything attached to them."
                />
              )}
            </p>
          )}
        </div>
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
          <Trans>Reset imported Library…</Trans>
        </Button>
      </section>
      <DeletedGamesCard />

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
    </div>
  )
}

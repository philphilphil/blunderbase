/**
 * "PGN file": the upload, as a region of its own under Accounts.
 *
 * It had been a fourth box in the accounts grid, under the head that holds Since, Max games
 * and Sync all, so nothing said whether those applied to a file (they do not). As its own
 * region it has its own head, its own options (whether to skip evaluation, whose games the
 * file holds) and its own primary, Upload, which keeps the one disabled look, with a title
 * saying why, until a file is chosen. No status dot: a file has no connection to report.
 *
 * The file's text is the request body, so several files dropped at once are simply
 * concatenated — which is what a PGN export of many games already is. The whole region is
 * the drop target: the pointer is already over the thing it means. Choosing a file is a
 * command, so it is a button ("Choose file…"), and the drop is said in plain words beside
 * it: it had been accent text, the colour kept for links.
 *
 * Whose games the file holds (`WhoseGamesToggle`) is a per-upload answer and belongs
 * beside the file it is about. There is no "last upload" stamp: an account's stamp tells
 * you whether to press Sync, and a file's never does. The sync history below records every
 * upload with its time, which is where that belongs.
 */
import { plural } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { Loader2, Upload, X } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'

import { WhoseGamesToggle } from '@/components/import/WhoseGamesToggle'
import { Readout } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useUploadPgn } from '@/lib/api/queries'
import { readPgnFile } from '@/lib/chess/pgnFile'
import { cn } from '@/lib/utils'

import { JobProgress, progressChrome } from './JobProgress'
import { SyncCheckbox } from './SyncCheckbox'
import type { SourceProgress } from './useImportProgress'

/** A PGN export is text; a `.pgn` extension is a convention, not a guarantee. */
const ACCEPT = '.pgn,.txt,application/x-chess-pgn,text/plain'

function size(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} kB`
  return `${bytes} B`
}

export function PgnCard({ progress }: { progress?: SourceProgress }) {
  const { t } = useLingui()
  const [files, setFiles] = useState<File[]>([])
  const [mine, setMine] = useState(true)
  const [skipEvaluation, setSkipEvaluation] = useState(false)
  const [over, setOver] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const upload = useUploadPgn()

  const total = files.reduce((bytes, file) => bytes + file.size, 0)
  const busy = upload.isPending || progress?.running === true

  function accept(list: FileList | null) {
    if (!list || list.length === 0) return
    setReadError(null)
    upload.reset()
    setFiles([...list])
  }

  function drop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    setOver(false)
    accept(event.dataTransfer.files)
  }

  async function send() {
    if (files.length === 0) return
    try {
      const texts = await Promise.all(files.map(readPgnFile))
      const pgn = texts.join('\n\n')
      if (!pgn.trim()) {
        setReadError(t`that file carried no PGN`)
        return
      }
      // `analyze` only ever travels to turn evaluation off; left out, the upload is queued.
      // `mine` reads the same way: absent means the owner's own games, as it always did.
      upload.mutate({
        pgn,
        analyze: skipEvaluation ? false : undefined,
        mine: mine ? undefined : false,
      })
    } catch (error) {
      setReadError(error instanceof Error ? error.message : t`the file could not be read`)
    }
  }

  // The region's own border, unless a run in flight (or one that failed) tints it the way
  // it tints an account box.
  const chrome = progressChrome(progress)

  return (
    <section
      data-source="pgn"
      data-pgn-drop-target
      aria-labelledby="pgn-file-title"
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={cn(
        'flex flex-col rounded-xl border bg-panel transition-colors',
        chrome === 'border-edge' ? 'border-line' : chrome,
        over && 'border-dashed border-accent-teal/60 bg-accent-teal/5',
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline px-3.5 py-3">
        <h2 id="pgn-file-title" className="text-data font-semibold text-ink">
          <Trans>PGN file</Trans>
        </h2>
        <p className="text-label text-dim">
          <Trans>A PGN export, of one game or a hundred thousand.</Trans>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-2.5 px-3.5 py-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()}>
          <Upload aria-hidden />
          <Trans>Choose file…</Trans>
        </Button>
        {files.length > 0 ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate font-mono text-label text-soft">
              {files.length === 1
                ? files[0]!.name
                : plural(files.length, { one: '# file', other: '# files' })}
            </span>
            <Readout num>{size(total)}</Readout>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t`Clear the selected file`}
              title={t`Clear the selected file`}
              onClick={() => {
                setFiles([])
                if (input.current) input.current.value = ''
              }}
            >
              <X aria-hidden />
            </Button>
          </span>
        ) : (
          <span className="text-label whitespace-nowrap text-dim">
            <Trans>or drop it on this box</Trans>
          </span>
        )}
        <div className="flex-1" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <SyncCheckbox
            label={t`Skip evaluation`}
            title={t`Store the games and stop there — no analysis pass is queued. Backfill on the Analysis page queues the passes afterwards.`}
            checked={skipEvaluation}
            onChange={setSkipEvaluation}
            disabled={busy}
          />
          {/* Always shown, not only once a file is picked: it is the question the upload
              would otherwise answer silently, and the answer is worth reading before the
              file is chosen as well as after. */}
          <span className="flex items-center gap-2">
            <span className="text-label text-soft">
              <Trans>Whose games</Trans>
            </span>
            <WhoseGamesToggle mine={mine} onChange={setMine} disabled={busy} />
          </span>
          <Button
            type="button"
            size="sm"
            disabled={files.length === 0 || busy}
            title={
              busy
                ? t`A PGN is being imported`
                : files.length === 0
                  ? t`Choose a file first`
                  : undefined
            }
            onClick={() => void send()}
          >
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
            <Trans>Upload</Trans>
          </Button>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        data-testid="pgn-file-input"
        onChange={(event) => accept(event.target.files)}
      />
      {readError ? <p className="px-3.5 pb-3 text-label text-blunder">{readError}</p> : null}
      {upload.isError ? (
        <p className="px-3.5 pb-3 text-label text-blunder">{upload.error.message}</p>
      ) : null}

      {progress ? <JobProgress progress={progress} className="mx-3.5 mb-3" /> : null}
    </section>
  )
}

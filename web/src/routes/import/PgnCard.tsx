/**
 * The PGN upload, as the fourth box of the sources grid.
 *
 * The file's text is the request body, so several files dropped at once are simply
 * concatenated — which is what a PGN export of many games already is. The box itself is
 * the drop target: the pointer is already over the thing it means, and a box is a bigger
 * and more obvious target than the table row this used to be.
 *
 * The one control it has of its own is whose games the file holds (`WhoseGamesToggle`).
 * That is a per-upload answer and belongs beside the file it is about, not in the strip
 * above the grid, which every source reads.
 *
 * It is three lines like the account boxes beside it, and the third is not "last upload":
 * an account's stamp is what tells you whether to press Sync, and a file's never is — the
 * only question here is whether to upload this file. The sync history below records every
 * upload with its time, which is where that belongs.
 */
import { FileUp, Loader2, Upload, X } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'

import { SourceBadge } from '@/components/badges/SourceBadge'
import { WhoseGamesToggle } from '@/components/import/WhoseGamesToggle'
import { Button } from '@/components/ui/button'
import { useUploadPgn } from '@/lib/api/queries'
import { cn } from '@/lib/utils'

import { JobProgress, progressChrome } from './JobProgress'
import type { SourceProgress } from './useImportProgress'

/** A PGN export is text; a `.pgn` extension is a convention, not a guarantee. */
const ACCEPT = '.pgn,.txt,application/x-chess-pgn,text/plain'

function size(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} kB`
  return `${bytes} B`
}

export function PgnCard({
  progress,
  skipEvaluation,
}: {
  progress?: SourceProgress
  /** The grid's own switch, shared with the accounts beside it. */
  skipEvaluation: boolean
}) {
  const [files, setFiles] = useState<File[]>([])
  const [mine, setMine] = useState(true)
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

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    setOver(false)
    accept(event.dataTransfer.files)
  }

  async function send() {
    if (files.length === 0) return
    try {
      const texts = await Promise.all(files.map((file) => file.text()))
      const pgn = texts.join('\n\n')
      if (!pgn.trim()) {
        setReadError('that file carried no PGN')
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
      setReadError(error instanceof Error ? error.message : 'the file could not be read')
    }
  }

  return (
    <div
      data-source="pgn"
      data-pgn-drop-target
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={cn(
        'flex flex-col gap-2 rounded-lg border bg-elevated-2 p-3',
        progressChrome(progress),
        over && 'border-dashed border-accent-teal/60 bg-accent-teal/5',
      )}
    >
      <div className="flex items-center gap-2">
        <SourceBadge source="pgn" title="A PGN export, of one game or a hundred thousand." />
        <div className="flex-1" />
        {files.length > 0 ? (
          <span className="font-mono text-[0.71875rem] text-dim tabular">{size(total)}</span>
        ) : null}
      </div>

      {/* The file line keeps the box's height whether or not one is picked, so the grid
          does not shuffle the moment a file is chosen. */}
      <div className="flex min-h-7 items-center gap-2">
        {files.length > 0 ? (
          <>
            <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-soft">
              {files.length === 1 ? files[0]!.name : `${files.length} files`}
            </span>
            <button
              type="button"
              aria-label="Clear the selected file"
              onClick={() => {
                setFiles([])
                if (input.current) input.current.value = ''
              }}
              className="text-faint hover:text-ink"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="inline-flex items-center gap-1.5 text-[0.6875rem] text-accent-teal transition-colors hover:text-accent-link"
          >
            <FileUp className="size-3.5" aria-hidden />
            Choose a file, or drop one here
          </button>
        )}
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
      {readError ? <p className="text-[0.6875rem] text-blunder">{readError}</p> : null}
      {upload.isError ? (
        <p className="text-[0.6875rem] text-blunder">{upload.error.message}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {/* Always shown, not only once a file is picked: it is the question the upload
            would otherwise answer silently, and the answer is worth reading before the
            file is chosen as well as after. */}
        <WhoseGamesToggle mine={mine} onChange={setMine} disabled={busy} />
        <div className="flex-1" />
        <Button type="button" size="sm" disabled={files.length === 0 || busy} onClick={() => void send()}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
          Upload
        </Button>
      </div>

      {progress ? <JobProgress progress={progress} /> : null}
    </div>
  )
}

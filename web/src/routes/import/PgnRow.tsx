/**
 * The PGN upload, as the third row of the sources table.
 *
 * The file's text is the request body, so several files dropped at once are simply
 * concatenated — which is what a PGN export of many games already is. The row itself is
 * the drop target: a dashed panel the size of a card bought nothing a highlighted row does
 * not, and the pointer is already over the row it means. Of the table's three controls it
 * reads only the last: a PGN is a file, not a cursor with a date and a cap.
 */
import { FileUp, Loader2, Upload, X } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'

import { Button } from '@/components/ui/button'
import { TableCell, TableRow } from '@/components/ui/table'
import { useUploadPgn } from '@/lib/api/queries'
import type { ImportJob } from '@/lib/api/types'
import { relative } from '@/lib/mcp/status'
import { cn } from '@/lib/utils'

import { JobProgress } from './JobProgress'
import type { SourceProgress } from './useImportProgress'

/** A PGN export is text; a `.pgn` extension is a convention, not a guarantee. */
const ACCEPT = '.pgn,.txt,application/x-chess-pgn,text/plain'

function size(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} kB`
  return `${bytes} B`
}

export function PgnRow({
  lastJob,
  progress,
  skipEvaluation,
}: {
  lastJob?: ImportJob
  progress?: SourceProgress
  /** The table's own switch, shared with the accounts above. */
  skipEvaluation: boolean
}) {
  const [files, setFiles] = useState<File[]>([])
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

  function drop(event: DragEvent<HTMLTableRowElement>) {
    event.preventDefault()
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
      upload.mutate({ pgn, analyze: skipEvaluation ? false : undefined })
    } catch (error) {
      setReadError(error instanceof Error ? error.message : 'the file could not be read')
    }
  }

  return (
    <>
      <TableRow
        data-state={progress ? 'selected' : undefined}
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={cn(over && 'bg-accent-teal/5 outline outline-dashed outline-accent-teal/50')}
      >
        <TableCell>
          <span className="inline-flex items-center gap-1.5 rounded-sm border border-edge bg-chip-neutral px-2 py-[0.1875rem] text-[0.71875rem] text-soft">
            <FileUp className="size-3 text-faint" aria-hidden />
            PGN
          </span>
        </TableCell>

        <TableCell>
          <div className="flex items-center gap-2">
            {files.length > 0 ? (
              <>
                <span className="max-w-56 truncate font-mono text-[0.6875rem] text-soft">
                  {files.length === 1 ? files[0]!.name : `${files.length} files`}
                </span>
                <span className="font-mono text-[0.65625rem] text-dim tabular">{size(total)}</span>
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
                className="text-[0.6875rem] text-accent-teal transition-colors hover:text-accent-link"
              >
                Choose a file, or drop one on this row
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
          {readError ? <p className="mt-1 text-[0.6875rem] text-blunder">{readError}</p> : null}
          {upload.isError ? (
            <p className="mt-1 text-[0.6875rem] text-blunder">{upload.error.message}</p>
          ) : null}
        </TableCell>

        <TableCell className="text-right font-mono text-[0.71875rem] text-faint tabular">—</TableCell>

        <TableCell className="font-mono text-[0.71875rem] text-dim tabular">
          {lastJob ? relative(lastJob.finished_at ?? lastJob.created_at) : '—'}
        </TableCell>

        <TableCell className="text-right">
          <Button
            type="button"
            size="sm"
            disabled={files.length === 0 || busy}
            onClick={() => void send()}
          >
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
            Upload
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

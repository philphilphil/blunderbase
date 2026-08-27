import { FileUp, Loader2, Upload, X } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'

import { Button } from '@/components/ui/button'
import { useUploadPgn } from '@/lib/api/queries'
import { cn } from '@/lib/utils'

import { JobProgress } from './JobProgress'
import { SkipEvaluation } from './SkipEvaluation'
import type { SourceProgress } from './useImportProgress'

/** A PGN export is text; a `.pgn` extension is a convention, not a guarantee. */
const ACCEPT = '.pgn,.txt,application/x-chess-pgn,text/plain'

function size(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} kB`
  return `${bytes} B`
}

/**
 * The PGN upload: the file's text is the request body, so several files dropped at once
 * are simply concatenated — which is exactly what a PGN export of many games already is.
 */
export function PgnUpload({ progress }: { progress?: SourceProgress }) {
  const [files, setFiles] = useState<File[]>([])
  const [over, setOver] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [skipEvaluation, setSkipEvaluation] = useState(false)
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
    <div className="flex flex-col rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-2.5 border-b border-hairline px-3.5 py-3">
        <FileUp className="size-3.5 text-faint" aria-hidden />
        <span className="text-xs font-semibold text-ink">PGN file</span>
        <div className="flex-1" />
        <span className="font-mono text-[0.625rem] text-dim">one game or a thousand</span>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-3.5 py-3.5">
        <div
          onDragOver={(event) => {
            event.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          className={cn(
            'flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-6 text-center transition-colors',
            over ? 'border-accent-teal/50 bg-accent-teal/5' : 'border-edge-strong bg-surface-2',
          )}
        >
          <Upload className={cn('size-4', over ? 'text-accent-teal' : 'text-faint')} aria-hidden />
          <p className="text-[0.75rem] text-soft">Drop a PGN export here</p>
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="text-[0.6875rem] text-accent-teal hover:text-accent-link"
          >
            or choose a file
          </button>
          <input
            ref={input}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            data-testid="pgn-file-input"
            onChange={(event) => accept(event.target.files)}
          />
        </div>

        {files.length > 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-edge bg-elevated px-2.5 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-soft">
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
          </div>
        ) : null}

        <SkipEvaluation checked={skipEvaluation} onChange={setSkipEvaluation} disabled={busy} />

        {readError ? <p className="text-[0.6875rem] text-blunder">{readError}</p> : null}
        {upload.isError ? <p className="text-[0.6875rem] text-blunder">{upload.error.message}</p> : null}

        <div className="flex-1" />

        {progress ? <JobProgress progress={progress} /> : null}
      </div>

      <div className="flex items-center gap-2 border-t border-hairline px-3.5 py-2.5">
        <span className="flex-1 text-[0.6875rem] text-dim">
          Games already in the database are skipped, not duplicated.
        </span>
        <Button type="button" size="sm" disabled={files.length === 0 || busy} onClick={() => void send()}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
          Upload
        </Button>
      </div>
    </div>
  )
}

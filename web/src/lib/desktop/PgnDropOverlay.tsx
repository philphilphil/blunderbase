import { FileUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { WhoseGamesToggle } from '@/components/import/WhoseGamesToggle'
import { Button } from '@/components/ui/button'
import { useUploadPgn } from '@/lib/api/queries'
import { toast } from '@/lib/toast'

function pgnFiles(list: FileList | null): File[] {
  if (!list) return []
  return [...list].filter((file) => /\.(pgn|txt)$/i.test(file.name))
}

function isLocalDropTarget(event: DragEvent): boolean {
  return event.target instanceof Element && event.target.closest('[data-pgn-drop-target]') !== null
}

function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') === true
}

/**
 * Drop PGN exports anywhere in the signed-in application and import them.
 *
 * The drop does not import on its own: a file says nothing about whose games it holds, and
 * storing somebody else's as the owner's puts moves they never played into every statistic.
 * So the drop opens the same question the import page's PGN row shows, and the import waits
 * for it. This is the one place the question has to be a dialog — there is no row here to
 * put a toggle in, and a drop that has already imported is too late to be asked.
 */
export function PgnDropOverlay() {
  const [over, setOver] = useState(false)
  const [asking, setAsking] = useState<File[] | null>(null)
  const [mine, setMine] = useState(true)
  const depth = useRef(0)
  const { isPending, mutateAsync } = useUploadPgn()
  const pending = useRef(isPending)

  useEffect(() => {
    pending.current = isPending
  }, [isPending])

  useEffect(() => {
    const enter = (event: DragEvent) => {
      if (!carriesFiles(event) || isLocalDropTarget(event)) return
      event.preventDefault()
      depth.current += 1
      setOver(true)
    }
    const overWindow = (event: DragEvent) => {
      if (!carriesFiles(event) || isLocalDropTarget(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setOver(false)
    }
    const drop = (event: DragEvent) => {
      const files = pgnFiles(event.dataTransfer?.files ?? null)
      depth.current = 0
      setOver(false)
      if (files.length === 0 || pending.current) return
      event.preventDefault()
      // Held, not read: the answer to "whose games?" is what the import is waiting on, and
      // a file the reader cannot open should say so when it is asked for, not before.
      setMine(true)
      setAsking(files)
    }

    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', overWindow)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', overWindow)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [])

  function send(files: File[]) {
    setAsking(null)
    void Promise.all(files.map((file) => file.text()))
      .then((texts) => {
        const pgn = texts.join('\n\n')
        if (!pgn.trim()) throw new Error('That file carried no PGN.')
        return mutateAsync({ pgn, mine: mine ? undefined : false })
      })
      .then(() => toast.success('PGN import started.'))
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : 'The PGN could not be imported.'),
      )
  }

  if (asking) {
    return (
      <WhoseGamesDialog
        files={asking}
        mine={mine}
        onMine={setMine}
        onClose={() => setAsking(null)}
        onImport={() => send(asking)}
      />
    )
  }

  if (!over) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-3 z-[70] flex items-center justify-center rounded-xl border-2 border-dashed border-accent-teal bg-void/90"
    >
      <div className="flex flex-col items-center gap-3 text-accent-teal">
        <FileUp className="size-8" aria-hidden />
        <span className="text-sm font-semibold">Drop to import PGN</span>
      </div>
    </div>
  )
}

/**
 * What the drop asks before it imports. Escape and the backdrop both cancel the drop.
 *
 * Import closes it rather than waiting: the request is answered as soon as the job row
 * exists, and the toast and the import page's progress are where the rest of it shows.
 */
function WhoseGamesDialog({
  files,
  mine,
  onMine,
  onClose,
  onImport,
}: {
  files: File[]
  mine: boolean
  onMine: (mine: boolean) => void
  onClose: () => void
  onImport: () => void
}) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])

  const named = files.length === 1 ? files[0]!.name : `${files.length} files`

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-void/75 px-6 pt-[12vh] max-md:px-4 max-md:pt-6"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pgn-drop-title"
        className="bb-card flex w-full max-w-[22rem] flex-col gap-4 px-5 py-5 shadow-[0_1rem_3rem_var(--bb-shadow)]"
      >
        <div className="flex flex-col gap-1.5">
          <h2 id="pgn-drop-title" className="text-sm font-semibold text-ink">
            Whose games are these?
          </h2>
          <p className="text-xs text-dim">
            <span className="font-mono text-soft">{named}</span>. Games that are not yours are
            stored and analysed like any other, and counted in no statistic.
          </p>
        </div>

        <WhoseGamesToggle mine={mine} onChange={onMine} className="self-start" />

        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={onImport}>
            Import
          </Button>
        </div>
      </div>
    </div>
  )
}

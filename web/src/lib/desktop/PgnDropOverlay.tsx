import { FileUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

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

/** Drop PGN exports anywhere in the signed-in application and import them immediately. */
export function PgnDropOverlay() {
  const [over, setOver] = useState(false)
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
      void Promise.all(files.map((file) => file.text()))
        .then((texts) => {
          const pgn = texts.join('\n\n')
          if (!pgn.trim()) throw new Error('That file carried no PGN.')
          return mutateAsync({ pgn })
        })
        .then(() => toast.success('PGN import started.'))
        .catch((error: unknown) =>
          toast.error(error instanceof Error ? error.message : 'The PGN could not be imported.'),
        )
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
  }, [mutateAsync])

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

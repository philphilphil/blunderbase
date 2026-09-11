/**
 * The finished game's tree, read-only, over the game page.
 *
 * A correspondence game that is over is a library game like any other — analysed, on the
 * eval graph, in the statistics — and `/games/:id` is where it is read. What the game page
 * cannot show is the months of work behind the moves: the candidates that were weighed, the
 * lines that were refuted, the comments written while it was running. That is what this
 * opens, and it opens read-only: the tree froze when the game did.
 *
 * A dialog rather than a fifth pane in the game screen's matrix, because it is a thing the
 * owner goes and looks at rather than something they read alongside the moves — and because
 * the matrix is already four panes wide at 1440.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useCorrespondenceGame } from '@/lib/api/queries'

import { TreePane } from './TreePane'

export function CorrespondenceTreeDialog({
  gameId,
  onClose,
}: {
  gameId: number
  onClose: () => void
}) {
  const { t } = useLingui()
  const detail = useCorrespondenceGame(gameId)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  useEffect(() => {
    const key = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-void/75 px-6 pt-[8vh] pb-8 max-md:px-3 max-md:pt-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="correspondence-tree-title"
        className="bb-card flex max-h-full w-full max-w-[46rem] flex-col shadow-[0_1rem_3rem_var(--bb-shadow)]"
      >
        <div className="flex flex-none items-center gap-2 border-b border-line px-3.5 py-2.5">
          <h2 id="correspondence-tree-title" className="text-[0.8125rem] font-semibold text-ink">
            <Trans>Correspondence tree</Trans>
          </h2>
          <span className="text-[0.6875rem] text-dim">
            <Trans>what was considered while the game ran</Trans>
          </span>
          <div className="flex-1" />
          <Button type="button" variant="ghost" size="icon" aria-label={t`Close`} onClick={onClose}>
            <X aria-hidden />
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {detail.isPending ? <Skeleton className="m-3 h-40" /> : null}
          {detail.error ? (
            <p className="px-3.5 py-3 text-[0.75rem] text-blunder">{detail.error.message}</p>
          ) : null}
          {detail.data ? (
            <TreePane
              tree={detail.data.tree}
              selectedId={selectedId}
              readOnly
              onSelect={setSelectedId}
              onMark={() => {}}
              onComment={() => {}}
              onPromote={() => {}}
              onDelete={() => {}}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

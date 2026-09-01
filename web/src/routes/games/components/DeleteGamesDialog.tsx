/**
 * The confirmation in front of deleting games from the library.
 *
 * No password, unlike `DeleteAllGamesDialog`: that one empties the library, and being
 * signed in is a session rather than a decision. This deletes what the owner picked out
 * and can see. What it does ask is that the count is read — one game and forty games are
 * the same two clicks otherwise — and it names what goes with them, because the analysis
 * and the notes are the part nobody expects to lose.
 */
import { Loader2, TriangleAlert } from 'lucide-react'
import { useEffect, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'

export function DeleteGamesDialog({
  count,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  /** How many games are about to go. */
  count: number
  pending: boolean
  error: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!pending) onConfirm()
  }

  const games = count === 1 ? '1 game' : `${count.toLocaleString('en-US')} games`

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-void/75 px-6 pt-[12vh] max-md:overflow-y-auto max-md:px-4 max-md:pt-6 max-md:pb-6"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-games-title"
        className="bb-card flex w-full max-w-[22rem] flex-col gap-4 px-5 py-5 shadow-[0_1rem_3rem_var(--bb-shadow)]"
      >
        <div className="flex flex-col gap-1.5">
          <h2
            id="delete-games-title"
            className="flex items-center gap-2 text-[0.875rem] font-semibold text-ink"
          >
            <TriangleAlert className="size-3.5 text-blunder" aria-hidden />
            Delete {games}
          </h2>
          <p className="text-[0.75rem] leading-[1.65] text-dim">
            {count === 1 ? 'The game goes' : 'They go'} with their analysis, the notes written
            about them and the variations kept off them. Notes about a position stay, and so
            does the sync history — a source you sync again will not fetch{' '}
            {count === 1 ? 'it' : 'them'} back. There is no undo.
          </p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error ? (
            <p className="rounded-md border border-blunder/28 bg-blunder/5 px-2.5 py-2 text-[0.75rem] text-blunder">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" autoFocus disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {count === 1 ? 'Delete it' : 'Delete them'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

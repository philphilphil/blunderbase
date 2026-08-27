import { Loader2, TriangleAlert } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { useDeleteAllGames } from '@/lib/api/queries'
import type { GamesDeleted } from '@/lib/api/types'
import { FormError, PasswordField } from '@/routes/auth/AuthScreen'
import { authErrorMessage } from '@/routes/auth/password'

/**
 * The confirmation in front of emptying the library.
 *
 * It asks for the password rather than for a typed phrase because that is what the backend
 * asks for: being signed in is a session, not a decision. The count is on the button for
 * the same reason the sentence names what survives — the number is what tells the owner
 * whether this is the database they think it is.
 */
export function DeleteAllGamesDialog({
  games,
  onClose,
  onDone,
}: {
  /** How many games are about to go, or undefined while the count is still loading. */
  games: number | undefined
  onClose: () => void
  onDone: (deleted: GamesDeleted) => void
}) {
  const [password, setPassword] = useState('')
  const wipe = useDeleteAllGames({ onSuccess: onDone })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (wipe.isPending || !password) return
    wipe.mutate(password)
  }

  const message = wipe.isError ? authErrorMessage(wipe.error) : null
  const count = games === undefined ? null : games.toLocaleString('en-US')

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-void/75 px-6 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-all-games-title"
        className="bb-card flex w-full max-w-[22rem] flex-col gap-4 px-5 py-5 shadow-[0_1rem_3rem_var(--bb-shadow)]"
      >
        <div className="flex flex-col gap-1.5">
          <h2
            id="delete-all-games-title"
            className="flex items-center gap-2 text-[0.875rem] font-semibold text-ink"
          >
            <TriangleAlert className="size-3.5 flex-none text-blunder" aria-hidden />
            Delete all games
          </h2>
          <p className="text-[0.75rem] leading-[1.65] text-dim">
            {count === null
              ? 'Every game in the database goes, with its analysis and its notes.'
              : `${count} ${count === '1' ? 'game goes' : 'games go'}, with their analysis and their notes.`}{' '}
            The sync history goes too, so the next sync re-imports from the beginning. Your
            accounts, engines, settings and notes about a position stay. There is no undo.
          </p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <PasswordField
            id="delete-all-games-password"
            label="Your password"
            value={password}
            onChange={(value) => {
              setPassword(value)
              wipe.reset()
            }}
            autoComplete="current-password"
            autoFocus
            invalid={Boolean(message)}
          />

          {message ? <FormError>{message}</FormError> : null}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!password || wipe.isPending}>
              {wipe.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Delete them
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

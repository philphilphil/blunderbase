import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { Loader2, TriangleAlert } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { useDeleteAllGames } from '@/lib/api/queries'
import type { GamesDeleted } from '@/lib/api/types'
import { useRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { FormError, PasswordField } from '@/routes/auth/AuthScreen'
import { authErrorMessage } from '@/routes/auth/password'

/**
 * The confirmation in front of emptying the library.
 *
 * A server asks for its owner password again: being signed in is a session, not a decision.
 * Desktop has no persistent password and uses this explicit destructive dialog as the
 * confirmation. In both cases the count names whether this is the library the owner means.
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
  const { t } = useLingui()
  const capabilities = useRuntimeCapabilities()
  const [password, setPassword] = useState('')
  const wipe = useDeleteAllGames({ onSuccess: onDone })

  useEffect(() => {
    const key = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])

  function submit(event: FormEvent) {
    event.preventDefault()
    if ((capabilities.password_auth && !password) || wipe.isPending) return
    wipe.mutate(capabilities.password_auth ? password : undefined)
  }

  const message = wipe.isError ? authErrorMessage(wipe.error) : null
  const count = games?.toLocaleString('en-US')

  return (
    <div
      // Below `md` the sheet starts near the top and the backdrop scrolls: the password
      // field brings the keyboard up, and a 12vh inset would push the buttons off-screen.
      className="fixed inset-0 z-50 flex items-start justify-center bg-void/75 px-6 pt-[12vh] max-md:overflow-y-auto max-md:px-4 max-md:pt-6 max-md:pb-6"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-all-games-title"
        className="bb-card flex w-full max-w-[22rem] flex-col gap-4 px-5 py-5 shadow-[0_1rem_3rem_var(--bb-shadow)]"
      >
        <div className="flex flex-col gap-1.5">
          <h2 id="delete-all-games-title" className="flex items-center gap-2 text-[0.875rem] font-semibold text-ink">
            <TriangleAlert className="size-3.5 text-blunder" aria-hidden />
            <Trans>Reset imported library</Trans>
          </h2>
          {/* Two whole sentences rather than a count glued to a tail: which of them is on
              screen turns on whether the library has been counted yet. */}
          <p className="text-[0.75rem] leading-[1.65] text-dim">
            {count === undefined ? (
              <Trans>
                Every game goes, with game analysis, game notes and sync history. Accounts,
                engines and position-only notes stay. There is no undo.
              </Trans>
            ) : (
              <Trans>
                <Plural value={games ?? 0} one={`${count} game goes`} other={`${count} games go`} />
                , with game analysis, game notes and sync history. Accounts, engines and
                position-only notes stay. There is no undo.
              </Trans>
            )}
          </p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {capabilities.password_auth ? (
            <PasswordField
              id="delete-all-games-password"
              label={t`Your password`}
              value={password}
              onChange={(value) => {
                setPassword(value)
                wipe.reset()
              }}
              autoComplete="current-password"
              autoFocus
              invalid={Boolean(message)}
            />
          ) : null}
          {message ? <FormError>{message}</FormError> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              type="submit"
              variant="destructive"
              autoFocus={!capabilities.password_auth}
              disabled={(capabilities.password_auth && !password) || wipe.isPending}
            >
              {wipe.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              <Trans>Delete them</Trans>
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

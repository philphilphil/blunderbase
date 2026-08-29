import { Check, Loader2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { useChangePassword } from '@/lib/api/queries'

import { FormError, PasswordField } from './AuthScreen'
import { authErrorMessage, passwordProblem } from './password'

/**
 * Change the password from the titlebar.
 *
 * The server revokes every session and hands *this* browser a fresh cookie, so the owner
 * stays where they are and everything else — another laptop, a phone, the coach's bearer
 * key — stops working. That is worth saying on the form rather than discovering later.
 */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [invalid, setInvalid] = useState<string | null>(null)
  const change = useChangePassword()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (change.isPending) return
    const problem = current ? passwordProblem(next, confirm) : 'the current password is missing'
    setInvalid(problem)
    if (problem) return
    change.mutate({ current, next })
  }

  const message = invalid ?? (change.isError ? authErrorMessage(change.error) : null)

  return (
    <div
      // Three password fields do not fit under a 12vh inset on a phone, least of all with
      // the keyboard up, so below `md` the sheet starts near the top and the backdrop
      // itself scrolls.
      className="fixed inset-0 z-50 flex items-start justify-center bg-void/75 px-6 pt-[12vh] max-md:overflow-y-auto max-md:px-4 max-md:pt-6 max-md:pb-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-password-title"
        className="bb-card flex w-full max-w-[22rem] flex-col gap-4 px-5 py-5 shadow-[0_1rem_3rem_var(--bb-shadow)]"
      >
        <div className="flex flex-col gap-1.5">
          <h2 id="change-password-title" className="text-[0.875rem] font-semibold text-ink">
            Change the password
          </h2>
          <p className="text-[0.75rem] leading-[1.65] text-dim">
            Every other browser is signed out, and the MCP bearer key changes with it — the
            coach reconnects with the new one. This browser stays signed in.
          </p>
        </div>

        {change.isSuccess ? (
          <>
            <div className="flex items-center gap-2.5 rounded-md border border-good/30 bg-good/8 px-3 py-2.5">
              <Check className="size-3.5 flex-none text-good" aria-hidden />
              <span className="text-[0.71875rem] text-good">
                Changed. You are still signed in here.
              </span>
            </div>
            <Button type="button" onClick={onClose}>
              Close
            </Button>
          </>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <PasswordField
              id="current-password"
              label="Current password"
              value={current}
              onChange={(value) => {
                setCurrent(value)
                setInvalid(null)
                change.reset()
              }}
              autoComplete="current-password"
              autoFocus
              invalid={Boolean(message)}
            />
            <PasswordField
              id="next-password"
              label="New password"
              value={next}
              onChange={(value) => {
                setNext(value)
                setInvalid(null)
                change.reset()
              }}
              autoComplete="new-password"
              invalid={Boolean(message)}
            />
            <PasswordField
              id="next-password-confirm"
              label="Repeat the new one"
              value={confirm}
              onChange={(value) => {
                setConfirm(value)
                setInvalid(null)
                change.reset()
              }}
              autoComplete="new-password"
              invalid={Boolean(message)}
            />

            {message ? <FormError>{message}</FormError> : null}

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={change.isPending}>
                {change.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Change it
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

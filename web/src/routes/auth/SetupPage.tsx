import { Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { useSetupPassword } from '@/lib/api/queries'

import { AuthScreen, FormError, PasswordField } from './AuthScreen'
import { authErrorMessage, passwordProblem } from './password'

/**
 * First run. Nobody has chosen a password yet, so whoever is here is the owner — there is
 * no registration to complete and no second account to create afterwards.
 *
 * The copy has to carry one thing the form cannot: this password is also the MCP bearer
 * key (README, "Signing in"). An owner who picks something throwaway here has picked it
 * for the coach's connection too.
 */
export function SetupPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [invalid, setInvalid] = useState<string | null>(null)
  const setup = useSetupPassword()

  function submit(event: FormEvent) {
    event.preventDefault()
    if (setup.isPending) return
    const problem = passwordProblem(password, confirm)
    setInvalid(problem)
    if (problem) return
    setup.mutate(password)
  }

  const message = invalid ?? (setup.isError ? authErrorMessage(setup.error) : null)

  return (
    <AuthScreen
      title="Choose the owner's password"
      description="Nobody has set one yet. One user, one password, no registration — whoever chooses it here is the owner of this deployment from now on."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <PasswordField
          id="new-password"
          label="Password"
          value={password}
          onChange={(value) => {
            setPassword(value)
            setInvalid(null)
            setup.reset()
          }}
          autoComplete="new-password"
          autoFocus
          invalid={Boolean(message)}
        />
        <PasswordField
          id="confirm-password"
          label="Repeat it"
          value={confirm}
          onChange={(value) => {
            setConfirm(value)
            setInvalid(null)
            setup.reset()
          }}
          autoComplete="new-password"
          invalid={Boolean(message)}
        />

        {message ? <FormError>{message}</FormError> : null}

        <Button type="submit" disabled={setup.isPending}>
          {setup.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Set the password and sign in
        </Button>
      </form>

      <p className="rounded-md border border-line bg-elevated px-3 py-2.5 text-[0.6875rem] leading-[1.6] text-dim">
        This is also the <span className="text-body-3">MCP bearer key</span>: the coach
        connects with exactly what you type here, so there is nothing else to configure.
        Changing the password later changes the key.
      </p>
    </AuthScreen>
  )
}

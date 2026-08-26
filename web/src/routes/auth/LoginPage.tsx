import { Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { useLogin } from '@/lib/api/queries'

import { AuthScreen, FormError, PasswordField } from './AuthScreen'
import { authErrorMessage } from './password'

/**
 * The door. One field, because there is one user — the form still carries a real `<form>`
 * and `current-password`, so a password manager fills and saves it like any other login.
 *
 * A wrong password is a 401 and a lockout is a 429; neither is retried and neither leaves
 * the screen. Signing in is a `setQueryData` on the auth status, so the app appears in the
 * same frame the answer arrives in.
 */
export function LoginPage() {
  const [password, setPassword] = useState('')
  const login = useLogin()

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!password || login.isPending) return
    login.mutate(password)
  }

  return (
    <AuthScreen
      title="Sign in"
      description="This Blunderbase is behind the owner's password — the one the deployment was set up with."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <PasswordField
          id="password"
          label="Password"
          value={password}
          onChange={(value) => {
            setPassword(value)
            login.reset()
          }}
          autoComplete="current-password"
          autoFocus
          invalid={login.isError}
        />

        {login.isError ? <FormError>{authErrorMessage(login.error)}</FormError> : null}

        <Button type="submit" disabled={!password || login.isPending}>
          {login.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Sign in
        </Button>
      </form>

      <p className="text-[0.6875rem] leading-[1.55] text-dim-2">
        Lost it? <code className="font-mono text-dim">uv run blunderbase set-password</code> resets
        it from a shell on the host.
      </p>
    </AuthScreen>
  )
}

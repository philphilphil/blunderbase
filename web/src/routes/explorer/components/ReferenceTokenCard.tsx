/**
 * The one thing the reference sources need that the owner has to supply: a Lichess API
 * token.
 *
 * Lichess's opening-explorer endpoints stopped answering anonymous requests, so both books
 * are dead without one. That makes this not an error but a setup step, and it is rendered
 * where the table would have been rather than as a red banner over it: there is nothing
 * wrong with the position, there is simply no key in the door yet.
 *
 * A rejected token says something different from a missing one — the key is there and the
 * lock refused it — so the sentence changes while the box stays the same.
 *
 * The field is `type="password"` and the value is never read back from the server (`GET
 * /reference/token` answers only whether one is configured), so a stored token cannot be
 * lifted off this screen by anyone who gets to the browser. Saving invalidates the whole
 * `['reference']` root, which is what makes the query that failed for want of the token
 * run again by itself — the owner pastes a token and the table appears, with nothing to
 * press twice.
 */
import { useState } from 'react'

import { useReferenceToken, useSetReferenceToken } from '@/lib/api/queries'

const TOKEN_URL = 'https://lichess.org/account/oauth/token'

export function ReferenceTokenCard({ reason }: { reason: 'missing' | 'rejected' }) {
  const stored = useReferenceToken()
  const save = useSetReferenceToken()
  const [token, setToken] = useState('')
  const trimmed = token.trim()

  return (
    <div className="flex flex-col items-start gap-2.5 rounded-xl border border-edge-strong bg-panel p-5">
      <span className="text-[0.75rem] font-semibold text-ink">
        {reason === 'rejected' ? 'Lichess refused that token' : 'Lichess needs a token'}
      </span>
      <p className="text-[0.78125rem] leading-relaxed text-soft">
        {reason === 'rejected'
          ? 'The stored token was rejected — it may have been revoked. Paste a new personal API token to read the masters and lichess databases.'
          : 'The masters and lichess databases no longer answer anonymous requests. Paste a personal API token to read them; no scope is needed.'}
      </p>
      <form
        className="flex w-full items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!trimmed || save.isPending) return
          save.mutate(trimmed, { onSuccess: () => setToken('') })
        }}
      >
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="lip_…"
          aria-label="Lichess API token"
          className="min-w-0 flex-1 rounded-md border border-input bg-raised px-2.5 py-1 font-mono text-[0.71875rem] text-ink outline-none placeholder:text-faint focus-visible:border-accent-teal/50"
        />
        <button
          type="submit"
          disabled={!trimmed || save.isPending}
          className="rounded-md border border-edge-input px-2.5 py-1 text-[0.71875rem] text-soft hover:border-edge-hover hover:text-ink disabled:text-faint-2 disabled:hover:border-edge-input"
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </form>
      {save.error ? (
        <p className="text-[0.6875rem] text-blunder">{save.error.message}</p>
      ) : null}
      <div className="flex items-center gap-3">
        <a
          href={TOKEN_URL}
          target="_blank"
          rel="noreferrer"
          className="text-[0.6875rem] text-accent-teal hover:text-accent-link"
        >
          Create one on lichess.org
        </a>
        {/*
          Only offered when the backend says something is stored — which, on a rejected
          token, is the other thing the owner may want: take the dead key out rather than
          leave it in the database for the next request to fail on.
        */}
        {stored.data?.configured ? (
          <button
            type="button"
            onClick={() => save.mutate(null)}
            disabled={save.isPending}
            className="text-[0.6875rem] text-dim hover:text-ink disabled:text-faint-2"
          >
            Remove the stored token
          </button>
        ) : null}
      </div>
    </div>
  )
}

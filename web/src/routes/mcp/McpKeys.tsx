import { KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCreateMcpKey, useDeleteMcpKey, useMcpKeys } from '@/lib/api/queries'
import type { McpKeyCreated, McpKeyResponse } from '@/lib/api/types'
import { relative } from '@/lib/mcp/status'

import { CopyButton } from './CopyButton'

/**
 * One minted key: what it is called, when it was made, when a client last used it, and the
 * one thing the owner can do to it — revoke. The confirm is inline, the way `RunnerCard`
 * does it: a second click on the same spot, with the consequence spelled out next to it,
 * rather than a dialog for something that is a two-second decision.
 */
function KeyRow({ item }: { item: McpKeyResponse }) {
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const revoke = useDeleteMcpKey()

  return (
    <li className="flex flex-col gap-1.5 px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        {confirmRevoke ? (
          <>
            <span className="flex-1 text-[0.6875rem] leading-[1.6] text-blunder">
              Revoking <span className="font-mono">{item.name}</span> stops its token dead; a
              client still holding it is refused from the next call. A new one means a new key.
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmRevoke(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(item.id)}
            >
              {revoke.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Revoke
            </Button>
          </>
        ) : (
          <>
            <KeyRound className="size-3.5 shrink-0 text-faint" aria-hidden />
            <span className="font-mono text-xs text-ink">{item.name}</span>
            <span className="flex-1 truncate text-[0.6875rem] text-dim">
              created {relative(item.created_at)} · last used{' '}
              {item.last_used_at ? relative(item.last_used_at) : 'never'}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmRevoke(true)}
            >
              <Trash2 aria-hidden />
              Revoke
            </Button>
          </>
        )}
      </div>
      {/*
        Outside the branches: a refused DELETE leaves the row confirming, and a click that
        appears to have done nothing is the one that most needs a reason next to it.
      */}
      {revoke.isError ? (
        <p className="text-[0.6875rem] text-blunder">{revoke.error.message}</p>
      ) : null}
    </li>
  )
}

/**
 * The keys section: the list, the reveal panel for the one just minted, and the form that
 * mints the next one.
 *
 * The token is in the create response and nowhere else — only its hash is stored — so it
 * is held by the page (`onMinted`), not the query cache, and goes away with "Done". The
 * page keeps it a moment longer than this panel so the connect snippets below can carry it.
 */
export function McpKeys({
  minted,
  onMinted,
  onDismiss,
}: {
  minted: McpKeyCreated | null
  onMinted: (created: McpKeyCreated) => void
  onDismiss: () => void
}) {
  const [name, setName] = useState('')
  const [invalid, setInvalid] = useState<string | null>(null)
  const keys = useMcpKeys()
  const create = useCreateMcpKey({
    onSuccess: (created) => {
      setName('')
      onMinted(created)
    },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setInvalid('a key needs a name')
      return
    }
    setInvalid(null)
    create.mutate({ name: name.trim() })
  }

  return (
    <section className="flex flex-col rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-2.5 border-b border-hairline px-3.5 py-3">
        <KeyRound className="size-3.5 text-faint" aria-hidden />
        <h2 className="text-xs font-semibold text-ink">Bearer keys</h2>
        <div className="flex-1" />
        <span className="font-mono text-[0.625rem] text-dim">
          {keys.data ? `${keys.data.length} active` : ''}
        </span>
      </div>

      {keys.isError ? (
        <p className="px-3.5 py-3 text-[0.6875rem] text-blunder">{keys.error.message}</p>
      ) : keys.data && keys.data.length === 0 ? (
        <p className="px-3.5 py-3 text-[0.6875rem] leading-[1.5] text-dim">
          No keys yet. Mint one below and paste it into your client&rsquo;s config.
        </p>
      ) : (
        <ul className="divide-y divide-hairline">
          {(keys.data ?? []).map((item) => (
            <KeyRow key={item.id} item={item} />
          ))}
        </ul>
      )}

      {minted ? (
        <div
          aria-live="polite"
          className="mx-3.5 mb-3 flex flex-col gap-2.5 rounded-lg border border-accent-teal/40 bg-accent-teal/5 px-3 py-3"
        >
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-semibold text-ink">
              {minted.key.name} is ready — this key is shown once
            </span>
            <div className="flex-1" />
            <CopyButton text={minted.token} label="Copy key" />
            <Button type="button" size="sm" onClick={onDismiss}>
              Done
            </Button>
          </div>
          <code className="block overflow-x-auto rounded-md border border-edge bg-elevated px-3 py-2 font-mono text-[0.71875rem] text-ink">
            {minted.token}
          </code>
          <p className="text-[0.6875rem] leading-[1.5] text-dim">
            Nothing stores it, so nothing can show it again. The connect commands below already
            carry it; a lost key is a revoke and a new one.
          </p>
        </div>
      ) : null}

      <form
        onSubmit={submit}
        className="flex flex-col gap-1.5 border-t border-hairline px-3.5 py-2.5"
      >
        <div className="flex items-center gap-2">
          <Input
            aria-label="New key name"
            value={name}
            spellCheck={false}
            autoComplete="off"
            placeholder="laptop, claude-code, …"
            className="max-w-xs"
            onChange={(event) => setName(event.target.value)}
          />
          <div className="flex-1" />
          <Button type="submit" size="sm" disabled={create.isPending}>
            {create.isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Plus aria-hidden />
            )}
            Create
          </Button>
        </div>
        {invalid ? <p className="text-[0.6875rem] text-blunder">{invalid}</p> : null}
        {create.isError ? (
          <p className="text-[0.6875rem] text-blunder">{create.error.message}</p>
        ) : null}
      </form>
    </section>
  )
}

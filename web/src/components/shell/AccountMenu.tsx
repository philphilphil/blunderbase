import { Bot, CircleHelp, KeyRound, LogOut, User, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { useLogout, useProfile } from '@/lib/api/queries'
import type { AccountSummary } from '@/lib/api/types'
import { useRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { cn } from '@/lib/utils'
import { ChangePasswordDialog } from '@/routes/auth'

/** How an account writes its own name: the display name it gave, or the handle. */
function nameOf(account: AccountSummary): string {
  return account.display_name ?? account.username
}

/** The connected account the app is about: the owner's, or the busiest one on record. */
function ownerAccount(accounts: AccountSummary[]): AccountSummary | undefined {
  return (
    accounts.find((account) => account.is_owner) ??
    [...accounts].sort((left, right) => (right.games ?? 0) - (left.games ?? 0))[0]
  )
}

const ITEM =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.6875rem] text-soft transition-colors hover:bg-raised hover:text-ink'

/**
 * The 24px avatar square every design frame ends the titlebar with, now that there is
 * something behind it: the owner's session.
 *
 * The chip is a plain person icon — initials read as an identity the app does not have,
 * and the accessible name already says whose installation this is. The menu it opens
 * heads with every connected account, then the deployment's own settings, the MCP config an
 * assistant is handed, the page explaining what the engines are doing, signing out and
 * changing the password: everything an owner does to or asks about their installation
 * rather than about their games.
 */
export function AccountMenu() {
  const capabilities = useRuntimeCapabilities()
  const profile = useProfile()
  const logout = useLogout()
  const [open, setOpen] = useState(false)
  const [changing, setChanging] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  const accounts = profile.data?.accounts ?? []
  const account = ownerAccount(accounts)
  const name = account ? nameOf(account) : null
  const label = account
    ? `${name} · ${account.platform}`
    : 'No account connected — connect one on the import page'

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={container} className="relative flex-none">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account — ${label}`}
        title={label}
        onClick={() => setOpen((was) => !was)}
        className="flex size-6 items-center justify-center rounded-md border border-edge-strong bg-avatar text-[0.625rem] font-semibold text-soft transition-colors hover:border-edge-hover hover:text-ink"
      >
        <User className="size-3" aria-hidden />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="bb-card absolute right-0 top-[calc(100%+0.4375rem)] z-40 flex w-[13.5rem] flex-col gap-0.5 p-1 shadow-[0_0.75rem_2rem_var(--bb-shadow)]"
        >
          {/*
            Every connected account, not just the owner's: the import page can attach more
            than one, and the menu is where you check which of them this library is made of.
          */}
          <div className="flex flex-col gap-1 px-2 pb-1 pt-1.5">
            {accounts.length === 0 ? (
              <>
                <p className="truncate text-[0.6875rem] font-medium text-ink">
                  No account connected
                </p>
                <p className="truncate text-[0.625rem] text-dim">
                  {capabilities.password_auth ? 'signed in as the owner' : 'local library'}
                </p>
              </>
            ) : (
              accounts.map((connected) => (
                <div key={connected.id} className="flex items-baseline gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.6875rem] font-medium text-ink">
                      {nameOf(connected)}
                    </p>
                    <p className="truncate text-[0.625rem] text-dim">
                      {connected.platform}
                      {connected.is_owner ? ' · owner' : ''}
                    </p>
                  </div>
                  <span className="font-mono text-[0.625rem] tabular text-dim-2">
                    {connected.games === undefined ? '—' : connected.games.toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </div>
          <div className="my-0.5 h-px bg-hairline" />

          <Link to="/library/import" role="menuitem" className={ITEM} onClick={() => setOpen(false)}>
            <Users className="size-3.5" aria-hidden />
            Connected accounts
          </Link>
          {capabilities.mcp ? (
            <Link
              to="/assistant"
              role="menuitem"
              className={ITEM}
              onClick={() => setOpen(false)}
            >
              <Bot className="size-3.5" aria-hidden />
              Assistant
            </Link>
          ) : null}
          <Link to="/help" role="menuitem" className={ITEM} onClick={() => setOpen(false)}>
            <CircleHelp className="size-3.5" aria-hidden />
            How analysis works
          </Link>
          {capabilities.password_auth ? (
            <>
              <button
                type="button"
                role="menuitem"
                className={ITEM}
                onClick={() => {
                  setOpen(false)
                  setChanging(true)
                }}
              >
                <KeyRound className="size-3.5" aria-hidden />
                Change password
              </button>
              <button
                type="button"
                role="menuitem"
                className={cn(ITEM, 'hover:text-blunder')}
                disabled={logout.isPending}
                onClick={() => {
                  setOpen(false)
                  logout.mutate()
                }}
              >
                <LogOut className="size-3.5" aria-hidden />
                Sign out
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {capabilities.password_auth && changing ? (
        <ChangePasswordDialog onClose={() => setChanging(false)} />
      ) : null}
    </div>
  )
}

import { KeyRound, LogOut, User, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { useLogout, useProfile } from '@/lib/api/queries'
import type { AccountSummary } from '@/lib/api/types'
import { cn } from '@/lib/utils'
import { ChangePasswordDialog } from '@/routes/auth'

/** `kn1ghtmare` -> `KN`, `Sofia Grover` -> `SG` — the design's 24px avatar square. */
export function initialsOf(account: AccountSummary | undefined): string {
  const name = account?.display_name?.trim() || account?.username?.trim()
  if (!name) return ''
  const words = name.split(/[\s_.-]+/).filter(Boolean)
  const initials =
    words.length > 1 ? `${words[0][0]}${words[1][0]}` : name.replace(/\s/g, '').slice(0, 2)
  return initials.toUpperCase()
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
 * The chip itself is unchanged — the identity it can honestly show is still the connected
 * chess account, not a user record — and the menu it opens is where signing out and
 * changing the password live, because those are the only two things an owner ever does to
 * their own session.
 */
export function AccountMenu() {
  const profile = useProfile()
  const logout = useLogout()
  const [open, setOpen] = useState(false)
  const [changing, setChanging] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  const account = ownerAccount(profile.data?.accounts ?? [])
  const initials = initialsOf(account)
  const name = account ? (account.display_name ?? account.username) : null
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
        {initials || <User className="size-3" aria-hidden />}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="bb-card absolute right-0 top-[calc(100%+0.4375rem)] z-40 flex w-[13.5rem] flex-col gap-0.5 p-1 shadow-[0_0.75rem_2rem_var(--bb-shadow)]"
        >
          <div className="px-2 pb-1 pt-1.5">
            <p className="truncate text-[0.6875rem] font-medium text-ink">
              {name ?? 'No account connected'}
            </p>
            <p className="truncate text-[0.625rem] text-dim">
              {account ? account.platform : 'signed in as the owner'}
            </p>
          </div>
          <div className="my-0.5 h-px bg-hairline" />

          <Link to="/import" role="menuitem" className={ITEM} onClick={() => setOpen(false)}>
            <Users className="size-3.5" aria-hidden />
            Connected accounts
          </Link>
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
        </div>
      ) : null}

      {changing ? <ChangePasswordDialog onClose={() => setChanging(false)} /> : null}
    </div>
  )
}

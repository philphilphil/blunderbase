import { describe, expect, it } from 'vitest'

import type { AccountSummary, ImportJob } from '@/lib/api/types'

import { accountFor } from './accountFor'

function account(id: number, username: string, extra: Partial<AccountSummary> = {}) {
  return { id, platform: 'lichess', username, is_owner: true, games: 0, ...extra } as AccountSummary
}

function job(extra: Partial<ImportJob>): ImportJob {
  return {
    id: 1,
    source: 'lichess',
    status: 'done',
    created_at: '2026-09-27T10:00:00Z',
    games_seen: 0,
    games_imported: 0,
    games_skipped: 0,
    games_blocked: 0,
    games_failed: 0,
    errors: [],
    ...extra,
  }
}

describe('accountFor', () => {
  // The case that pinned a typo in the box: an empty row made by a mistyped Connect,
  // older than the account that actually holds the games.
  const typo = account(1, 'phibb')
  const real = account(2, 'phib', { games: 812 })

  it('shows the account with the games, not the oldest row', () => {
    expect(accountFor([typo, real], 'lichess')?.username).toBe('phib')
  })

  it('shows the account the newest sync named', () => {
    expect(accountFor([typo, real], 'lichess', job({ account_id: 1 }))?.username).toBe('phibb')
  })

  it('does not follow a sync that failed', () => {
    const failed = job({ account_id: 1, status: 'failed' })
    expect(accountFor([typo, real], 'lichess', failed)?.username).toBe('phib')
  })

  it("prefers the owner's account over an opponent's row", () => {
    const opponent = account(3, 'rival', { is_owner: false, games: 40 })
    expect(accountFor([opponent, typo], 'lichess')?.username).toBe('phibb')
  })

  it('looks at one platform only', () => {
    const elsewhere = account(4, 'phib', { platform: 'chesscom', games: 5000 })
    expect(accountFor([elsewhere, real], 'lichess')?.id).toBe(2)
    expect(accountFor([real], 'fics')).toBeUndefined()
  })
})

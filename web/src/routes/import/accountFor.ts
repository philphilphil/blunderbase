import type { AccountSummary, ImportJob, Platform } from '@/lib/api/types'

/**
 * Which of a platform's accounts its source box shows.
 *
 * The box used to take the oldest row, and an older importer registered the owner's
 * account before the site had answered for the name — so one mistyped Connect pinned the
 * typo in the box for good, with the real account hidden behind it. What the box wants is
 * the account the owner actually syncs: the one the source's newest sync named, unless
 * that sync failed; else the owner's account with the most games; else any row there is.
 */
export function accountFor(
  accounts: AccountSummary[],
  platform: Platform,
  lastJob?: ImportJob,
): AccountSummary | undefined {
  const rows = accounts.filter((account) => account.platform === platform)
  if (lastJob && lastJob.status !== 'failed' && lastJob.account_id != null) {
    const named = rows.find((account) => account.id === lastJob.account_id)
    if (named) return named
  }
  const owned = rows.filter((account) => account.is_owner !== false)
  let best: AccountSummary | undefined
  for (const account of owned.length > 0 ? owned : rows) {
    if (!best || (account.games ?? 0) > (best.games ?? 0)) best = account
  }
  return best
}

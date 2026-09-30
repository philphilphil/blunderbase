import type { ImportJob } from '@/lib/api/types'

import type { SyncOptions } from './SourcesPanel'

/**
 * The username a previous sync used, if that sync got far enough to record one.
 *
 * `ImportJob.message` carries the username the account adapter was given, but a failed
 * job overwrites it with the exception text
 * (`services/import_service.py`), so a failed sync must never seed the field or the next
 * Connect would post `AdapterError: …` as the username and fail again.
 */
export function usernameOf(job: ImportJob | undefined): string | undefined {
  if (!job || job.status === 'failed') return undefined
  return job.message?.trim() || undefined
}

/**
 * What one account's sync is told, from the Accounts head. Shared by a box's own Sync and
 * by Sync all, so the head's Since / Max games / options mean the same thing to both.
 */
export function syncBody(username: string, options: SyncOptions) {
  const games = Number.parseInt(options.maxGames, 10)
  return {
    // `all` is what every adapter takes for "ignore the stored cursor and read the
    // archive from its first game" (`backend/adapters/__init__.py`). It beats the date,
    // which is the other answer to the same question.
    username,
    since: options.fromTheBeginning ? 'all' : options.since.trim() || undefined,
    max_games: Number.isFinite(games) && games > 0 ? games : undefined,
    // Only ever sent to turn evaluation off; left out, the backend queues the pass.
    analyze: options.skipEvaluation ? false : undefined,
  }
}

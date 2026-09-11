/**
 * The deployment's `AppSettings`, as the screens that edit a slice of it need them.
 *
 * Three screens own part of these values — Engine passes, Maia and Correspondence
 * — and `PUT /settings` replaces the lot: an omitted field is a cleared one. So none of
 * them may send just what it edits, and `completeUpdate` is the one place that says what
 * "everything else, untouched" means. The rest is the reading and writing of a number in a
 * box, which is the same three lines wherever it appears.
 */
import type { AppSettings, AppSettingsUpdate } from './types'
import { DEFAULT_MAIA_TARGET_ELO } from './types'

/**
 * The defaults the backend falls back to under an empty box (`services/app_settings.py`).
 * Repeated here rather than fetched because they are what a *page* has to say about a
 * field nobody has set, and a second call to learn them would leave the form blank while
 * it landed.
 */
export const SETTING_DEFAULTS = {
  maia_target_elo: DEFAULT_MAIA_TARGET_ELO,
  maia_on_quick: 1,
  maia_on_deep: 0,
  maia_both_sides: 1,
  quick_nodes: 250_000,
  deep_nodes: 2_000_000,
  deep_multipv: 4,
  inaccuracy_threshold: 5,
  mistake_threshold: 10,
  blunder_threshold: 15,
  correspondence_enabled: 0,
  correspondence_multipv: 3,
  correspondence_slots: 2,
  correspondence_task_nodes: 40_000_000,
  correspondence_task_multipv: 3,
  correspondence_stale_depth: 30,
} as const

/** What a box holds: a number, or the empty string that means "nobody has set this". */
export function parseSetting(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/** One stored setting as text for its box. The list of Maia levels is not one of these. */
export function settingText(settings: AppSettings | undefined, key: keyof AppSettings): string {
  const value = settings?.[key]
  return value === null || value === undefined || Array.isArray(value) ? '' : String(value)
}

/** Every setting as it stands, so a page that changes one does not clear the others. */
export function completeUpdate(settings: AppSettings): AppSettingsUpdate {
  return {
    maia_target_elo: null,
    maia_elos: settings.maia_elos ?? [settings.maia_target_elo],
    maia_on_quick: settings.maia_on_quick,
    maia_on_deep: settings.maia_on_deep,
    maia_both_sides: settings.maia_both_sides,
    quick_nodes: settings.quick_nodes,
    deep_nodes: settings.deep_nodes,
    deep_multipv: settings.deep_multipv,
    inaccuracy_threshold: settings.inaccuracy_threshold,
    mistake_threshold: settings.mistake_threshold,
    blunder_threshold: settings.blunder_threshold,
    // Correspondence mode's nine. A settings form that left them out would switch the
    // mode off on its next save — the PUT is a replace, and an absent key is a cleared one.
    // The engine list and the task engine are the two identities here, and are carried
    // whole for the same reason `maia_elos` is: a save of the Engine passes page must not
    // empty the search picker or unassign the engine the tasks run on.
    correspondence_enabled: settings.correspondence_enabled ?? null,
    correspondence_multipv: settings.correspondence_multipv ?? null,
    correspondence_slots: settings.correspondence_slots ?? null,
    correspondence_search_engine_ids: settings.correspondence_search_engine_ids ?? [],
    correspondence_task_nodes: settings.correspondence_task_nodes ?? null,
    correspondence_task_multipv: settings.correspondence_task_multipv ?? null,
    correspondence_stale_depth: settings.correspondence_stale_depth ?? null,
    correspondence_task_engine_id: settings.correspondence_task_engine_id ?? null,
  }
}

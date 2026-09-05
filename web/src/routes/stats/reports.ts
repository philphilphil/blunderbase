/**
 * Design 2d's "Reports" rail: the stats screen is one report at a time, not one long
 * scroll. Overview is the design's own 2×2 — phase, time control, clock, progress — and
 * the dimensions that did not fit it live under a report of their own.
 *
 * The choice rides in the URL (`/stats?report=…`) so the sidebar can drive the page
 * without either of them owning the other's state.
 *
 * The design's fourth report is `Opponents`. `services.stats.DIMENSIONS` has no opponent
 * aggregation — phase, piece, speed, hour, time trouble and rating trend are the six it
 * knows — so that slot carries `Progress` (`rating_trend`), which the design draws as a
 * card but gives no report of its own. A report that answered nothing would be a dead row
 * in the rail.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'

export type ReportKey = 'overview' | 'blunders' | 'clock' | 'progress'

export interface Report {
  key: ReportKey
  label: MessageDescriptor
  /** The sentence under the page title while this report is open. */
  hint: MessageDescriptor
}

export const REPORTS: Report[] = [
  {
    key: 'overview',
    label: msg`Overview`,
    hint: msg`phase, time control, time trouble, progress`,
  },
  {
    key: 'blunders',
    label: msg`Blunder taxonomy`,
    hint: msg`where they happen and what moves them`,
  },
  { key: 'clock', label: msg`Clock behaviour`, hint: msg`time trouble and time of day` },
  { key: 'progress', label: msg`Progress`, hint: msg`rating over the window` },
]

export const DEFAULT_REPORT: ReportKey = 'overview'

/** The report a query string names, or the default for anything unrecognised. */
export function reportFrom(params: URLSearchParams | string | null | undefined): ReportKey {
  const value =
    typeof params === 'string'
      ? new URLSearchParams(params).get('report')
      : (params?.get('report') ?? null)
  return REPORTS.some((report) => report.key === value) ? (value as ReportKey) : DEFAULT_REPORT
}

/**
 * Page-local wording for the Runners section.
 *
 * Kept out of the components so the sentences a runner card puts on screen can be read —
 * and asserted — on their own. `transport` is the whole of the difference between a
 * machine that can drive an analysis board and one that can only take queue work.
 */
import { t } from '@lingui/core/macro'

import type { RunnerResponse } from '@/lib/api/types'

export type RunnerTone = 'connected' | 'degraded' | 'away'

export interface RunnerStatusLabel {
  label: string
  tone: RunnerTone
}

/**
 * What the status pill says. A poll-mode link is *connected* and still cannot open a
 * stream, which is the one thing a glance at this section has to make obvious.
 */
export function statusLabel(runner: RunnerResponse): RunnerStatusLabel {
  if (!runner.connected) return { label: t`not connected`, tone: 'away' }
  if (runner.transport === 'poll') {
    return { label: t`connected · polling — queue only`, tone: 'degraded' }
  }
  return { label: t`connected · websocket`, tone: 'connected' }
}

/** `2/4 slots` — queue runs and analysis boards together, against the cap. */
export function slotLabel(runner: RunnerResponse): string {
  const used = runner.busy + runner.streams
  const total = runner.slots
  return t`${used}/${total} slots`
}

/** Slots in use, split the way the bar draws them. */
export function slotShares(runner: RunnerResponse): {
  busy: number
  streams: number
  free: number
} {
  const slots = Math.max(runner.slots, runner.busy + runner.streams, 1)
  const busy = Math.min(runner.busy, slots)
  const streams = Math.min(runner.streams, slots - busy)
  return {
    busy: (busy / slots) * 100,
    streams: (streams / slots) * 100,
    free: ((slots - busy - streams) / slots) * 100,
  }
}

/** Whether this machine can drive an analysis board at all, whatever its engines are. */
export function canStream(runner: RunnerResponse): boolean {
  return runner.connected && runner.transport !== 'poll'
}

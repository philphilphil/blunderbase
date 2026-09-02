/**
 * "Sync automatically every N minutes" — the Sync button on a clock.
 *
 * One switch and one number, under the sources table because that is what it repeats:
 * every connected account above, from its last cursor, pressed for you. It is a
 * deployment setting rather than one of the strip's per-run options, which is why it has a
 * footer of its own instead of a place in the strip — ticking "from the beginning" is
 * about the next press, ticking this is about every press from now on.
 *
 * The box shows what is in force, not what was typed: the backend floors the number, and
 * the answer to a save is what it kept. Off leaves the last number in the box, greyed, so
 * switching back on does not start from a blank.
 */
import { useEffect, useState } from 'react'

import { Input } from '@/components/ui/input'
import { useSyncSchedule, useUpdateSyncSchedule } from '@/lib/api/queries'

import { SyncCheckbox } from './SyncCheckbox'

/** What the box says the first time the switch is thrown. Often enough to feel live. */
export const DEFAULT_MINUTES = 30

function wholeMinutes(draft: string): number | null {
  const parsed = Number.parseInt(draft, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function AutoSyncControl() {
  const schedule = useSyncSchedule()
  const update = useUpdateSyncSchedule()
  const minutes = schedule.data?.minutes ?? null
  const on = minutes !== null
  const [draft, setDraft] = useState('')

  // The server's number wins whenever it changes: a floor applied, another tab's save.
  useEffect(() => {
    if (minutes !== null) setDraft(String(minutes))
  }, [minutes])

  function toggle(next: boolean) {
    update.mutate({ minutes: next ? (wholeMinutes(draft) ?? DEFAULT_MINUTES) : null })
  }

  function commit() {
    if (!on) return
    const wanted = wholeMinutes(draft) ?? minutes
    setDraft(String(wanted))
    if (wanted !== minutes) update.mutate({ minutes: wanted })
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-hairline px-3.5 py-2.5">
      <SyncCheckbox
        label="Sync automatically"
        title="Every connected account above, from its last cursor, on this clock — the same as pressing Sync on each row. The history below records every run."
        checked={on}
        onChange={toggle}
        disabled={schedule.isPending || update.isPending}
      />
      <span className={on ? 'text-[0.6875rem] text-soft' : 'text-[0.6875rem] text-dim'}>every</span>
      <Input
        aria-label="Minutes between syncs"
        value={draft}
        inputMode="numeric"
        placeholder={String(DEFAULT_MINUTES)}
        disabled={!on || update.isPending}
        className="h-7 w-16 font-mono"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          commit()
        }}
      />
      <span className={on ? 'text-[0.6875rem] text-soft' : 'text-[0.6875rem] text-dim'}>
        minutes
      </span>
      {update.isError ? (
        <span className="text-[0.6875rem] text-blunder">{update.error.message}</span>
      ) : null}
    </div>
  )
}

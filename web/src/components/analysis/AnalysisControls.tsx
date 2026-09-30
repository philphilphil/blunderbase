import { useEffect } from 'react'
import { ApiError } from '@/lib/api/client'
import { listEngineRoles } from '@/lib/api/endpoints'
import { useEngineSetup } from './useEngineSetup'

import { plural } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'

import { PickerSelect } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import type { StreamSessionApi } from '@/lib/analysis'
import type { EngineHost } from '@/lib/engines/hosts'
import { cn } from '@/lib/utils'

/**
 * The live search's on/off, and the Maia-on-analysis setting: the app's one `Switch`
 * (components/ui/switch.tsx) with its label kept for screen readers, since every row it
 * sits in already says what it switches. A mode that persists is a switch, never a pressed
 * button or a lit chip (docs/design/README.md, "Controls").
 *
 * Kept under its old name and API so the settings pages that import it need not change.
 * The switch's focus is the global ring around its track, never a fill.
 */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  title,
  className,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
  title?: string
  className?: string
}) {
  return (
    <Switch
      checked={checked}
      onCheckedChange={onChange}
      label={label}
      hideLabel
      disabled={disabled}
      title={title}
      className={className}
    />
  )
}

/**
 * How one engine reads in the picker. Only engines that can drive a board right now are
 * listed — the picker is a choice, and a row that cannot be chosen is noise in it. Why an
 * engine is queue-only is the Engines page's business.
 */
export function engineOptionLabel(host: EngineHost): string {
  // The host is always named, `local` included: a list that only qualifies the remote ones
  // reads as though the bare names were somehow the default, and two engines of the same
  // name on two machines is the ordinary case this picker exists for.
  return `${host.name} · ${host.runnerName ?? 'local'}`
}

/**
 * The picker's first option: no engine named, so the server's analysis role decides. Who
 * that is can only be known from a session that is actually open, so before the first one
 * the option says what it does rather than who. One helper because the footer picker and
 * the engine pane's title strip both carry this option, and must never word it apart.
 */
export function useDefaultEngineLabel(stream: StreamSessionApi): string {
  const { t } = useLingui()
  const name = stream.engineId === null ? (stream.session?.engine ?? null) : null
  return name ? t`analysis engine — ${name}` : t`analysis engine`
}

/** The line counts a search can report, as picker options ("3 lines"). */
function useLineOptions() {
  const { t } = useLingui()
  return [1, 2, 3, 4, 5].map((lines) => ({
    value: String(lines),
    label: t`${plural(lines, { one: '# line', other: '# lines' })}`,
  }))
}

interface ControlProps {
  stream: StreamSessionApi
  /** null ⇒ nothing on the board, so there is nothing to analyse. */
  fen: string | null
  className?: string
}

/**
 * The setup dialog behind whatever starts the search, and the effect that opens it.
 *
 * A hook rather than part of `LiveSwitch` because the game page starts its search from the
 * engine pane's Live tab, not a switch. Whichever control a surface uses must call this
 * exactly once per stream: the effect opens the dialog, and two would open it twice.
 */
export function useLiveSetup(stream: StreamSessionApi) {
  const setup = useEngineSetup()
  const { error, resume } = stream
  const { show } = setup
  // Switching the board on with no engine behind it is a missing step, not a failure, so
  // it opens the same setup dialog Analyse… does and turns the board on once Stockfish
  // is there. Two refusals reach here. `browser_engine_missing` is this tab's own — the
  // demo's board never asked a server — and needs no confirming. `stream_unavailable` is
  // the server's, and is the *same* status whether the analysis role has no engine or its
  // engine is simply away, so the roles are read to tell which; only the first is
  // something a browser engine fixes, and the second stays the sentence the panel shows.
  useEffect(() => {
    if (!(error instanceof ApiError)) return
    if (error.error === 'browser_engine_missing') return show(resume)
    if (error.error !== 'stream_unavailable') return
    let cancelled = false
    void listEngineRoles()
      .then((roles) => {
        if (cancelled) return
        if (roles.roles.some((role) => role.role === 'analysis' && !role.configured)) {
          show(resume)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [error, resume, show])
  return setup.dialog
}

/**
 * The switch that opens and closes the search, and the setup dialog behind it.
 *
 * Its own component rather than a line of `AnalysisControls` so a surface can place it apart
 * from the pickers. The dialog rides with the switch (`useLiveSetup`), since the switch is
 * the one control such a surface has exactly one of.
 */
export function LiveSwitch({ stream, fen, className }: ControlProps) {
  const { t } = useLingui()
  const dialog = useLiveSetup(stream)
  const idle = fen === null || fen === ''

  return (
    <>
      {dialog}
      <Toggle
        checked={stream.enabled}
        onChange={stream.setEnabled}
        label={t`Analyse this position continuously`}
        disabled={idle}
        title={idle ? t`nothing is on the board` : t`Analyse this position continuously`}
        className={className}
      />
    </>
  )
}

/**
 * Which engine runs the search and how many lines it reports. Nothing here opens a search;
 * a change while one is running is applied to it, and before one the choice waits.
 *
 * Pickers (`PickerSelect`: the picker's face and ⇅ over the native select), because this
 * is a control row and not a form: a toolbar shows one picker look whatever the list is.
 */
export function LivePickers({ stream, fen, className }: ControlProps) {
  const { t } = useLingui()
  const idle = fen === null || fen === ''
  const defaultLabel = useDefaultEngineLabel(stream)
  const lineOptions = useLineOptions()
  const engineOptions = [
    { value: '', label: defaultLabel },
    ...stream.engines
      .filter((host) => host.streams)
      .map((host) => ({ value: String(host.engineId), label: engineOptionLabel(host) })),
  ]
  const why = idle ? t`Nothing is on the board to analyse` : undefined

  return (
    <div className={cn('flex min-w-0 flex-1 flex-wrap items-center gap-2', className)}>
      <PickerSelect
        label={t`Engine`}
        value={stream.engineId === null ? '' : String(stream.engineId)}
        options={engineOptions}
        disabled={idle}
        title={why}
        onChange={(value) => stream.setEngineId(value === '' ? null : Number(value))}
        // Engine names carry a host and sometimes a reason, so this one takes whatever the
        // row has left; the value truncates rather than wrapping the row.
        className="min-w-0 max-w-full shrink [&>span]:truncate"
      />
      <PickerSelect
        label={t`Lines`}
        hideLabel
        value={String(stream.multipv)}
        options={lineOptions}
        disabled={idle}
        title={why}
        onChange={(value) => stream.setMultipv(Number(value))}
      />
    </div>
  )
}

/**
 * How many lines the search reports, on the engine pane's Live tab, where the run's own
 * `MPV 3` readout stands on the other tab. It is the same fact about the other claim, but
 * this one can be changed, so it is a strip picker (⇅, a face on hover) and `MPV 3` a flat
 * readout: a reader should see which is which.
 */
export function LiveLinesChip({ stream, className }: { stream: StreamSessionApi; className?: string }) {
  const { t } = useLingui()
  const lineOptions = useLineOptions()
  return (
    <span data-testid="live-lines-chip" className={cn('inline-flex flex-none', className)}>
      <PickerSelect
        label={t`Lines`}
        hideLabel
        size="strip"
        value={String(stream.multipv)}
        options={lineOptions}
        onChange={(value) => stream.setMultipv(Number(value))}
      />
    </span>
  )
}

/**
 * The three things a live search is steered by, on one row: whether it runs at all, which
 * engine runs it, and how many lines it reports.
 */
export function AnalysisControls({ stream, fen, className }: ControlProps) {
  return (
    // The switch leads: it is the one control that decides whether the other two matter, and
    // on a narrow rail it is the one that must never be the thing that wraps away.
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <LiveSwitch stream={stream} fen={fen} />
      <LivePickers stream={stream} fen={fen} />
    </div>
  )
}

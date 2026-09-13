import { useEffect } from 'react'
import { ApiError } from '@/lib/api/client'
import { listEngineRoles } from '@/lib/api/endpoints'
import { useEngineSetup } from './useEngineSetup'

import { Plural, useLingui } from '@lingui/react/macro'
import { ChevronDown } from 'lucide-react'

import type { StreamSessionApi } from '@/lib/analysis'
import type { EngineHost } from '@/lib/engines/hosts'
import { cn } from '@/lib/utils'

/**
 * The switch the Engines page uses, grown to the size a footer row can carry: the track is
 * what reads as on or off, and the button around it is a full row-height hit target so the
 * switch is no harder to hit than the pickers beside it.
 *
 * Exported because the Maia configuration needs the same switch beside a label and a caption,
 * and a third spelling of an on/off track is a third thing to keep in step with the theme.
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
  /** For a host whose row is shorter than the 2rem footer row this switch was sized for. */
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex h-8 flex-none items-center rounded-md px-1.5 transition-colors',
        'hover:bg-raised disabled:opacity-50 disabled:hover:bg-transparent',
        'outline-none focus-visible:bg-raised',
        className,
      )}
    >
      <span
        className={cn(
          'inline-flex h-5 w-9 flex-none items-center rounded-full border p-px transition-colors',
          checked ? 'border-accent-teal/50 bg-accent-teal/25' : 'border-edge-strong bg-elevated',
        )}
      >
        <span
          className={cn(
            'size-4 rounded-full transition-transform',
            checked ? 'translate-x-4 bg-accent-teal' : 'translate-x-0 bg-faint',
          )}
        />
      </span>
    </button>
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

// Pickers you can actually hit: a 2rem row, text at the size the rest of the panel reads
// at, and room around it. Anything smaller was a target you had to aim for.
const SELECT_CLASS =
  'h-8 rounded-md border border-input bg-elevated px-2 text-xs text-soft outline-none transition-colors hover:border-edge-hover focus-visible:border-accent-teal/50 disabled:opacity-50'

interface ControlProps {
  stream: StreamSessionApi
  /** null ⇒ nothing on the board, so there is nothing to analyse. */
  fen: string | null
  className?: string
}

/**
 * The switch that opens and closes the search, and the setup dialog behind it.
 *
 * Its own component rather than a line of `AnalysisControls` because the game page puts the
 * switch in a pane's title strip and the two pickers in that pane's body, two places one
 * flex row cannot reach. The dialog rides with the switch, and only with it: the effect
 * that opens it must run exactly once per stream, and the switch is the one control every
 * surface has exactly one of.
 */
export function LiveSwitch({ stream, fen, className }: ControlProps) {
  const { t } = useLingui()
  const setup = useEngineSetup()
  const { error, resume } = stream
  const { show } = setup
  // Switching the board on with no engine behind it is a missing step, not a failure, so
  // it opens the same setup dialog Quick and Deep do and turns the board on once Stockfish
  // is there. Two refusals reach here. `browser_engine_missing` is this tab's own — the
  // demo's board never asked a server — and needs no confirming. `stream_unavailable` is
  // the server's, and is the *same* status whether the deep role has no engine or its
  // engine is simply away, so the roles are read to tell which; only the first is
  // something a browser engine fixes, and the second stays the sentence the panel shows.
  useEffect(() => {
    if (!(error instanceof ApiError)) return
    if (error.error === 'browser_engine_missing') return show('deep', resume)
    if (error.error !== 'stream_unavailable') return
    let cancelled = false
    void listEngineRoles()
      .then((roles) => {
        if (cancelled) return
        if (roles.roles.some((role) => role.role === 'deep' && !role.configured)) {
          show('deep', resume)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [error, resume, show])
  const idle = fen === null || fen === ''

  return (
    <>
      {setup.dialog}
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
 */
export function LivePickers({ stream, fen, className }: ControlProps) {
  const { t } = useLingui()
  const idle = fen === null || fen === ''
  // The name the server resolved "the deep tier" to. It is only knowable from a session
  // that is actually open, so before the first one the option says what it does, not who.
  const deepName = stream.engineId === null ? stream.session?.engine ?? null : null

  return (
    <div className={cn('flex min-w-0 flex-1 flex-wrap items-center gap-2', className)}>
      <select
        aria-label={t`Engine`}
        value={stream.engineId === null ? '' : String(stream.engineId)}
        disabled={idle}
        onChange={(event) =>
          stream.setEngineId(event.target.value === '' ? null : Number(event.target.value))
        }
        // Engine names carry a host and sometimes a reason, so this one takes whatever the
        // row has left, and never less than enough for a name to be read.
        className={cn(SELECT_CLASS, 'min-w-40 flex-1 truncate')}
      >
        <option value="">{deepName ? t`deep tier — ${deepName}` : t`deep tier`}</option>
        {stream.engines
          .filter((host) => host.streams)
          .map((host) => (
            <option key={host.engineId} value={String(host.engineId)}>
              {engineOptionLabel(host)}
            </option>
          ))}
      </select>

      <select
        aria-label={t`Lines`}
        value={String(stream.multipv)}
        disabled={idle}
        onChange={(event) => stream.setMultipv(Number(event.target.value))}
        className={cn(SELECT_CLASS, 'w-[5.5rem] flex-none tabular')}
      >
        {[1, 2, 3, 4, 5].map((lines) => (
          <option key={lines} value={String(lines)}>
            <Plural value={lines} one="# line" other="# lines" />
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * How many lines the search reports, as a chip with the select laid over it — the shape
 * of the run's own `MPV 3` chip, in the same strip, because it is the same fact about the
 * other claim. A 2rem select beside three mono readouts was the one thing on the engine
 * pane's title that did not belong to it.
 */
export function LiveLinesChip({ stream, className }: { stream: StreamSessionApi; className?: string }) {
  const { t } = useLingui()
  // Named, so the message is the one the picker's options already carry ("{lines, …}").
  const lines = stream.multipv
  return (
    <span
      data-testid="live-lines-chip"
      className={cn(
        'relative inline-flex flex-none items-center gap-0.5 rounded-sm border border-edge px-[0.3125rem] py-px font-mono text-[0.625rem] tabular text-dim hover:border-edge-hover hover:text-soft',
        className,
      )}
    >
      <Plural value={lines} one="# line" other="# lines" />
      <ChevronDown className="size-2.5 flex-none text-faint" aria-hidden />
      <select
        aria-label={t`Lines`}
        value={String(stream.multipv)}
        onChange={(event) => stream.setMultipv(Number(event.target.value))}
        className="absolute inset-0 w-full cursor-pointer appearance-none opacity-0"
      >
        {[1, 2, 3, 4, 5].map((lines) => (
          <option key={lines} value={String(lines)}>
            <Plural value={lines} one="# line" other="# lines" />
          </option>
        ))}
      </select>
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

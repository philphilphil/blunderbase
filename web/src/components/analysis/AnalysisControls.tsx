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
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
  title?: string
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

/**
 * The three things a live search is steered by: whether it runs at all, which engine runs
 * it, and how many lines it reports.
 */
export function AnalysisControls({
  stream,
  fen,
  className,
}: {
  stream: StreamSessionApi
  /** null ⇒ nothing on the board, so there is nothing to analyse. */
  fen: string | null
  className?: string
}) {
  const idle = fen === null || fen === ''
  // The name the server resolved "the deep tier" to. It is only knowable from a session
  // that is actually open, so before the first one the option says what it does, not who.
  const deepName = stream.engineId === null ? stream.session?.engine ?? null : null

  return (
    // The switch leads: it is the one control that decides whether the other two matter, and
    // on a narrow rail it is the one that must never be the thing that wraps away.
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Toggle
        checked={stream.enabled}
        onChange={stream.setEnabled}
        label="Analyse this position continuously"
        disabled={idle}
        title={idle ? 'nothing is on the board' : 'Analyse this position continuously'}
      />

      <select
        aria-label="Engine"
        value={stream.engineId === null ? '' : String(stream.engineId)}
        disabled={idle}
        onChange={(event) =>
          stream.setEngineId(event.target.value === '' ? null : Number(event.target.value))
        }
        // Engine names carry a host and sometimes a reason, so this one takes whatever the
        // row has left, and never less than enough for a name to be read.
        className={cn(SELECT_CLASS, 'min-w-40 flex-1 truncate')}
      >
        <option value="">{deepName ? `deep tier — ${deepName}` : 'deep tier'}</option>
        {stream.engines
          .filter((host) => host.streams)
          .map((host) => (
            <option key={host.engineId} value={String(host.engineId)}>
              {engineOptionLabel(host)}
            </option>
          ))}
      </select>

      <select
        aria-label="Lines"
        value={String(stream.multipv)}
        disabled={idle}
        onChange={(event) => stream.setMultipv(Number(event.target.value))}
        className={cn(SELECT_CLASS, 'w-[5.5rem] flex-none tabular')}
      >
        {[1, 2, 3, 4, 5].map((lines) => (
          <option key={lines} value={String(lines)}>
            {lines} {lines === 1 ? 'line' : 'lines'}
          </option>
        ))}
      </select>
    </div>
  )
}

import type { StreamSessionApi } from '@/lib/analysis'
import type { EngineHost } from '@/lib/engines/hosts'
import { cn } from '@/lib/utils'

/** The same switch the Engines page uses, at the size the panel header can carry. */
function Toggle({
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
        'inline-flex h-[1.125rem] w-8 flex-none items-center rounded-full border p-px transition-colors disabled:opacity-50',
        checked ? 'border-accent-teal/40 bg-accent-teal/25' : 'border-edge bg-elevated',
      )}
    >
      <span
        className={cn(
          'size-3.5 rounded-full transition-transform',
          checked ? 'translate-x-3.5 bg-accent-teal' : 'translate-x-0 bg-faint',
        )}
      />
    </button>
  )
}

/**
 * How one engine reads in the picker. An engine that cannot drive a board right now keeps
 * its place in the list, disabled, wearing the backend's own sentence for why — a name
 * quietly missing would look like the engine had been deleted.
 */
export function engineOptionLabel(host: EngineHost): string {
  // The host is always named, `local` included: a list that only qualifies the remote ones
  // reads as though the bare names were somehow the default, and two engines of the same
  // name on two machines is the ordinary case this picker exists for.
  const where = ` · ${host.runnerName ?? 'local'}`
  const why = host.streams ? '' : ` — ${host.streamsReason ?? 'unavailable'}`
  return `${host.name}${where}${why}`
}

const SELECT_CLASS =
  'h-[1.375rem] rounded-md border border-input bg-elevated px-1 text-[0.6875rem] text-soft outline-none transition-colors hover:border-edge-hover focus-visible:border-accent-teal/50 disabled:opacity-50'

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
    <div className={cn('flex flex-none items-center gap-1.5', className)}>
      <select
        aria-label="Engine"
        value={stream.engineId === null ? '' : String(stream.engineId)}
        disabled={idle}
        onChange={(event) =>
          stream.setEngineId(event.target.value === '' ? null : Number(event.target.value))
        }
        className={cn(SELECT_CLASS, 'max-w-40 truncate')}
      >
        <option value="">{deepName ? `deep tier — ${deepName}` : 'deep tier'}</option>
        {stream.engines.map((host) => (
          <option key={host.engineId} value={String(host.engineId)} disabled={!host.streams}>
            {engineOptionLabel(host)}
          </option>
        ))}
      </select>

      <select
        aria-label="Lines"
        value={String(stream.multipv)}
        disabled={idle}
        onChange={(event) => stream.setMultipv(Number(event.target.value))}
        className={cn(SELECT_CLASS, 'tabular')}
      >
        {[1, 2, 3, 4, 5].map((lines) => (
          <option key={lines} value={String(lines)}>
            {lines} {lines === 1 ? 'line' : 'lines'}
          </option>
        ))}
      </select>

      <Toggle
        checked={stream.enabled}
        onChange={stream.setEnabled}
        label="Analyse this position continuously"
        disabled={idle}
        title={idle ? 'nothing is on the board' : undefined}
      />
    </div>
  )
}

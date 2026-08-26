import { useQuery } from '@tanstack/react-query'
import { Loader2, Play, RefreshCw, Trash2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

import { TierBadge } from '@/components/badges/TierBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { probeEngine } from '@/lib/api/endpoints'
import {
  useDeleteEngine,
  useTestRunEngine,
  useUpdateEngine,
} from '@/lib/api/queries'
import type {
  EngineResponse,
  EngineUpdate,
  SampleRequest,
  Tier,
  TierStatusResponse,
} from '@/lib/api/types'
import { cn } from '@/lib/utils'

import { OptionsEditor } from './OptionsEditor'
import { SampleResult } from './SampleResult'
import { declaredOptions, draftFrom, resolveDraft, type OptionDraft } from './options'

const DEFAULT_NODES = 200_000
const DEFAULT_MULTIPV = 3

/**
 * Probing spawns the binary and waits for its handshake. A UCI engine answers in
 * milliseconds; a Maia model loads a network first and the backend allows it minutes, so
 * that one is asked for rather than assumed.
 */
function autoProbe(engine: EngineResponse): boolean {
  return engine.kind === 'uci'
}

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
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

function Section({
  title,
  aside,
  children,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2.5 border-t border-hairline px-3.5 py-3.5 first:border-t-0">
      <div className="flex items-center gap-2.5">
        <h3 className="text-[0.625rem] tracking-[0.1em] text-faint uppercase">{title}</h3>
        <div className="flex-1" />
        {aside}
      </div>
      {children}
    </section>
  )
}

/** One engine, whole: what it is, what it is set to, and what it says when it is run. */
export function EngineDetail({
  engine,
  tiers,
  onDeleted,
}: {
  engine: EngineResponse
  tiers: TierStatusResponse[]
  onDeleted: () => void
}) {
  const [name, setName] = useState(engine.name)
  const [path, setPath] = useState(engine.path)
  const [tier, setTier] = useState<Tier | ''>(engine.default_tier ?? '')
  const [draft, setDraft] = useState<OptionDraft>(() => draftFrom(engine.options))
  const [probeAsked, setProbeAsked] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [fen, setFen] = useState('')
  const [nodes, setNodes] = useState(String(DEFAULT_NODES))
  const [multipv, setMultipv] = useState(String(DEFAULT_MULTIPV))
  const [ratings, setRatings] = useState('')

  const probe = useQuery({
    // Deliberately outside the `['engines']` prefix: a socket event that invalidates
    // engines must not start a subprocess.
    queryKey: ['engine-probe', engine.path, engine.kind],
    queryFn: () => probeEngine({ path: engine.path, kind: engine.kind }),
    enabled: autoProbe(engine) || probeAsked,
    staleTime: 5 * 60_000,
    retry: false,
  })

  const declared = useMemo(() => declaredOptions(probe.data), [probe.data])
  const resolved = useMemo(
    () => resolveDraft(declared, draft, engine.options),
    [declared, draft, engine.options],
  )

  const update = useUpdateEngine({
    onSuccess: (saved) => {
      setName(saved.name)
      setPath(saved.path)
      setTier(saved.default_tier ?? '')
      setDraft(draftFrom(saved.options))
    },
  })
  const remove = useDeleteEngine({ onSuccess: onDeleted })
  const testRun = useTestRunEngine()

  const renamed = name.trim() !== engine.name
  const repathed = path.trim() !== engine.path
  const retiered = (tier || null) !== (engine.default_tier ?? null)
  // An options change can only be trusted once the probe has said what this binary
  // declares; until then the editor is read-only anyway.
  const optionsChanged = probe.isSuccess && resolved.changed
  const dirty = renamed || repathed || retiered || optionsChanged
  const blocked = Object.keys(resolved.errors).length > 0

  function save() {
    const body: EngineUpdate = {}
    if (renamed) body.name = name.trim()
    if (repathed) body.path = path.trim()
    if (retiered) body.default_tier = tier || null
    if (optionsChanged && resolved.options) body.options = resolved.options
    if (Object.keys(body).length === 0) return
    update.mutate({ id: engine.id, body })
  }

  function run() {
    const body: SampleRequest = {}
    const trimmed = fen.trim()
    if (trimmed) body.fen = trimmed
    const nodeBudget = Number.parseInt(nodes, 10)
    if (Number.isFinite(nodeBudget) && nodeBudget > 0) body.nodes = nodeBudget
    const lines = Number.parseInt(multipv, 10)
    if (Number.isFinite(lines) && lines > 0) body.multipv = lines
    const levels = ratings
      .split(/[,\s]+/)
      .map((level) => Number.parseInt(level, 10))
      .filter((level) => Number.isFinite(level))
    if (engine.kind === 'maia' && levels.length > 0) body.ratings = levels
    testRun.mutate({ id: engine.id, body })
  }

  const claimed = tiers.filter((status) => status.engine_id === engine.id)

  return (
    <div className="flex flex-1 flex-col rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-2.5 border-b border-hairline px-3.5 py-3">
        <span className="text-xs font-semibold text-ink">{engine.name}</span>
        <span
          className={cn(
            'rounded-sm border px-1.5 py-px text-[0.625rem]',
            engine.kind === 'maia'
              ? 'border-deep/28 bg-deep/10 text-deep'
              : 'border-edge bg-elevated text-soft',
          )}
        >
          {engine.kind}
        </span>
        {engine.version ? (
          <span className="truncate font-mono text-[0.65625rem] text-dim">{engine.version}</span>
        ) : null}
        <div className="flex-1" />
        <span className="text-[0.6875rem] text-dim">{engine.enabled ? 'Enabled' : 'Disabled'}</span>
        <Toggle
          label={`${engine.enabled ? 'Disable' : 'Enable'} ${engine.name}`}
          checked={engine.enabled}
          disabled={update.isPending}
          onChange={(next) => update.mutate({ id: engine.id, body: { enabled: next } })}
        />
      </div>

      <Section
        title="Binary"
        aside={
          claimed.length > 0 ? (
            <div className="flex gap-1.5">
              {claimed.map((status) => (
                <TierBadge key={status.tier} tier={status.tier} />
              ))}
            </div>
          ) : null
        }
      >
        <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_8.75rem]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`engine-${engine.id}-name`}>Name</Label>
            <Input
              id={`engine-${engine.id}-name`}
              value={name}
              spellCheck={false}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`engine-${engine.id}-tier`}>Default tier</Label>
            <select
              id={`engine-${engine.id}-tier`}
              value={tier}
              onChange={(event) => setTier(event.target.value as Tier | '')}
              className="h-8 rounded-md border border-input bg-elevated px-2 text-xs text-ink outline-none transition-colors focus-visible:border-accent-teal/50"
            >
              <option value="">none</option>
              <option value="quick">quick</option>
              <option value="deep">deep</option>
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`engine-${engine.id}-path`}>Path</Label>
          <Input
            id={`engine-${engine.id}-path`}
            value={path}
            spellCheck={false}
            className="font-mono"
            onChange={(event) => setPath(event.target.value)}
          />
          <p className="text-[0.65625rem] text-dim">
            A file, a command line with arguments, or a name on PATH. Saving a new path
            re-probes the binary.
          </p>
        </div>
      </Section>

      <Section
        title="UCI options"
        aside={
          <div className="flex items-center gap-2">
            {probe.isFetching ? (
              <span className="text-[0.65625rem] text-dim">probing…</span>
            ) : probe.isSuccess ? (
              <span className="font-mono text-[0.65625rem] text-dim">
                {probe.data.name ?? 'unnamed'}
                {probe.data.author ? ` · ${probe.data.author.split('(')[0]!.trim()}` : ''}
              </span>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={probe.isFetching}
              onClick={() => {
                setProbeAsked(true)
                void probe.refetch()
              }}
            >
              <RefreshCw aria-hidden />
              Probe
            </Button>
          </div>
        }
      >
        {probe.isFetching && !probe.data ? (
          <div className="flex flex-col gap-2" data-testid="probe-loading">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-8 w-full" />
            ))}
          </div>
        ) : probe.isError ? (
          <div className="rounded-md border border-blunder/28 bg-blunder/5 px-3 py-2.5">
            <p className="text-[0.75rem] text-blunder">The binary could not be probed.</p>
            <p className="mt-1 font-mono text-[0.6875rem] leading-[1.5] text-blunder/80">
              {probe.error.message}
            </p>
          </div>
        ) : !probe.data ? (
          <p className="rounded-md border border-dashed border-edge-strong px-3 py-4 text-center text-[0.71875rem] text-dim">
            {engine.kind === 'maia'
              ? 'Probing a Maia model loads its network first, which takes a while — press Probe when you want to edit its options.'
              : 'Press Probe to read what this binary declares.'}
          </p>
        ) : (
          <OptionsEditor
            declared={declared}
            draft={draft}
            errors={resolved.errors}
            onChange={setDraft}
          />
        )}
      </Section>

      <Section title="Test run">
        <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_5.625rem_4.375rem]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`engine-${engine.id}-fen`}>Position</Label>
            <Input
              id={`engine-${engine.id}-fen`}
              value={fen}
              spellCheck={false}
              className="font-mono"
              placeholder="starting position"
              onChange={(event) => setFen(event.target.value)}
            />
          </div>
          {engine.kind === 'maia' ? (
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor={`engine-${engine.id}-ratings`}>Ratings</Label>
              <Input
                id={`engine-${engine.id}-ratings`}
                value={ratings}
                className="font-mono"
                placeholder="1500 1900"
                onChange={(event) => setRatings(event.target.value)}
              />
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`engine-${engine.id}-nodes`}>Nodes</Label>
                <Input
                  id={`engine-${engine.id}-nodes`}
                  value={nodes}
                  inputMode="numeric"
                  className="font-mono"
                  onChange={(event) => setNodes(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`engine-${engine.id}-multipv`}>Lines</Label>
                <Input
                  id={`engine-${engine.id}-multipv`}
                  value={multipv}
                  inputMode="numeric"
                  className="font-mono"
                  onChange={(event) => setMultipv(event.target.value)}
                />
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="flex-1 text-[0.6875rem] text-dim">
            Runs whether the engine is enabled or not — the point of the button is to decide.
          </span>
          <Button type="button" size="sm" disabled={testRun.isPending} onClick={run}>
            {testRun.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />}
            Test run
          </Button>
        </div>

        {testRun.isError ? (
          <div className="rounded-md border border-blunder/28 bg-blunder/5 px-3 py-2.5">
            <p className="text-[0.75rem] text-blunder">The engine did not answer.</p>
            <p className="mt-1 font-mono text-[0.6875rem] leading-[1.5] text-blunder/80">
              {testRun.error.message}
            </p>
          </div>
        ) : null}
        {testRun.data ? <SampleResult sample={testRun.data} /> : null}
      </Section>

      <div className="mt-auto flex items-center gap-2 border-t border-hairline px-3.5 py-2.5">
        {confirmDelete ? (
          <>
            <span className="flex-1 text-[0.6875rem] text-blunder">
              Remove {engine.name}? Analysis already stored keeps its runs.
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={remove.isPending}
              onClick={() => remove.mutate(engine.id)}
            >
              Remove
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 aria-hidden />
              Remove
            </Button>
            {update.isError ? (
              <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-blunder" title={update.error.message}>
                {update.error.message}
              </span>
            ) : (
              <div className="flex-1" />
            )}
            {blocked ? (
              <span className="text-[0.6875rem] text-blunder">Fix the options above first</span>
            ) : null}
            <Button
              type="button"
              size="sm"
              disabled={!dirty || blocked || update.isPending}
              onClick={save}
            >
              {update.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Save changes
            </Button>
          </>
        )}
      </div>
      {remove.isError ? (
        <p className="px-3.5 pb-2.5 text-[0.6875rem] text-blunder">{remove.error.message}</p>
      ) : null}
    </div>
  )
}

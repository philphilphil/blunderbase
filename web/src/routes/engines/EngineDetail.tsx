import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Loader2, Play, RefreshCw, Trash2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

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
import type { EngineResponse, EngineUpdate, SampleRequest } from '@/lib/api/types'
import { isRemote, type EngineHost } from '@/lib/engines/hosts'
import { readCredential } from '@/lib/runner'
import { cn } from '@/lib/utils'

import { KindBadge, RoleBadge } from './EngineBadges'
import { HostBadge } from './HostBadge'
import { OptionsEditor } from './OptionsEditor'
import { SampleResult } from './SampleResult'
import { Toggle } from './Toggle'
import { declaredOptions, draftFrom, resolveDraft, type OptionDraft } from './options'
import { NO_ROLES, roleLabel, type EngineRoles } from './roles'

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

/**
 * One engine, whole: what it is, what it is set to, and what it says when it is run.
 *
 * A runner-bound row is read-mostly. Its truth is the yaml on that machine — the server
 * rewrites the row every time the runner connects, and `PATCH /engines/{id}`,
 * `POST /engines/{id}/test-run` and the probe all refuse it, because `path` is a path over
 * there. So the editable half is shown rather than offered, and the probe is *not* started:
 * spawning whatever this host happens to have at a remote path is the one thing worse than
 * a disabled button.
 *
 * A browser runner is the same kind of row and needs different words for all of it. There
 * is no yaml to send anybody to, no machine to log into, and `path` is `wasm:stockfish-18`,
 * which is an identifier rather than a location — printed under a label saying "Path" it
 * would have the owner searching a filesystem for a file that was never there. `inBrowser`
 * below is that branch, and it reads the backend's own `path_scheme` rather than parsing
 * the path here.
 *
 * Which of the two a row is comes from `/runners/status`, a different read from the one that
 * fetched the row — so there is a third state, `hostKnown === false`, while that read is in
 * flight or after it failed. Nothing that touches the binary happens in it: "not known to be
 * remote" is not the same claim as "local", and the probe is the difference between the two.
 */
export function EngineDetail({
  engine,
  host,
  hostKnown,
  roles = NO_ROLES,
  embedded = false,
  onDeleted,
}: {
  engine: EngineResponse
  /** Where the binary is, from `/runners/status`; absent means this host. */
  host?: EngineHost
  /** Whether `/runners/status` has answered — until it has, `host` says nothing. */
  hostKnown: boolean
  /** What this engine is assigned to, from `/engines/roles` (`roles.ts`). */
  roles?: EngineRoles
  /** Full-width under its inventory row; the summary above already names and locates it. */
  embedded?: boolean
  onDeleted: () => void
}) {
  const remote = isRemote(host)
  /** Known to be somebody else's, or not yet known to be ours. */
  const locked = remote || !hostKnown
  const runnerName = host?.runnerName ?? 'that machine'
  /**
   * Whether this engine lives inside a browser tab rather than on a filesystem.
   *
   * Read off `path_scheme`, which the backend derives — `services.engines.path_scheme` — so
   * that no client parses `wasm:stockfish-18` for itself and no client is ever one release
   * behind on what a scheme means. `browser` on the runner says the same thing about the
   * *host*; either is enough, and a wasm engine on a host that has not been read yet still
   * must not be described as a file.
   */
  const inBrowser = engine.path_scheme === 'wasm' || host?.browser === true
  const whereItRuns = installedHere(host) ? 'in this browser' : `in ${runnerName}`
  const [name, setName] = useState(engine.name)
  const [path, setPath] = useState(engine.path)
  const [draft, setDraft] = useState<OptionDraft>(() => draftFrom(engine.options))
  const [probeAsked, setProbeAsked] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // The inventory row is already one disclosure level. Advanced controls belong to this
  // engine rather than to a global mode, and close when another detail replaces this one.
  const [moreSettings, setMoreSettings] = useState(false)

  const [fen, setFen] = useState('')
  const [nodes, setNodes] = useState(String(DEFAULT_NODES))
  const [multipv, setMultipv] = useState(String(DEFAULT_MULTIPV))
  const [ratings, setRatings] = useState('')

  const probe = useQuery({
    // Deliberately outside the `['engines']` prefix: a socket event that invalidates
    // engines must not start a subprocess.
    queryKey: ['engine-probe', engine.path, engine.kind],
    queryFn: () => probeEngine({ path: engine.path, kind: engine.kind }),
    // Never for a runner-bound engine — nor for one that has not been shown to be local:
    // `path` may be a path on the other machine, and probing it here would start whatever
    // this host happens to have at that path.
    enabled: (autoProbe(engine) || probeAsked) && !locked,
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
      setDraft(draftFrom(saved.options))
    },
  })
  const remove = useDeleteEngine({ onSuccess: onDeleted })
  const testRun = useTestRunEngine()

  const renamed = name.trim() !== engine.name
  const repathed = path.trim() !== engine.path
  // An options change can only be trusted once the probe has said what this binary
  // declares; until then the editor is read-only anyway.
  const optionsChanged = probe.isSuccess && resolved.changed
  const dirty = renamed || repathed || optionsChanged
  const blocked = Object.keys(resolved.errors).length > 0

  function save() {
    const body: EngineUpdate = {}
    if (renamed) body.name = name.trim()
    if (repathed) body.path = path.trim()
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

  return (
    <div
      className={cn(
        'flex flex-1 flex-col',
        embedded
          ? 'border-t border-hairline bg-elevated/35'
          : 'rounded-xl border border-line bg-panel',
      )}
    >
      <div className="flex items-center gap-2.5 border-b border-hairline px-3.5 py-3">
        {embedded ? (
          <span className="text-[0.6875rem] text-dim">
            {locked ? 'Runner-owned settings are read-only here' : 'Engine settings'}
          </span>
        ) : (
          <>
            <span className="text-xs font-semibold text-ink">{engine.name}</span>
            <KindBadge kind={engine.kind} />
            {engine.version ? (
              <span className="truncate font-mono text-[0.65625rem] text-dim">
                {engine.version}
              </span>
            ) : null}
            <HostBadge host={host} />
          </>
        )}
        <div className="flex-1" />
        <span className="text-[0.6875rem] text-dim">{engine.enabled ? 'Enabled' : 'Disabled'}</span>
        <Toggle
          label={`${engine.enabled ? 'Disable' : 'Enable'} ${engine.name}`}
          checked={engine.enabled}
          disabled={locked || update.isPending}
          onChange={(next) => update.mutate({ id: engine.id, body: { enabled: next } })}
        />
      </div>

      <Section title="Binary" aside={<RoleBadge roles={roles} />}>
        {remote && inBrowser ? (
          // A tab has no yaml and no filesystem, so the sentence a remote *machine* gets
          // would be three wrong instructions in a row.
          <p className="rounded-md border border-edge bg-elevated px-3 py-2.5 text-[0.6875rem] leading-[1.6] text-dim">
            Runs <span className="font-medium text-soft">{whereItRuns}</span>. This row is the
            tab&rsquo;s own advertisement and is rewritten every time it connects — there is no
            file to point at and nothing here to edit. It goes away when the browser runner is
            uninstalled.
          </p>
        ) : remote ? (
          <p className="rounded-md border border-edge bg-elevated px-3 py-2.5 text-[0.6875rem] leading-[1.6] text-dim">
            Advertised by <span className="font-medium text-soft">{runnerName}</span>. This row is
            that machine&rsquo;s advertisement and is rewritten every time it connects — change it
            in <span className="font-mono text-soft">runner.yaml</span> over there. Its path is a
            path on that machine.
          </p>
        ) : hostKnown ? null : (
          <p className="rounded-md border border-edge bg-elevated px-3 py-2.5 text-[0.6875rem] leading-[1.6] text-dim">
            Which machine advertises this engine is not known yet, so nothing here is editable
            and the binary is not probed — a runner&rsquo;s path is a path on that machine, not
            on this one.
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`engine-${engine.id}-name`}>Name</Label>
          {/*
            A row nobody can edit has no draft to preserve, and the runner rewrites it on
            every connection — so it is read from the row rather than from the state this
            card started with, which the header next to it would otherwise contradict.
          */}
          <Input
            id={`engine-${engine.id}-name`}
            value={remote ? engine.name : name}
            spellCheck={false}
            readOnly={locked}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        {/*
          There is no field here for what this engine runs, and there was one: a "default
          tier" the resolution could fall back away from, so the card offered a setting that
          did not decide anything. What it runs is an assignment, made in one place for all
          three roles — this card says which of them this engine holds and points at it.
        */}
        <p className="text-[0.65625rem] leading-[1.5] text-dim">
          {roles.length > 0 ? (
            <>
              Assigned to <span className="font-medium text-soft">{roleLabel(roles)}</span>.
            </>
          ) : (
            'Assigned to nothing, so it runs only when a test run or an analysis board asks for it by name.'
          )}{' '}
          Which engine runs what is chosen under{' '}
          <span className="font-medium text-soft">What runs what</span> at the top of this page.
        </p>
        <div className="flex flex-col gap-1.5">
          {/*
            A wasm engine's `path` is `wasm:stockfish-18`, which is an identifier and not a
            location. Printing it in a field labelled "Path" would invite the owner to look
            for it, so the field is relabelled and answers the question it is really being
            asked: where does this thing run.
          */}
          <Label htmlFor={`engine-${engine.id}-path`}>{inBrowser ? 'Where it runs' : 'Path'}</Label>
          <Input
            id={`engine-${engine.id}-path`}
            value={inBrowser ? capitalise(whereItRuns) : remote ? engine.path : path}
            spellCheck={false}
            readOnly={locked}
            className={inBrowser ? undefined : 'font-mono'}
            onChange={(event) => setPath(event.target.value)}
          />
          <p className="text-[0.65625rem] text-dim">
            {inBrowser
              ? 'The build ships with Blunderbase and is loaded by the tab itself. There is no file on any machine.'
              : remote
                ? `A path on ${runnerName}, not here.`
                : 'A file, a command line with arguments, or a name on PATH. Saving a new path re-probes the binary.'}
          </p>
        </div>
      </Section>

      <button
        type="button"
        aria-expanded={moreSettings}
        onClick={() => setMoreSettings((open) => !open)}
        className="flex w-full items-center gap-2.5 border-t border-hairline px-3.5 py-3 text-left transition-colors hover:bg-raised"
      >
        <span className="text-[0.6875rem] font-medium text-soft">More settings</span>
        <span className="text-[0.65625rem] text-dim">UCI options and test runs</span>
        <div className="flex-1" />
        <ChevronRight
          className={cn('size-3.5 text-faint transition-transform', moreSettings && 'rotate-90')}
          aria-hidden
        />
      </button>

      {moreSettings ? (
        <>
          <Section
            title="UCI options"
            aside={
              remote ? null : (
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
                    disabled={probe.isFetching || locked}
                    onClick={() => {
                      setProbeAsked(true)
                      void probe.refetch()
                    }}
                  >
                    <RefreshCw aria-hidden />
                    Probe
                  </Button>
                </div>
              )
            }
          >
            {remote ? (
              <p className="rounded-md border border-dashed border-edge-strong px-3 py-4 text-center text-[0.71875rem] text-dim">
                Options come from the runner&rsquo;s own probe.
              </p>
            ) : probe.isFetching && !probe.data ? (
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

          {remote ? (
            <Section title="Test run">
              <p className="text-[0.6875rem] leading-[1.6] text-dim">
                {inBrowser ? (
                  <>
                    A test run starts a binary on this host. This engine has none — it runs{' '}
                    <span className="font-medium text-soft">{whereItRuns}</span>.
                  </>
                ) : (
                  <>
                    A test run starts the binary here;{' '}
                    <span className="font-mono text-soft">{engine.path}</span> is a path on{' '}
                    <span className="font-medium text-soft">{runnerName}</span>.
                  </>
                )}
              </p>
            </Section>
          ) : (
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
                  Runs whether the engine is enabled or not — the point of the button is to
                  decide.
                </span>
                <Button
                  type="button"
                  size="sm"
                  disabled={locked || testRun.isPending}
                  onClick={run}
                >
                  {testRun.isPending ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Play aria-hidden />
                  )}
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
          )}
        </>
      ) : null}

      {/* The footer carries a sentence and up to two buttons; below `md` it wraps. */}
      <div className="mt-auto flex items-center gap-2 border-t border-hairline px-3.5 py-2.5 max-md:flex-wrap max-md:justify-end">
        {remote ? (
          // Removing the row would delete an advertisement the runner recreates on its next
          // connection. Revoking the runner in the section below is the honest way out.
          <p className="text-[0.6875rem] leading-[1.6] text-dim">
            {inBrowser ? (
              <>
                Nothing here is editable. This row belongs to a browser tab — uninstall it under{' '}
                <span className="font-medium text-soft">This browser</span> in Compute capacity
                below, or revoke the runner there.
              </>
            ) : (
              <>
                Nothing here is editable. Change this engine in{' '}
                <span className="font-mono text-soft">runner.yaml</span> on {runnerName}, or open{' '}
                {runnerName} under Compute capacity below to revoke it.
              </>
            )}
          </p>
        ) : confirmDelete ? (
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
              disabled={locked || !dirty || blocked || update.isPending}
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

/**
 * Whether this host is the browser runner installed *here*, so the card can say "in this
 * browser" rather than name a tab the owner is not looking at.
 *
 * Read from the stored credential rather than from anything the server said: only this
 * browser knows which runner id it holds a token for, and a second browser looking at the
 * same deployment sees the same row and must not claim it.
 */
function installedHere(host: EngineHost | undefined): boolean {
  if (!host || host.runnerId === null) return false
  return readCredential()?.runnerId === host.runnerId
}

/** `in this browser` → `In this browser`, for a field value rather than a sentence. */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

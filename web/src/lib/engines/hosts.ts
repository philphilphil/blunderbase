/**
 * Where an engine lives, and whether it can drive an analysis board right now.
 *
 * `GET /engines` does not carry `runner_id` (`EngineResponse` is a plain row model), so the
 * binding comes from `GET /runners/status` and is joined on engine id.
 * `RunnerEngine.streams` is the *engine's* half of the answer — its kind, and what its host
 * advertised — while the transport belongs to the runner and changes from one connection to
 * the next. That is why "queue only" is decided here and nowhere else:
 * `workers/runner_streams.py` refuses `stream_open` on a poll link with a 409
 * `stream_unavailable`, and the words below are the backend's own, so the UI and the
 * refusal agree.
 *
 * Every `false` gets a sentence naming which of the three it is, because they are acted on
 * differently: a Maia never drives a board and never will, a host that advertised
 * `streams: false` needs a different engine picked, and a polling link only needs the
 * socket back.
 */
import { t } from '@lingui/core/macro'

import type {
  EngineKind,
  RunnerEngine,
  RunnerResponse,
  RunnersStatus,
  RunnerTransport,
} from '@/lib/api/types'

export interface EngineHost {
  engineId: number
  name: string
  kind: EngineKind
  enabled: boolean
  /** The path as its own host reports it; a remote path is read-only here. */
  path: string | null
  /** null ⇒ `path` is a filesystem path. `wasm` ⇒ it is not one, and must not be shown as one. */
  pathScheme: string | null
  /** null ⇒ this host. */
  runnerId: number | null
  runnerName: string | null
  /** Whether the host is a browser tab rather than a machine. False for local. */
  browser: boolean
  /** Always true for local. */
  connected: boolean
  /** null for local. */
  transport: RunnerTransport | null
  /** Can drive an analysis board right now. */
  streams: boolean
  /** Why not, in the backend's own words, when `streams` is false. */
  streamsReason: string | null
}

function hostOf(engine: RunnerEngine, runner: RunnerResponse | null): EngineHost {
  const runnerId = runner?.id ?? null
  const transport = runner?.transport ?? null
  const connected = runner === null ? true : runner.connected

  let streams = engine.streams && engine.enabled
  let reason: string | null = null
  if (!engine.streams && engine.kind !== 'uci') {
    // The backend's own sentence for a Maia: it answers with a policy, not a search.
    reason = t`answers with a policy rather than a search`
    streams = false
  } else if (!engine.streams) {
    // A search engine whose host said it answers no `stream_open` — the browser runner is
    // one, and a tab that offered a board would leave it waiting for a `stream_started`
    // that never comes. Nothing here fixes it, so the sentence points at the way out:
    // another engine.
    const host = runner?.name ?? ''
    reason =
      runner === null
        ? t`this host does not run analysis boards on it`
        : t`${host} runs queued analysis on it but no analysis board — pick another engine`
    streams = false
  } else if (!engine.enabled) {
    reason = t`switched off`
    streams = false
  } else if (runner !== null && !connected) {
    const host = runner.name
    reason = t`${host} is not connected`
    streams = false
  } else if (runner !== null && transport === 'poll') {
    const host = runner.name
    reason = t`queue only — ${host} is connected over polling`
    streams = false
  }

  return {
    engineId: engine.id,
    name: engine.name,
    kind: engine.kind,
    enabled: engine.enabled,
    path: engine.path ?? null,
    pathScheme: engine.path_scheme ?? null,
    runnerId,
    runnerName: runner?.name ?? null,
    browser: runner?.browser ?? false,
    connected,
    transport,
    streams,
    streamsReason: streams ? null : reason,
  }
}

function sorted(hosts: EngineHost[]): EngineHost[] {
  return [...hosts].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Every engine the deployment knows, as a host binding.
 *
 * Local engines first, then each runner in list order; within a host, by name. It used to
 * be by tier first — an engine carried a `default_tier` and the list put deep before quick.
 * There is no such field any more: which engine serves a role is an assignment the owner
 * makes (`routes/engines/roles.ts`), not a property of the row, and a picker that ordered
 * itself by a role would have to re-sort every time that assignment changed.
 */
export function engineHosts(status: RunnersStatus | undefined): EngineHost[] {
  if (!status) return []
  const hosts: EngineHost[] = sorted(
    (status.local?.engines ?? []).map((engine) => hostOf(engine, null)),
  )
  for (const runner of status.runners ?? []) {
    hosts.push(...sorted((runner.engines ?? []).map((engine) => hostOf(engine, runner))))
  }
  return hosts
}

/** The same bindings, keyed by engine id — how the Engines page joins `/engines` to them. */
export function hostByEngineId(status: RunnersStatus | undefined): Map<number, EngineHost> {
  return new Map(engineHosts(status).map((host) => [host.engineId, host]))
}

/** `host.runnerId !== null` — the row is an advertisement, read-mostly. */
export function isRemote(host: EngineHost | undefined): boolean {
  return host?.runnerId != null
}

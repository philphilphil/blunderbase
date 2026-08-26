/**
 * Where an engine lives, and whether it can drive an analysis board right now.
 *
 * `GET /engines` does not carry `runner_id` (`EngineResponse` is a plain row model), so the
 * binding comes from `GET /runners/status` and is joined on engine id.
 * `RunnerEngine.streams` only knows the engine's *kind* — `backend/services/runners.py`
 * computes it as `kind == "uci"` — while the transport belongs to the runner. That is why
 * "queue only" is decided here and nowhere else: `workers/runner_streams.py` refuses
 * `stream_open` on a poll link with a 409 `stream_unavailable`, and the words below are the
 * backend's own, so the UI and the refusal agree.
 */
import type {
  EngineKind,
  RunnerEngine,
  RunnerResponse,
  RunnersStatus,
  RunnerTransport,
  Tier,
} from '@/lib/api/types'

export interface EngineHost {
  engineId: number
  name: string
  kind: EngineKind
  enabled: boolean
  tier: Tier | null
  /** The path as its own host reports it; a remote path is read-only here. */
  path: string | null
  /** null ⇒ this host. */
  runnerId: number | null
  runnerName: string | null
  /** Always true for local. */
  connected: boolean
  /** null for local. */
  transport: RunnerTransport | null
  /** Can drive an analysis board right now. */
  streams: boolean
  /** Why not, in the backend's own words, when `streams` is false. */
  streamsReason: string | null
}

/** deep first, then quick, then untiered — so "default = deep tier" reads sensibly. */
const TIER_ORDER: Record<string, number> = { deep: 0, quick: 1 }

function rank(tier: Tier | null): number {
  return tier === null ? 2 : (TIER_ORDER[tier] ?? 2)
}

function hostOf(engine: RunnerEngine, runner: RunnerResponse | null): EngineHost {
  const runnerId = runner?.id ?? null
  const transport = runner?.transport ?? null
  const connected = runner === null ? true : runner.connected
  const tier = engine.default_tier ?? null

  let streams = engine.streams && engine.enabled
  let reason: string | null = null
  if (!engine.streams) {
    // The backend's own sentence for a Maia: it answers with a policy, not a search.
    reason = 'answers with a policy rather than a search'
    streams = false
  } else if (!engine.enabled) {
    reason = 'switched off'
    streams = false
  } else if (runner !== null && !connected) {
    reason = `${runner.name} is not connected`
    streams = false
  } else if (runner !== null && transport === 'poll') {
    reason = `queue only — ${runner.name} is connected over polling`
    streams = false
  }

  return {
    engineId: engine.id,
    name: engine.name,
    kind: engine.kind,
    enabled: engine.enabled,
    tier,
    path: engine.path ?? null,
    runnerId,
    runnerName: runner?.name ?? null,
    connected,
    transport,
    streams,
    streamsReason: streams ? null : reason,
  }
}

function sorted(hosts: EngineHost[]): EngineHost[] {
  return [...hosts].sort(
    (a, b) => rank(a.tier) - rank(b.tier) || a.name.localeCompare(b.name),
  )
}

/**
 * Every engine the deployment knows, as a host binding.
 *
 * Local engines first, then each runner in list order; within a host, deep before quick
 * before untiered, then by name.
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

import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '@/lib/api/client'
import type { StreamResponse } from '@/lib/api/types'
import { snapshotFrom, type StreamSnapshot } from '@/lib/analysis/streamModel'
import type { StreamSessionApi, UseStreamSessionOptions } from '@/lib/analysis/useStreamSession'
import type { EngineHost } from '@/lib/engines/hosts'
import { demoAnalysis, DEMO_ENGINE_ID, useDemoAnalysis } from './analysis'

const HOST: EngineHost = {
  engineId: DEMO_ENGINE_ID, name: 'Stockfish 18', kind: 'uci', enabled: true,
  path: 'wasm:stockfish-18', pathScheme: 'wasm', runnerId: DEMO_ENGINE_ID,
  runnerName: 'This browser', browser: true, connected: true, transport: 'websocket',
  streams: true, streamsReason: null,
}

export function useDemoStream({ fen, surface, gameId, ply, defaultMultipv = 3 }: UseStreamSessionOptions): StreamSessionApi {
  const state = useDemoAnalysis()
  const [enabled, setOn] = useState(false)
  const [multipv, setMultipv] = useState(defaultMultipv)
  const [session, setSession] = useState<StreamResponse | null>(null)
  const [snapshot, setSnapshot] = useState<StreamSnapshot | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const setEnabled = useCallback((on: boolean) => {
    setError(null)
    if (on && !demoAnalysis.getSnapshot().ready) {
      setError(new ApiError(409, { error: 'browser_engine_missing', detail: 'No engine is set up' }))
      return
    }
    setOn(on)
    if (!on) { setSession(null); setSnapshot(null) }
  }, [])

  useEffect(() => {
    if (!enabled || !fen) return
    let cancelled = false
    let work: ReturnType<typeof demoAnalysis.begin> | null = null
    setSession(null)
    setSnapshot(null)
    const timer = setTimeout(() => {
      if (cancelled) return
      work = demoAnalysis.begin()
      const id = crypto.randomUUID()
      let seq = 0
      const onAbort = () => { if (!cancelled) setOn(false) }
      work.signal.addEventListener('abort', onAbort, { once: true })
      const opened: StreamResponse = {
        id, fen, surface, multipv, engine_id: DEMO_ENGINE_ID, engine: work.engine.version,
        runner_id: DEMO_ENGINE_ID, runner: 'This browser', state: 'running', seq: 0,
        created_at: new Date().toISOString(), game_id: gameId, ply,
      }
      void work.engine.searchInfinite(fen, {
        multipv, chess960: false, intervalMs: 500, signal: work.signal,
        onStarted: () => { if (!cancelled) setSession(opened) },
        onSnapshot: (value) => {
          if (cancelled) return
          setSnapshot(snapshotFrom({
            event: 'stream.snapshot', session_id: id, seq: ++seq, engine_id: DEMO_ENGINE_ID,
            engine: opened.engine, runner_id: DEMO_ENGINE_ID, fen, multipv,
            depth: value.depth, nodes: value.nodes, nps: value.nps, time_ms: value.timeMs,
            lines: value.lines.map((line) => ({ ...line })), at: new Date().toISOString(),
          }))
        },
      }).catch((cause: unknown) => {
        if (!cancelled) { setError(cause instanceof Error ? cause : new Error(String(cause))); setOn(false) }
      }).finally(() => { work?.signal.removeEventListener('abort', onAbort); work?.release() })
    }, 150)
    return () => { cancelled = true; clearTimeout(timer); work?.cancel() }
  }, [enabled, fen, multipv, surface, gameId, ply])

  // Stable, because `AnalysisControls` keeps them in an effect's dependency list and this
  // hook re-renders on every frame the search hands over.
  const resume = useCallback(() => setEnabled(true), [setEnabled])
  const dismissOffer = useCallback(() => setError(null), [])

  return {
    enabled, setEnabled, phase: error ? 'error' : !enabled ? 'off' : snapshot ? 'running' : 'opening',
    session, snapshot: snapshot?.fen === fen ? snapshot : null, error, note: null, offer: null,
    // One engine, no choice to make: the tab's own, and only once it is actually installed.
    engines: state.ready ? [HOST] : [], engineId: state.ready ? DEMO_ENGINE_ID : null,
    setEngineId: NO_PICK, multipv, setMultipv, resume, dismissOffer,
  }
}

/** There is nothing to pick between, so the picker's setter is a no-op rather than absent. */
function NO_PICK() {}

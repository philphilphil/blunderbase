import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserRunnerState } from './client'
import { whenBrowserEngineReady } from './install'

function store() {
  let state = { phase: 'connecting', engineName: 'Stockfish', refused: [], error: null } as unknown as BrowserRunnerState
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    patch: (next: Partial<BrowserRunnerState>) => { state = { ...state, ...next }; listeners.forEach((listener) => listener()) },
    listeners,
  }
}

afterEach(() => vi.useRealTimers())

describe('browser engine readiness', () => {
  it('waits for the welcome and removes its listener on success', async () => {
    const source = store()
    const done = vi.fn()
    const ready = whenBrowserEngineReady(source).then(done)
    await Promise.resolve()
    expect(done).not.toHaveBeenCalled()
    source.patch({ phase: 'connected' })
    await ready
    expect(done).toHaveBeenCalledOnce()
    expect(source.listeners.size).toBe(0)
  })

  it('does not mistake a connected socket with a refused engine for readiness', async () => {
    const source = store()
    const ready = whenBrowserEngineReady(source)
    const rejection = expect(ready).rejects.toThrow('Stockfish: unsupported')
    source.patch({ phase: 'connected' })
    source.patch({ refused: [{ name: 'Stockfish', reason: 'unsupported' }] })
    await rejection
    expect(source.listeners.size).toBe(0)
  })

  it('times out and removes its subscription', async () => {
    vi.useFakeTimers()
    const source = store()
    const ready = whenBrowserEngineReady(source, 100)
    const rejection = expect(ready).rejects.toThrow('the engine did not come up in time')
    await vi.advanceTimersByTimeAsync(100)
    await rejection
    expect(source.listeners.size).toBe(0)
  })
})

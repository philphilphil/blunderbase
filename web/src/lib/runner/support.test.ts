import { describe, expect, it } from 'vitest'

import {
  browserRunnerName,
  browserRunnerSupport,
  THREAD_CAP,
  threadPlan,
  type RunnerEnvironment,
} from './support'

const CAPABLE: RunnerEnvironment = {
  WebAssembly: {},
  WebSocket: class {},
  Worker: class {},
  crossOriginIsolated: true,
  navigator: { hardwareConcurrency: 12 },
}

describe('browserRunnerSupport', () => {
  it('says yes to a browser that has everything', () => {
    expect(browserRunnerSupport(CAPABLE)).toEqual({ supported: true, reason: null })
  })

  it('names what is missing rather than failing later', () => {
    expect(browserRunnerSupport({ ...CAPABLE, WebAssembly: undefined }).reason).toContain(
      'WebAssembly',
    )
    expect(browserRunnerSupport({ ...CAPABLE, Worker: undefined }).reason).toContain('workers')
    expect(browserRunnerSupport({ ...CAPABLE, WebSocket: undefined }).reason).toContain(
      'WebSocket',
    )
  })

  it('still offers itself on a page that is not cross-origin isolated', () => {
    // The whole point of the fallback: a proxy stripping COOP/COEP must not make the
    // install button disappear with no visible cause. It is a label, not a gate.
    expect(browserRunnerSupport({ ...CAPABLE, crossOriginIsolated: false })).toEqual({
      supported: true,
      reason: null,
    })
  })
})

describe('threadPlan', () => {
  it('takes a thread per core, up to the cap', () => {
    expect(threadPlan(CAPABLE)).toEqual({ isolated: true, threads: THREAD_CAP })
    expect(threadPlan({ ...CAPABLE, navigator: { hardwareConcurrency: 4 } })).toEqual({
      isolated: true,
      threads: 4,
    })
    expect(threadPlan({ ...CAPABLE, navigator: { hardwareConcurrency: 64 } })).toEqual({
      isolated: true,
      threads: THREAD_CAP,
    })
  })

  it('never asks for fewer than one', () => {
    expect(threadPlan({ ...CAPABLE, navigator: { hardwareConcurrency: 1 } })).toEqual({
      isolated: true,
      threads: 1,
    })
    expect(threadPlan({ ...CAPABLE, navigator: undefined })).toEqual({
      isolated: true,
      threads: 1,
    })
  })

  it('is single-threaded without cross-origin isolation, however many cores there are', () => {
    expect(threadPlan({ ...CAPABLE, crossOriginIsolated: false })).toEqual({
      isolated: false,
      threads: 1,
    })
    expect(threadPlan({ ...CAPABLE, crossOriginIsolated: undefined })).toEqual({
      isolated: false,
      threads: 1,
    })
  })
})

describe('browserRunnerName', () => {
  const CHROME_MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/131.0.0.0 Safari/537.36'
  const EDGE_WINDOWS =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
  const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0'
  const SAFARI_MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
    'Version/18.1 Safari/605.1.15'

  it('names the browser and the machine', () => {
    expect(browserRunnerName(CHROME_MAC)).toBe('Chrome on macOS')
    expect(browserRunnerName(FIREFOX_LINUX)).toBe('Firefox on Linux')
    expect(browserRunnerName(SAFARI_MAC)).toBe('Safari on macOS')
  })

  it('does not call every Chromium fork Chrome', () => {
    // Edge, Opera and Brave all put "Chrome/…" in their user agent, so the fork has to win.
    expect(browserRunnerName(EDGE_WINDOWS)).toBe('Edge on Windows')
  })

  it('says something true about a user agent it does not recognise', () => {
    expect(browserRunnerName('Mozilla/5.0 (Windows NT 10.0)')).toBe('This browser on Windows')
    expect(browserRunnerName(undefined)).toBe('This browser')
  })
})

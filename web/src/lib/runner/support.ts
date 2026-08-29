/**
 * Whether this browser can host an engine at all, and how much of the machine it will use.
 *
 * Both answers are wanted *before* anything is loaded — the Engines page has to say "your
 * browser cannot do this, and here is why" rather than offer a button that fails 15 MB
 * later — so this file touches no engine and no network and is a pure reading of the
 * environment.
 *
 * **Isolation is not part of the gate, deliberately.** The Stockfish build wants a *shared*
 * `WebAssembly.Memory`, which is a `SharedArrayBuffer`, which browsers hand only to a page
 * served with COOP and COEP. `api/web.py` sends both, so the normal case is fine — but a
 * reverse proxy in front of the container can strip them, and a button that simply vanishes
 * when that happens leaves the owner with no cause to look at. So a page with no isolation
 * still gets the button, still gets `threadPlan().threads === 1`, and — if the module then
 * refuses to start for want of shared memory — gets `ISOLATION_HINT` as the reason, which
 * names the proxy rather than blaming the browser. Being told what to fix beats being shown
 * nothing.
 *
 * Everything takes its environment as an argument so a test can state one instead of
 * standing up a DOM.
 */

export interface RunnerSupport {
  supported: boolean
  reason: string | null
}

export interface ThreadPlan {
  isolated: boolean
  threads: number
}

/**
 * The most threads one tab will ask for.
 *
 * The option's declared maximum is in the hundreds and the machine's core count is the real
 * bound, but neither is the bound that matters: this is a tab in a browser somebody is also
 * *using*, and Stockfish's wasm build scales poorly past a handful of threads anyway. Eight
 * buys most of the speed on the machines that have them and costs nothing on the ones that
 * do not.
 */
export const THREAD_CAP = 8

/**
 * Why a page that has WebAssembly can still fail to start the engine.
 *
 * Quoted by `client.ts` when the module will not start and the page is not isolated: the
 * build is a pthread build, so without a `SharedArrayBuffer` it cannot allocate its memory
 * at all — not even single-threaded. The cause is almost never the browser.
 */
export const ISOLATION_HINT =
  'this page is not cross-origin isolated, so the browser will not give it the shared ' +
  'memory the engine needs. Blunderbase serves the headers that ask for it, so a reverse ' +
  'proxy in front of it is most likely stripping them — see docs/deploy.md'

/** The little of `globalThis` this file reads. */
export interface RunnerEnvironment {
  WebAssembly?: unknown
  WebSocket?: unknown
  Worker?: unknown
  crossOriginIsolated?: boolean
  navigator?: { hardwareConcurrency?: number }
}

/**
 * Whether to offer the install button at all.
 *
 * Only the three things whose absence no deployment change could fix: no WebAssembly, no
 * workers to run the engine's threads on, no socket to be dispatched work over. Everything
 * else — isolation above all — is a fact to show, not a reason to hide the feature.
 */
export function browserRunnerSupport(env: RunnerEnvironment = globalThis): RunnerSupport {
  if (typeof env.WebAssembly === 'undefined') {
    return {
      supported: false,
      reason: 'this browser has no WebAssembly, so it cannot run an engine',
    }
  }
  if (typeof env.Worker === 'undefined') {
    return {
      supported: false,
      reason: 'this browser has no web workers, so the engine has nothing to run on',
    }
  }
  if (typeof env.WebSocket === 'undefined') {
    return {
      supported: false,
      reason: 'this browser has no WebSocket, so it cannot be dispatched work',
    }
  }
  return { supported: true, reason: null }
}

/** Browsers, most specific first: every Chromium fork also says "Chrome". */
const BROWSERS: [RegExp, string][] = [
  [/\bEdg\//, 'Edge'],
  [/\bOPR\//, 'Opera'],
  [/\bBrave\//, 'Brave'],
  [/\bVivaldi\//, 'Vivaldi'],
  [/\bFirefox\//, 'Firefox'],
  [/\bChrome\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
]

const PLATFORMS: [RegExp, string][] = [
  [/\bAndroid\b/, 'Android'],
  [/\b(iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bMac OS X\b/, 'macOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
]

/**
 * What to call the runner this browser registers as — `Chrome on macOS`.
 *
 * A name, not an identity: the token is the identity, the server may hold this one to
 * something else, and two Chromes on two macs collide and are disambiguated by the install
 * flow rather than here. It exists so the runners list says something recognisable instead
 * of `browser-1`, which is the whole reason the install button asks nobody to type a name.
 *
 * Deliberately coarse. Versions change under the owner's feet and would make the runners
 * list churn; a user agent nobody recognises is simply "this browser", which is true.
 */
export function browserRunnerName(userAgent: string | undefined): string {
  const agent = userAgent ?? ''
  const browser = BROWSERS.find(([pattern]) => pattern.test(agent))?.[1]
  const platform = PLATFORMS.find(([pattern]) => pattern.test(agent))?.[1]
  if (!browser) return platform ? `This browser on ${platform}` : 'This browser'
  return platform ? `${browser} on ${platform}` : browser
}

/** How many threads this tab will ask for, and whether it got cross-origin isolation. */
export function threadPlan(env: RunnerEnvironment = globalThis): ThreadPlan {
  // Without isolation there is no `SharedArrayBuffer`, without one there are no pthreads,
  // and a count above 1 would be a number this page could not honour.
  if (env.crossOriginIsolated !== true) return { isolated: false, threads: 1 }
  const cores = Math.floor(env.navigator?.hardwareConcurrency ?? 1)
  const usable = Number.isFinite(cores) ? cores : 1
  return { isolated: true, threads: Math.max(1, Math.min(THREAD_CAP, usable)) }
}

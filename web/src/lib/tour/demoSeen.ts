/**
 * The demo's copy of "I have seen the tour".
 *
 * Everywhere else this is a row on the deployment, because it is a fact about the owner
 * rather than about a browser (`GET /settings/tour`). The public demo has neither: it has
 * no owner and refuses every write, so the visitor's own browser is the only place the
 * answer can live — and it only has to survive the next click, not the next machine.
 *
 * A browser that will not store it — private mode, site data blocked — simply gets the
 * tour again on the next reload, which is the failure the demo can afford.
 */

const KEY = 'blunderbase.tourSeen'

export function readDemoTourSeen(): boolean {
  try {
    return window.localStorage.getItem(KEY) === 'true'
  } catch {
    return false
  }
}

export function writeDemoTourSeen(seen: boolean): void {
  try {
    if (seen) window.localStorage.setItem(KEY, 'true')
    else window.localStorage.removeItem(KEY)
  } catch {
    // See above: the tour comes back, and nothing else is lost.
  }
}

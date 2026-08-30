interface NativeBridgeConfig {
  port: number
  token: string
}

const STORAGE_KEY = 'blunderbase.native-bridge'
const HASH_PREFIX = '#bb-native='

function readConfig(): NativeBridgeConfig | null {
  const fromHash = window.location.hash.startsWith(HASH_PREFIX)
    ? window.location.hash.slice(HASH_PREFIX.length)
    : null
  const raw = fromHash ?? window.sessionStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  const [portText, token] = raw.split(':')
  const port = Number(portText)
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || !/^[a-f0-9]{64}$/.test(token ?? '')) {
    return null
  }
  if (fromHash) {
    window.sessionStorage.setItem(STORAGE_KEY, raw)
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  }
  return { port, token: token! }
}

const config = typeof window === 'undefined' ? null : readConfig()

async function send(path: string, payload: unknown): Promise<void> {
  if (!config) return
  try {
    await fetch(`http://127.0.0.1:${config.port}/native/${path}?token=${config.token}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  } catch {
    // Native feedback must never turn a completed import or analysis into a UI error.
  }
}

export function hasNativeBridge(): boolean {
  return config !== null
}

/** The one request that turns the launch secret into an HTTP-only backend cookie. */
export function desktopBootstrapHeaders(): Record<string, string> {
  return config ? { 'x-blunderbase-desktop-token': config.token } : {}
}

export function sendNativeNotification(title: string, body: string): Promise<void> {
  return send('notify', { title, body })
}

export function setNativeProgress(
  status: 'none' | 'normal' | 'indeterminate' | 'paused' | 'error',
  progress?: number,
): Promise<void> {
  return send('progress', { status, progress })
}

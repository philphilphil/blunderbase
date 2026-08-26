/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the backend is mounted from the browser. Defaults to the dev proxy at `/api`. */
  readonly VITE_API_BASE?: string
  /** Absolute `/events` WebSocket URL. Defaults to the page's own origin. */
  readonly VITE_EVENTS_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** `web/package.json`'s version, substituted at build time by `define` in vite.config.ts. */
declare const __APP_VERSION__: string

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

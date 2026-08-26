/**
 * The app's version, baked in from `web/package.json` by `define` in vite.config.ts.
 *
 * One deploy is one commit, so this is the backend's version too — `make release` moves
 * `package.json` and `pyproject.toml` in the same bump.
 */
export const APP_VERSION = __APP_VERSION__

/** How the version is written in the UI: `v0.1.0`. */
export const VERSION_LABEL = `v${APP_VERSION}`

/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

/**
 * The version the sidebar footer prints. It is baked in at build time rather than fetched,
 * because web and backend ship from the same commit — `make release` bumps this file and
 * `pyproject.toml` together, so there is nothing for a runtime call to disagree with.
 */
const { version } = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8'),
) as { version: string }

/**
 * The client talks to `/api/*`, and the proxy forwards that prefix untouched — the
 * backend answers there itself. Stripping it here would be worse than redundant: page
 * routes and routers share spellings (`/games` is both), so a bare `/games` reaches a
 * server holding a web build as the SPA index, and every dev API call comes back as
 * HTML the moment somebody has run `pnpm build`.
 */
const BACKEND = 'http://127.0.0.1:8765'

/**
 * The split between the two test projects below is by extension — a `.tsx` test renders
 * something and needs a DOM, a `.ts` test is pure logic and does not. These are the
 * exceptions: `.ts` files that still want jsdom, for `renderHook` or for `localStorage`.
 * A new one announces itself loudly, as `document is not defined`.
 */
const DOM_LOGIC_TESTS = [
  'src/lib/board/linePreviewPrefs.test.ts',
  'src/routes/dashboard/useRunActivity.test.ts',
  'src/routes/game/maiaPreferences.test.ts',
  'src/routes/game/sessionVariations.test.ts',
  'src/routes/games/savedFilters.test.ts',
]

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    port: 5273,
    proxy: {
      '/api': {
        target: BACKEND,
        changeOrigin: true,
      },
      '/events': {
        target: BACKEND,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  test: {
    globals: true,
    css: false,
    // Threads, not the default forks: a fork is a whole Node process, and on Windows
    // spawning a dozen of them costs more than the tests inside them.
    pool: 'threads',
    projects: [
      {
        extends: true,
        test: {
          name: 'logic',
          // Standing up a jsdom is by far the most expensive thing this suite does —
          // whole seconds per file, against milliseconds for the assertions. Tests
          // that never reach for a DOM should not pay it.
          environment: 'node',
          setupFiles: ['./src/test/setup.node.ts'],
          include: ['src/**/*.{test,spec}.ts'],
          exclude: [...configDefaults.exclude, ...DOM_LOGIC_TESTS],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.{test,spec}.tsx', ...DOM_LOGIC_TESTS],
        },
      },
    ],
  },
})

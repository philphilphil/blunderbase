/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import { lingui, linguiTransformerBabelPreset } from '@lingui/vite-plugin'
import babel from '@rolldown/plugin-babel'
import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

import { engineAssets } from './vite-engine-assets.ts'

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
  'src/lib/analysis/enginePreference.test.ts',
  'src/lib/board/linePreviewPrefs.test.ts',
  'src/lib/board/moveSoundPrefs.test.ts',
  'src/lib/ui/evalGraphPrefs.test.ts',
  'src/routes/dashboard/useRunActivity.test.ts',
  'src/routes/game/maiaPreferences.test.ts',
  'src/routes/game/sessionVariations.test.ts',
  'src/routes/games/gameTrail.test.ts',
  'src/routes/games/paging.test.ts',
  'src/routes/games/savedFilters.test.ts',
]

export default defineConfig({
  plugins: [
    react(),
    // The Lingui macros (`<Trans>`, `t`, `msg`) are a Babel transform, and Vite 8's own
    // transformer is not Babel, so the preset rides on rolldown's Babel plugin and touches
    // only files that import a macro. `lingui()` is what lets a `.po` catalog be imported
    // as compiled messages. Both are inherited by the vitest projects below, so tests see
    // the same code the browser does.
    lingui(),
    babel({ presets: [linguiTransformerBabelPreset()] }),
    tailwindcss(),
    engineAssets(),
  ],
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  // 4.5 MB of prebuilt emscripten glue and wasm, imported by nobody: the package is here
  // for its types and for the two files `engineAssets()` copies out of it. Pre-bundling it
  // would be a dev-server stall for a module that is never evaluated, and worse, an
  // invitation for it to end up in a JS chunk.
  optimizeDeps: { exclude: ['@lichess-org/stockfish-web'] },
  server: {
    port: 5273,
    // The same pair `api/web.py` puts on the document in production. Without them the dev
    // page is not cross-origin isolated, gets no `SharedArrayBuffer`, and the browser
    // runner's engine — a pthread build — cannot allocate its memory at all. Leaving this
    // out would make the feature untestable under `make run` for a reason that looks like a
    // bug in the runner rather than a missing header on the dev server.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: {
      '/api': {
        target: BACKEND,
        changeOrigin: true,
        // A browser tab that registers as a runner dials `/api/runner/ws`, and only the
        // paths listed here are proxied at all — without this the socket would try to
        // upgrade against Vite itself and be answered by the HMR endpoint.
        ws: true,
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

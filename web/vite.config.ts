/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})

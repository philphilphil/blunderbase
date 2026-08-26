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
 * The backend mounts its routers at the bare paths (`/games`, `/analysis`, …), so the
 * client talks to `/api/*` and the dev proxy strips that prefix on the way through. A
 * deployment that puts the API somewhere else only has to keep the same `/api` mount.
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
        rewrite: (route) => route.replace(/^\/api/, ''),
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

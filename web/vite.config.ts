/// <reference types="vitest/config" />
import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The backend mounts its routers at the bare paths (`/games`, `/analysis`, …), so the
 * client talks to `/api/*` and the dev proxy strips that prefix on the way through. A
 * deployment that puts the API somewhere else only has to keep the same `/api` mount.
 */
const BACKEND = 'http://127.0.0.1:8765'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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

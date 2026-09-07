// Setup for the tests that render. The environment-agnostic half lives next door.
import './setup.node'

import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
})

// jsdom has neither, and chessground measures the board with both.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

// jsdom lays nothing out, so it has no scrolling either — the command palette keeps its
// highlight in view with this.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}

if (!globalThis.matchMedia) {
  Object.defineProperty(globalThis, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

/**
 * A `localStorage` that works, for the tests that read one.
 *
 * Not a convenience: it is what makes a local run and CI the same run. jsdom's own storage
 * is there on the CI runner and *missing* under a newer Node, which starts its own
 * `localStorage` global and then refuses to use it without `--localstorage-file`. So a
 * preference written in one test survived into the next on CI and evaporated on a laptop —
 * and a suite that only fails in one of the two places is a suite nobody can trust.
 *
 * One store per test file, since vitest gives each file its own module registry, and it
 * keeps its contents between the tests in that file exactly as a browser would. The prefs
 * tests still stub their own over the top of it; `vi.unstubAllGlobals` puts this back.
 */
{
  const values = new Map<string, string>()
  const store: Storage = {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, String(value)),
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: store,
  })
}

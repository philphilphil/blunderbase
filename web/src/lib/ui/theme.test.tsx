import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeToggle } from '@/components/shell/ThemeToggle'

import {
  applyTheme,
  DEFAULT_PREFERENCE,
  readStoredPreference,
  resolveTheme,
  THEME_BOOTSTRAP,
  THEME_STORAGE_KEY,
  ThemeProvider,
} from './theme'

/**
 * jsdom in this setup exposes no `localStorage`, which is also exactly the shape of a
 * browser with site data blocked — so the stub is opt-in per test and the tests that skip
 * it prove the module copes without one.
 */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  }
}

/** A `matchMedia` whose answer this test controls, and whose listeners it can fire. */
function stubMatchMedia(light: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const query = {
    matches: light,
    media: '(prefers-color-scheme: light)',
    addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => {
      listeners.add(fn)
    },
    removeEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => {
      listeners.delete(fn)
    },
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  )
  return {
    set(next: boolean) {
      query.matches = next
      for (const fn of listeners) fn({ matches: next } as MediaQueryListEvent)
    },
  }
}

let storage: Storage

beforeEach(() => {
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
  document.documentElement.className = ''
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.style.colorScheme = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveTheme', () => {
  it('takes an explicit preference at face value', () => {
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('light', false)).toBe('light')
  })

  it('reads the OS only when the preference is system', () => {
    expect(resolveTheme('system', true)).toBe('light')
    expect(resolveTheme('system', false)).toBe('dark')
  })
})

describe('readStoredPreference', () => {
  it('returns the stored preference', () => {
    storage.setItem(THEME_STORAGE_KEY, 'light')
    expect(readStoredPreference()).toBe('light')
  })

  it('falls back to the default for a missing or junk entry', () => {
    expect(readStoredPreference()).toBe(DEFAULT_PREFERENCE)
    storage.setItem(THEME_STORAGE_KEY, 'sepia')
    expect(readStoredPreference()).toBe(DEFAULT_PREFERENCE)
  })

  it('survives storage that throws, and a browser with none at all', () => {
    const hostile = {
      getItem() {
        throw new Error('storage disabled')
      },
    } as unknown as Storage
    expect(readStoredPreference(hostile)).toBe(DEFAULT_PREFERENCE)

    vi.stubGlobal('localStorage', undefined)
    expect(readStoredPreference()).toBe(DEFAULT_PREFERENCE)
  })
})

describe('applyTheme', () => {
  it('writes the resolved class, the preference and the colour scheme onto the root', () => {
    applyTheme('system', 'light')
    const root = document.documentElement
    expect(root.classList.contains('light')).toBe(true)
    expect(root.classList.contains('dark')).toBe(false)
    expect(root.getAttribute('data-theme')).toBe('system')
    expect(root.style.colorScheme).toBe('light')
  })

  it('replaces the previous theme class rather than stacking one on top', () => {
    applyTheme('dark', 'dark')
    applyTheme('light', 'light')
    expect(document.documentElement.className).toBe('light')
  })
})

describe('<ThemeToggle>', () => {
  const renderToggle = () =>
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    )

  it('starts on the stored preference and marks it pressed', () => {
    stubMatchMedia(false)
    storage.setItem(THEME_STORAGE_KEY, 'light')
    renderToggle()
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.classList.contains('light')).toBe(true)
  })

  it('persists a choice and re-themes the root', async () => {
    stubMatchMedia(false)
    renderToggle()
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: 'Light' }))
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('follows prefers-color-scheme live while the preference is system', async () => {
    const media = stubMatchMedia(false)
    renderToggle()

    await userEvent.click(screen.getByRole('button', { name: 'Match the system' }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    media.set(true)
    expect(await screen.findByTitle('Match the system — currently light')).toBeInTheDocument()
    expect(document.documentElement.classList.contains('light')).toBe(true)
  })

  it('ignores the OS once a theme is picked explicitly', async () => {
    const media = stubMatchMedia(false)
    renderToggle()

    await userEvent.click(screen.getByRole('button', { name: 'Dark' }))
    media.set(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})

describe('the pre-hydration bootstrap', () => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')
  const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

  it('is inlined in index.html verbatim', () => {
    expect(squash(html)).toContain(squash(THEME_BOOTSTRAP))
  })

  it('runs before the app bundle, so the first paint is already themed', () => {
    expect(html.indexOf('blunderbase.theme')).toBeLessThan(html.indexOf('/src/main.tsx'))
  })

  it('applies the stored preference the same way the provider does', () => {
    storage.setItem(THEME_STORAGE_KEY, 'light')
    stubMatchMedia(false)
    // eslint-disable-next-line no-eval
    ;(0, eval)(THEME_BOOTSTRAP)
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})

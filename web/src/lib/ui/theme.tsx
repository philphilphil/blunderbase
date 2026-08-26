/**
 * Dark / light / system theming.
 *
 * The palette lives entirely in `index.css`: `:root` is the design file's dark palette and
 * `:root.light` restates the same `--bb-*` names on a light ground. All this module does is
 * decide which of the two classes the root element carries, keep the choice in
 * `localStorage`, and follow `prefers-color-scheme` while the preference is `system`.
 *
 * The first paint is settled before React runs by the inline script in `index.html`, which
 * applies exactly the same rules — see `THEME_BOOTSTRAP` below, which is the source that
 * script is copied from.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

/** What the owner picked. `system` is resolved against `prefers-color-scheme`. */
export type ThemePreference = 'dark' | 'light' | 'system'
/** What the root element ends up wearing. */
export type ResolvedTheme = 'dark' | 'light'

export const THEME_STORAGE_KEY = 'blunderbase.theme'
export const THEME_PREFERENCES: readonly ThemePreference[] = ['dark', 'light', 'system']

/**
 * Dark is the default rather than `system`: it is the palette the design was drawn in and
 * the one the app is meant to be seen in (docs/design/README.md). A light OS does not
 * silently opt the owner out of it — picking `system` does.
 */
export const DEFAULT_PREFERENCE: ThemePreference = 'dark'

const LIGHT_QUERY = '(prefers-color-scheme: light)'

/** The `--bb-void` of each theme, for the browser-chrome `theme-color` meta. */
const THEME_COLOR: Record<ResolvedTheme, string> = {
  dark: '#08090b',
  light: '#f4f6f8',
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'dark' || value === 'light' || value === 'system'
}

/** Pure: the class the root should carry, given a preference and the OS signal. */
export function resolveTheme(preference: ThemePreference, prefersLight: boolean): ResolvedTheme {
  if (preference === 'system') return prefersLight ? 'light' : 'dark'
  return preference
}

/** A missing, unreadable or unrecognised entry falls back to the default. */
export function readStoredPreference(storage?: Storage): ThemePreference {
  try {
    const store = storage ?? window.localStorage
    const value = store.getItem(THEME_STORAGE_KEY)
    return isThemePreference(value) ? value : DEFAULT_PREFERENCE
  } catch {
    return DEFAULT_PREFERENCE
  }
}

function storePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Private mode, or storage disabled — the choice simply does not survive a reload.
  }
}

function prefersLight(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(LIGHT_QUERY).matches
}

/**
 * Writes the resolved theme onto `<html>`: the class the stylesheet keys off, the
 * `data-theme` attribute carrying the *preference* (so `system` is visible to anything
 * inspecting the DOM), `color-scheme` for native form controls and scrollbars, and the
 * `theme-color` meta for the browser's own chrome.
 */
export function applyTheme(preference: ThemePreference, resolved: ResolvedTheme): void {
  const root = document.documentElement
  root.classList.remove('dark', 'light')
  root.classList.add(resolved)
  root.setAttribute('data-theme', preference)
  root.style.colorScheme = resolved
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLOR[resolved])
}

export interface ThemeValue {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
}

const ThemeContext = createContext<ThemeValue | null>(null)

/**
 * Owns the preference. The media-query listener stays attached whatever the preference is,
 * so switching *to* `system` lands on the right theme without waiting for the OS to change.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredPreference())
  const [light, setLight] = useState<boolean>(() => prefersLight())

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(LIGHT_QUERY)
    const onChange = (event: MediaQueryListEvent) => setLight(event.matches)
    query.addEventListener?.('change', onChange)
    return () => query.removeEventListener?.('change', onChange)
  }, [])

  const resolved = resolveTheme(preference, light)

  useEffect(() => {
    applyTheme(preference, resolved)
  }, [preference, resolved])

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    storePreference(next)
  }, [])

  const value = useMemo<ThemeValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme used outside <ThemeProvider>')
  return value
}

/**
 * The pre-hydration script, kept here so the rules live in one file. `index.html` inlines a
 * copy of this string verbatim; `theme.test.ts` asserts the two stay in step.
 */
export const THEME_BOOTSTRAP = `(function () {
  var root = document.documentElement
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}')
    var pref = stored === 'dark' || stored === 'light' || stored === 'system' ? stored : '${DEFAULT_PREFERENCE}'
    var resolved = pref === 'system' ? (matchMedia('${LIGHT_QUERY}').matches ? 'light' : 'dark') : pref
    root.classList.remove('dark', 'light')
    root.classList.add(resolved)
    root.setAttribute('data-theme', pref)
    root.style.colorScheme = resolved
    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', resolved === 'light' ? '${THEME_COLOR.light}' : '${THEME_COLOR.dark}')
  } catch (error) {
    root.classList.add('${DEFAULT_PREFERENCE}')
  }
})()`

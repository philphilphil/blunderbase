/**
 * Which language the UI speaks, and how that is decided.
 *
 * The choice is the browser's, not the account's: it lives in `localStorage` beside the
 * theme, because a phone in German and a desk in English is a real setup, and because the
 * login screen has to be readable before there is a session to read a preference from.
 * With nothing stored the browser's own language list decides, and anything that is not
 * a language we have falls back to English — the source language, so it is never missing.
 *
 * Catalogs are loaded on demand: only the language in use is in the page. `activateLocale`
 * is the one door — `main.tsx` awaits it before the first render so no screen ever paints
 * in one language and flips to another, and the provider calls it again on a switch.
 */
import { i18n, type Messages } from '@lingui/core'

export type Locale = 'en' | 'de'

export const LOCALES: readonly Locale[] = ['en', 'de']

/** A language's name in itself, which is the one form every reader recognises. Never translated. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
}

export const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_STORAGE_KEY = 'blunderbase.locale'

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'de'
}

/** The stored choice, or `null` when there is none — the caller then asks the browser. */
export function readStoredLocale(storage?: Storage): Locale | null {
  try {
    const store = storage ?? window.localStorage
    const value = store.getItem(LOCALE_STORAGE_KEY)
    return isLocale(value) ? value : null
  } catch {
    return null
  }
}

export function storeLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Private mode, or storage disabled — the choice simply does not survive a reload.
  }
}

/**
 * Pure: the first of the browser's languages we have, by primary subtag, so `de-CH` and
 * `de-AT` are German. Nothing matching is English.
 */
export function detectLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const primary = tag.toLowerCase().split('-')[0]
    if (isLocale(primary)) return primary
  }
  return DEFAULT_LOCALE
}

/** What the page should start in: the stored choice, else the browser's. */
export function initialLocale(): Locale {
  return readStoredLocale() ?? detectLocale(navigator.languages ?? [navigator.language])
}

/** The language the global instance currently speaks; English before any activation. */
export function currentLocale(): Locale {
  return isLocale(i18n.locale) ? i18n.locale : DEFAULT_LOCALE
}

/**
 * The BCP 47 tag for a date that is written out in words — `22 Aug 2026`, `22. Aug. 2026`.
 * Numbers and clock times follow the browser, because a German owner reading English still
 * wants their thousands separator; a month name is a word, and words follow the UI.
 * English is British, which is the day-month-year order every game site prints.
 */
export function dateLocale(): string {
  return currentLocale() === 'de' ? 'de-DE' : 'en-GB'
}

async function loadCatalog(locale: Locale): Promise<Messages> {
  const { messages } = (await import(`../../locales/${locale}/messages.po`)) as {
    messages: Messages
  }
  return messages
}

/**
 * Load a catalog and make it the active one. `<html lang>` follows so screen readers,
 * hyphenation and `:lang()` see the same language the text is in.
 */
export async function activateLocale(locale: Locale): Promise<void> {
  const messages = await loadCatalog(locale)
  i18n.loadAndActivate({ locale, messages })
  document.documentElement.lang = locale
}

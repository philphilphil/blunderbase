/**
 * The language provider: Lingui's own context, plus the switch.
 *
 * The first activation has already happened by the time this mounts — `main.tsx` awaits
 * `activateLocale` before rendering, and the tests activate English in their setup — so
 * the provider starts synchronously from whatever the global instance speaks. Switching
 * loads the other catalog, then remounts everything under it: the `key` is what makes a
 * string formatted outside React (a helper that uses the global `t`, a label computed
 * once in a module) come back in the new language, rather than only the components that
 * happen to subscribe. A switch is rare and deliberate; a remount is the honest price.
 */
import { i18n } from '@lingui/core'
import { I18nProvider as LinguiProvider } from '@lingui/react'
import { createContext, Fragment, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

import { activateLocale, currentLocale, storeLocale, type Locale } from './locale'

interface LocaleContextValue {
  locale: Locale
  setLocale: (locale: Locale) => Promise<void>
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(currentLocale)

  const setLocale = useCallback(async (next: Locale) => {
    storeLocale(next)
    await activateLocale(next)
    setLocaleState(next)
  }, [])

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale])

  return (
    <LocaleContext.Provider value={value}>
      <LinguiProvider i18n={i18n}>
        <Fragment key={locale}>{children}</Fragment>
      </LinguiProvider>
    </LocaleContext.Provider>
  )
}

/** The active language and the switch. Outside the provider: the global's, and no switch. */
export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext)
  return (
    context ?? {
      locale: currentLocale(),
      setLocale: async () => {},
    }
  )
}

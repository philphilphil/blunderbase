/**
 * What the Lingui macros compile to. `lingui.config.ts` points `<Trans>` and `useLingui`
 * here instead of at `@lingui/react`, and the only difference is what happens with no
 * provider above: the library throws, these fall back to the global `i18n` instance.
 *
 * The app always has the provider (`Providers`), so in the browser nothing changes. The
 * fallback is for the tests: sixty-odd of them render a component on its own, and every
 * one would otherwise need wrapping for a context it does not care about. Under the
 * fallback a component reads the active catalog the same way, it just does not re-render
 * when the language changes — and in a test it never does.
 */
import { i18n } from '@lingui/core'
import {
  LinguiContext,
  Trans as LinguiTrans,
  type I18nContext,
  type TransProps,
} from '@lingui/react'
import { useContext } from 'react'

const GLOBAL: I18nContext = { i18n, _: i18n._.bind(i18n) }

export function useLingui(): I18nContext {
  return useContext(LinguiContext) ?? GLOBAL
}

export function Trans(props: TransProps) {
  const context = useContext(LinguiContext)
  if (context) return <LinguiTrans {...props} />
  return (
    <LinguiContext.Provider value={GLOBAL}>
      <LinguiTrans {...props} />
    </LinguiContext.Provider>
  )
}

import { defineConfig } from '@lingui/cli'
import { formatter } from '@lingui/format-po'

/**
 * The message catalogs: one `.po` per language under `src/locales/`, extracted from the
 * source with `pnpm i18n` and imported as-is — the Vite plugin compiles them at build time,
 * so there is no generated file to check in and no compile step to forget.
 *
 * English is the source language: the string in the component *is* the English text and
 * the message id is derived from it, so the English catalog is only a listing. Sorting by
 * origin keeps a translator reading the screens in the order the code draws them, rather
 * than an alphabet of fragments.
 *
 * `runtimeConfigModule` points the macros at our own `Trans`/`useLingui` — see
 * `src/lib/i18n/runtime.tsx` for why. Line numbers stay out of the origin comments so a
 * one-line edit does not rewrite two catalogs.
 */
export default defineConfig({
  locales: ['en', 'de'],
  sourceLocale: 'en',
  catalogs: [
    {
      path: '<rootDir>/src/locales/{locale}/messages',
      include: ['<rootDir>/src'],
      exclude: ['**/*.test.*', '**/test/**'],
    },
  ],
  orderBy: 'origin',
  format: formatter({ lineNumbers: false }),
  runtimeConfigModule: {
    Trans: ['@/lib/i18n/runtime', 'Trans'],
    useLingui: ['@/lib/i18n/runtime', 'useLingui'],
  },
})

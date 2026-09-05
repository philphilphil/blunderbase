/**
 * Where the manual is, for whoever wants to send a reader to it.
 *
 * The manual is a second site served by this same installation at `/manual/`, so it is
 * always the version that is running and it works with no network at all — the container
 * and the desktop application both carry it. That is why nothing here points at
 * blunderbase.org: a copy on a laptop in a tournament hall has to answer too.
 *
 * English is the manual's default language and sits at the root of that site; every other
 * language is a subtree under its own code. Pages are directory URLs — `/manual/guide/
 * analysis/`, with the trailing slash — because that is what MkDocs writes and what the
 * relative links inside a page resolve against. An anchor therefore goes after the slash,
 * not instead of it.
 */
import { DEFAULT_LOCALE, type Locale } from './i18n/locale'

const MANUAL_ROOT = '/manual'

/**
 * The URL of a manual page: `guide/analysis`, or `operate/runners#revoking` for a heading
 * inside one. With no path, the manual's front page in that language.
 */
export function manualUrl(locale: Locale, path = ''): string {
  const [page = '', anchor] = path.split('#')
  const root = locale === DEFAULT_LOCALE ? MANUAL_ROOT : `${MANUAL_ROOT}/${locale}`
  const trimmed = page.replace(/^\/+/, '').replace(/\/+$/, '')
  const url = trimmed === '' ? `${root}/` : `${root}/${trimmed}/`
  return anchor ? `${url}#${anchor}` : url
}

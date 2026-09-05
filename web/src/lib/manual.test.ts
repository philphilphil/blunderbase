import { describe, expect, it } from 'vitest'

import { manualUrl } from './manual'

describe('manualUrl', () => {
  it('puts English at the root of the manual and every other language under its code', () => {
    expect(manualUrl('en', 'guide/analysis')).toBe('/manual/guide/analysis/')
    expect(manualUrl('de', 'guide/analysis')).toBe('/manual/de/guide/analysis/')
  })

  it('answers the front page when no page is asked for', () => {
    expect(manualUrl('en')).toBe('/manual/')
    expect(manualUrl('de')).toBe('/manual/de/')
  })

  it('keeps the anchor after the trailing slash, which is where the page lives', () => {
    expect(manualUrl('en', 'operate/runners#revoking')).toBe('/manual/operate/runners/#revoking')
    expect(manualUrl('de', 'guide/library#connect-an-account')).toBe(
      '/manual/de/guide/library/#connect-an-account',
    )
  })

  it('does not double a slash a caller wrote either end of the path', () => {
    expect(manualUrl('en', '/guide/notes/')).toBe('/manual/guide/notes/')
  })
})

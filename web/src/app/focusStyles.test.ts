import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

describe('global focus styles', () => {
  it('keeps focus outlines layered so utilities can suppress landmark focus', () => {
    const baseLayerStart = css.indexOf('@layer base')

    expect(baseLayerStart).toBeGreaterThan(-1)
    expect(css.slice(0, baseLayerStart)).not.toContain('[tabindex]):focus-visible')
    expect(css.slice(baseLayerStart)).toMatch(/:focus-visible\s*\{[^}]*outline:/s)
  })
})

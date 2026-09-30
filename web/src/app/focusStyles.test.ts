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

  // The clarity pass (spec §3.1): the ring is solid accent, because the 55 % mix it replaced
  // was 2.37:1 on the light panel and failed WCAG's 3:1 for a focus indicator.
  it('draws the ring in solid accent, two design px out', () => {
    const rule = css.slice(css.indexOf('@layer base')).match(/:focus-visible\s*\{([^}]*)\}/s)
    expect(rule?.[1]).toMatch(/outline:\s*0\.125rem solid var\(--bb-accent\);/)
    expect(rule?.[1]).toMatch(/outline-offset:\s*0\.125rem;/)
  })
})

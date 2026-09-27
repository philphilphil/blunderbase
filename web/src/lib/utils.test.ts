import { describe, expect, it } from 'vitest'

import { cn } from './utils'

/**
 * The type scale's names are not stock Tailwind, so tailwind-merge has to be told they are
 * sizes. These pin the three ways that goes wrong: a size eating a colour, two sizes both
 * surviving, and a stock size surviving beside a named one.
 */
describe('cn', () => {
  it('keeps a text colour beside a named size', () => {
    expect(cn('text-dim', 'text-meta')).toBe('text-dim text-meta')
    expect(cn('text-meta', 'text-dim')).toBe('text-meta text-dim')
  })

  it('lets a later named size replace an earlier one', () => {
    expect(cn('text-meta', 'text-label')).toBe('text-label')
  })

  it('lets a named size replace a stock one', () => {
    expect(cn('text-xs', 'text-data')).toBe('text-data')
  })

  it('knows all seven names', () => {
    for (const size of ['meta', 'label', 'data', 'lead', 'heading', 'value', 'title']) {
      expect(cn('text-ink', `text-${size}`)).toBe(`text-ink text-${size}`)
      expect(cn('text-xs', `text-${size}`)).toBe(`text-${size}`)
    }
  })
})

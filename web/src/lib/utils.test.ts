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
    expect(cn('text-data', 'text-data')).toBe('text-data')
  })

  it('knows all six names', () => {
    for (const size of ['meta', 'label', 'data', 'lead', 'heading', 'value']) {
      expect(cn('text-ink', `text-${size}`)).toBe(`text-ink text-${size}`)
      expect(cn('text-data', `text-${size}`)).toBe(`text-${size}`)
    }
  })

  // The control grammar's shadows (index.css) are sizes of shadow, not colours: a call
  // site that flattens a face with `shadow-none` must drop the face's shade.
  it('lets a later shadow replace one of the control grammar shadows', () => {
    for (const shadow of ['face', 'field', 'thumb', 'tab-on', 'row-bar']) {
      expect(cn(`shadow-${shadow}`, 'shadow-none')).toBe('shadow-none')
    }
    expect(cn('shadow-face', 'shadow-thumb')).toBe('shadow-thumb')
  })
})

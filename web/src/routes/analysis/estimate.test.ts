import { describe, expect, it } from 'vitest'

import { estimateLabel } from './estimate'

describe('estimateLabel', () => {
  it('turns engine-seconds into the wall clock the owner is deciding about', () => {
    // Twelve hours of work over four runners is three hours of evening.
    expect(estimateLabel(12 * 3600, 4)).toBe('~3h')
    expect(estimateLabel(12_000, 1)).toBe('~3h 20m')
    expect(estimateLabel(840, 1)).toBe('~14m')
  })

  it('does not hedge a duration that is already the smallest thing it can say', () => {
    expect(estimateLabel(30, 1)).toBe('under a minute')
    expect(estimateLabel(0, 8)).toBe('under a minute')
  })

  it('shows nothing where the backend measured nothing', () => {
    // Null is the deployment saying too few runs have finished at this budget to average,
    // and a made-up number on this page is worse than the empty space.
    expect(estimateLabel(null, 4)).toBeNull()
    expect(estimateLabel(undefined, 4)).toBeNull()
  })

  it('treats a backend that reported no concurrency as one at a time', () => {
    expect(estimateLabel(3600, 0)).toBe('~1h')
  })
})

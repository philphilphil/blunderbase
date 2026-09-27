import { describe, expect, it } from 'vitest'

import { dayEnd, dayStart, localDay, parseDay, parsePreset, presetOf, presetStart } from './days'

describe('days', () => {
  it('names the reader’s calendar day, not UTC’s', () => {
    const lateEvening = new Date(2026, 0, 5, 23, 30)
    expect(localDay(0, lateEvening)).toBe('2026-01-05')
    // Across a month end, counted in days on the calendar.
    expect(localDay(5, lateEvening)).toBe('2025-12-31')
  })

  it('turns a day into the instants it starts and ends at', () => {
    expect(dayStart('2026-09-27')).toBe(new Date(2026, 8, 27).toISOString())
    expect(dayEnd('2026-09-27')).toBe(new Date(2026, 8, 27, 23, 59, 59, 999).toISOString())
  })

  it('reads days and picks from a URL, and nothing else', () => {
    expect(parseDay('2026-09-27')).toBe('2026-09-27')
    expect(parseDay('27.09.2026')).toBeNull()
    expect(parsePreset('30d')).toBe('30d')
    expect(parsePreset('all')).toBeNull()
  })

  it('lights a pick only while the dates still say exactly that', () => {
    expect(presetOf(presetStart('30d'), undefined)).toBe('30d')
    expect(presetOf(localDay(), undefined)).toBe('today')
    expect(presetOf(presetStart('30d'), localDay())).toBeNull()
    expect(presetOf('2020-01-01', undefined)).toBeNull()
  })
})

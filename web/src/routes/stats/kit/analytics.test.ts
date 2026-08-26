import { describe, expect, it } from 'vitest'

import {
  WINDOW_DAYS,
  anchorOf,
  asPercent,
  deltaTone,
  formatCount,
  formatDelta,
  hourLabel,
  lossCounts,
  num,
  numOr,
  periodLabel,
  precedingWindow,
  shortDate,
  windowProse,
  windowRange,
} from './analytics'

const NOW = new Date('2026-08-26T12:00:00.000Z')
const DAY = 86_400_000

describe('windowRange', () => {
  it('is unbounded for "all", so the filters carry nothing', () => {
    expect(windowRange('all', NOW)).toEqual({})
  })

  it('ends now and reaches back the window length', () => {
    const range = windowRange('30d', NOW)
    expect(range.until).toBe(NOW.toISOString())
    expect(Date.parse(range.until as string) - Date.parse(range.since as string)).toBe(
      WINDOW_DAYS['30d'] * DAY,
    )
  })
})

describe('precedingWindow', () => {
  it('is the equally long window ending where the current one starts', () => {
    const current = windowRange('7d', NOW)
    const previous = precedingWindow(current)
    expect(previous).not.toBeNull()
    expect(previous?.then_end).toBe(current.since)
    expect(previous?.now_end).toBe(current.until)
    expect(Date.parse(previous!.then_end) - Date.parse(previous!.then_start)).toBe(7 * DAY)
  })

  it('has nothing to compare against when the window is unbounded', () => {
    expect(precedingWindow({})).toBeNull()
    expect(precedingWindow({ since: NOW.toISOString() })).toBeNull()
  })

  it('refuses a window that runs backwards', () => {
    expect(
      precedingWindow({
        since: NOW.toISOString(),
        until: new Date(NOW.getTime() - DAY).toISOString(),
      }),
    ).toBeNull()
  })

  it('is stable across calls, so the query key does not churn', () => {
    const filters = windowRange('30d', NOW)
    expect(precedingWindow(filters)).toEqual(precedingWindow(filters))
  })
})

describe('anchorOf', () => {
  it('ends the window at the newest game when that is in the past', () => {
    const stale = '2016-12-07T13:17:53.133000+00:00'
    expect(anchorOf(stale, NOW).toISOString()).toBe(new Date(stale).toISOString())
  })

  it('ends the window now when the newest game is today', () => {
    const today = new Date(NOW.getTime() - 3600_000).toISOString()
    expect(anchorOf(today, NOW).getTime()).toBe(NOW.getTime() - 3600_000)
    expect(windowProse('7d', anchorOf(today, NOW), NOW)).toBe('the last 7 days')
  })

  it('falls back to now when nothing has been imported or the stamp is junk', () => {
    expect(anchorOf(null, NOW)).toBe(NOW)
    expect(anchorOf('not a date', NOW)).toBe(NOW)
  })

  it('never runs past now, so a clock-skewed game does not open a future window', () => {
    const future = new Date(NOW.getTime() + 10 * DAY).toISOString()
    expect(anchorOf(future, NOW)).toBe(NOW)
  })
})

describe('windowProse', () => {
  it('reads as "the last N days" while the anchor is current', () => {
    expect(windowProse('30d', NOW, NOW)).toBe('the last 30 days')
    expect(windowProse('all', NOW, NOW)).toBe('all time')
  })

  it('names the date it ends on once the anchor is in the past', () => {
    const anchor = new Date('2016-12-07T13:17:53.000Z')
    expect(windowProse('90d', anchor, NOW)).toMatch(/^the 90 days to /)
  })
})

describe('reading buckets', () => {
  const bucket = {
    key: 'middlegame',
    blunder: 28,
    blunder_rate: 0.1037,
    avg_win_loss: null,
  }

  it('reads a number and refuses anything else', () => {
    expect(num(bucket, 'blunder')).toBe(28)
    expect(num(bucket, 'avg_win_loss')).toBeNull()
    expect(num(bucket, 'key')).toBeNull()
    expect(num(undefined, 'blunder')).toBeNull()
  })

  it('defaults a missing count to zero', () => {
    expect(numOr(bucket, 'mistake')).toBe(0)
    expect(numOr(bucket, 'mistake', 7)).toBe(7)
  })

  it('reads the three loss classifications together', () => {
    expect(lossCounts({ key: 'x', inaccuracy: 3, blunder: 1 })).toEqual({
      inaccuracy: 3,
      mistake: 0,
      blunder: 1,
    })
  })
})

describe('numbers', () => {
  it('turns a backend fraction into a percentage', () => {
    expect(asPercent(0.4831)).toBe(48.3)
    expect(asPercent(null)).toBeNull()
  })

  it('signs a delta with the typographic minus', () => {
    expect(formatDelta(1.64)).toBe('+1.6')
    expect(formatDelta(-0.42)).toBe('−0.4')
    expect(formatDelta(0)).toBe('±0.0')
    expect(formatDelta(null)).toBe('—')
  })

  it('reads a direction as progress or as regress', () => {
    expect(deltaTone(-0.4, true)).toBe('good')
    expect(deltaTone(0.4, true)).toBe('blunder')
    expect(deltaTone(0.4, false)).toBe('good')
    expect(deltaTone(0, true)).toBe('dim')
    expect(deltaTone(null, true)).toBe('dim')
  })

  it('formats counts and dates the way the design writes them', () => {
    expect(formatCount(1284)).toBe((1284).toLocaleString())
    expect(formatCount(null)).toBe('—')
    expect(shortDate(null)).toBe('—')
    expect(shortDate('not a date')).toBe('—')
    expect(hourLabel('7')).toBe('07:00')
    expect(hourLabel('total')).toBe('total')
  })

  it('names a rating_trend bucket by its month', () => {
    expect(periodLabel('2016-12')).toMatch(/16/)
    expect(periodLabel('total')).toBe('total')
  })
})

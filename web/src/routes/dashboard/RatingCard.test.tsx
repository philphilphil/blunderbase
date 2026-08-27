import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UseQueryResult } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProfileResponse, RatingPoint, RatingSeries } from '@/lib/api/types'

import { RatingCard } from './RatingCard'
import { HIDDEN_RATING_SPEEDS_KEY, resetHiddenSpeeds } from './ratingSpeeds'

const useProfile = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/queries', () => ({ useProfile }))

/** jsdom in this setup exposes no `localStorage`, so the tests bring their own (see
 *  `games/savedFilters.test.ts`). */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  }
}

function result(state: Partial<UseQueryResult<ProfileResponse, Error>>) {
  return {
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...state,
  }
}

const DAY_MS = 86_400_000
/** The anchor every fixture below is written back from — the newest rated game. */
const NOW = Date.parse('2026-08-20T12:00:00Z')

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString()
}

function points(...entries: [days: number, rating: number][]): RatingPoint[] {
  return entries.map(([days, rating]) => ({ at: daysAgo(days), rating }))
}

function series(
  platform: RatingSeries['platform'],
  speed: string,
  games: number,
  history: RatingPoint[],
): RatingSeries {
  return {
    platform,
    speed,
    games,
    current: history[history.length - 1]?.rating ?? null,
    points: history,
  }
}

const PROFILE: ProfileResponse = {
  accounts: [],
  volume: {},
  ratings: [
    // Blitz, both platforms, inside a 90-day window.
    series('lichess', 'blitz', 120, points([40, 1800], [10, 1834], [0, 1842])),
    series('chesscom', 'blitz', 60, points([35, 1490], [5, 1512])),
    // Rapid, one platform only, and old enough that 90d cuts it out entirely.
    series('lichess', 'rapid', 30, points([320, 1600], [300, 1655])),
    // A speed that never produced a point at all.
    series('chesscom', 'bullet', 0, []),
  ],
}

function draw(state: Partial<UseQueryResult<ProfileResponse, Error>>) {
  useProfile.mockReturnValue(result(state))
  return render(<RatingCard />)
}

describe('RatingCard — one chart per time control', () => {
  beforeEach(() => {
    useProfile.mockReset()
    vi.stubGlobal('localStorage', memoryStorage())
    resetHiddenSpeeds()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetHiddenSpeeds()
  })

  it('pulses while the profile is in flight', () => {
    draw({ isPending: true })
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('reports a failed fetch instead of an empty panel', () => {
    draw({ isError: true, error: new Error('profile exploded') })
    expect(screen.getByRole('alert')).toHaveTextContent('profile exploded')
  })

  it('says so when no game has ever been rated', () => {
    draw({ data: { accounts: [], volume: {}, ratings: [] } })
    expect(screen.getByTestId('empty')).toHaveTextContent(/no rated games yet/i)
  })

  it('draws only the speeds with points in the window, naming each platform on it', async () => {
    draw({ data: PROFILE })

    // The default window is everything, so both speeds with points chart at first.
    expect(screen.getByText('Rapid')).toBeInTheDocument()

    const windows = screen.getByRole('group', { name: 'Rating window' })
    await userEvent.click(within(windows).getByRole('button', { name: '90d' }))

    expect(screen.getByText('Blitz')).toBeInTheDocument()
    // Rapid stopped 300 days ago, so the 90-day window has nothing to draw.
    expect(screen.queryByText('Rapid')).not.toBeInTheDocument()
    // Bullet has a series but no points at all.
    expect(screen.queryByText('Bullet')).not.toBeInTheDocument()

    expect(screen.getByText('Lichess')).toBeInTheDocument()
    expect(screen.getByText('Chess.com')).toBeInTheDocument()
  })

  it('legends each line with where the platform ended and how far it moved', () => {
    draw({ data: PROFILE })
    // 1800 -> 1842 on Lichess, 1490 -> 1512 on Chess.com, both inside 90 days.
    expect(screen.getByText('1842')).toBeInTheDocument()
    expect(screen.getByText('+42')).toBeInTheDocument()
    expect(screen.getByText('1512')).toBeInTheDocument()
    expect(screen.getByText('+22')).toBeInTheDocument()
  })

  it('has no per-series picker left — only the window applies, and to every chart', async () => {
    draw({ data: PROFILE })
    expect(screen.queryByRole('group', { name: 'Rating series' })).not.toBeInTheDocument()

    const windows = screen.getByRole('group', { name: 'Rating window' })
    await userEvent.click(within(windows).getByRole('button', { name: '1y' }))

    expect(screen.getByText('Blitz')).toBeInTheDocument()
    expect(screen.getByText('Rapid')).toBeInTheDocument()
  })

  it('hiding a speed from the menu drops its chart and persists the choice', async () => {
    draw({ data: PROFILE })

    await userEvent.click(screen.getByRole('button', { name: /speeds/i }))
    const row = screen.getByRole('menuitemcheckbox', { name: 'Blitz' })
    expect(row).toHaveAttribute('aria-checked', 'true')

    await userEvent.click(row)
    expect(row).toHaveAttribute('aria-checked', 'false')

    const stored = JSON.parse(window.localStorage.getItem(HIDDEN_RATING_SPEEDS_KEY) ?? '[]')
    expect(stored).toContain('blitz')

    // The row and the chart header both say "Blitz" while the menu is open — close it
    // before asserting the chart itself is gone.
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText('Blitz')).not.toBeInTheDocument()
  })

  it('keeps a hidden speed hidden after remount, from what is already in storage', async () => {
    window.localStorage.setItem(HIDDEN_RATING_SPEEDS_KEY, JSON.stringify(['blitz']))
    resetHiddenSpeeds()
    draw({ data: PROFILE })

    // Widen the window so Rapid has something to draw — Blitz stays hidden regardless.
    const windows = screen.getByRole('group', { name: 'Rating window' })
    await userEvent.click(within(windows).getByRole('button', { name: '1y' }))

    expect(screen.getByText('Rapid')).toBeInTheDocument()
    expect(screen.queryByText('Blitz')).not.toBeInTheDocument()
  })

  it('says so when every speed present in the window is hidden', () => {
    window.localStorage.setItem(HIDDEN_RATING_SPEEDS_KEY, JSON.stringify(['blitz', 'rapid']))
    resetHiddenSpeeds()
    draw({ data: PROFILE })

    // Blitz and Rapid are every speed with points, so hiding both empties the panel.
    expect(screen.getByTestId('empty')).toHaveTextContent(/every speed is hidden/i)
  })
})

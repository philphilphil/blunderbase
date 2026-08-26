import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UseQueryResult } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProfileResponse, RatingPoint, RatingSeries } from '@/lib/api/types'

import { RatingCard } from './RatingCard'

const useProfile = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/queries', () => ({ useProfile }))

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
  beforeEach(() => useProfile.mockReset())

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

  it('draws only the speeds with points in the window, naming each platform on it', () => {
    draw({ data: PROFILE })

    expect(screen.getByText('Blitz')).toBeInTheDocument()
    // Rapid stopped 300 days ago, so the default 90-day window has nothing to draw.
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
})

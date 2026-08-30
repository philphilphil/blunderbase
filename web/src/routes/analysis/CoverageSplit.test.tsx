import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { AnalysisCoverage } from '@/lib/api/types'

import { CoverageSplit } from './CoverageSplit'

function coverage(overrides: Partial<AnalysisCoverage> = {}): AnalysisCoverage {
  return {
    total: 0,
    no_pass: 0,
    quick_only: 0,
    deep: 0,
    missing: { quick: 0, deep: 0 },
    failed: 0,
    maia: {
      configured: [],
      games_with_any: 0,
      per_level: [],
      missing_games: 0,
      orphan_levels: [],
    },
    estimates: {
      quick_seconds: null,
      deep_seconds: null,
      maia_seconds: null,
      concurrency: 1,
    },
    ...overrides,
  }
}

/** The bar's segments, in the order they are laid out. */
function segments() {
  const bar = screen.getByRole('img')
  return [...bar.children].map((child) => (child as HTMLElement).style.width)
}

describe('CoverageSplit', () => {
  it('shows the three buckets as counts and shares', () => {
    render(
      <CoverageSplit
        coverage={coverage({ total: 100, no_pass: 50, quick_only: 30, deep: 20 })}
      />,
    )

    expect(screen.getByText('50')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
    expect(screen.getByText('50.0%')).toBeInTheDocument()
    expect(screen.getByText('100 games')).toBeInTheDocument()
  })

  it('uses a real colour for quick and reserves grey for games with no pass', () => {
    render(
      <CoverageSplit
        coverage={coverage({ total: 100, no_pass: 50, quick_only: 30, deep: 20 })}
      />,
    )

    const [deep, quick, noPass] = screen.getByRole('img').children
    expect(deep).toHaveClass('bg-deep')
    expect(quick).toHaveClass('bg-accent-teal')
    expect(noPass).toHaveClass('bg-edge-strong')
  })

  /**
   * The library this was built for: 6,879 of 7,714 games have never been analysed, so one
   * segment is 89% of the bar. The design has to survive that — the two small buckets keep
   * a visible width, and their numbers are readable whatever the bar looks like.
   */
  it('stays readable when one bucket is 89% of the library', () => {
    render(
      <CoverageSplit
        coverage={coverage({ total: 7714, no_pass: 6879, quick_only: 374, deep: 461 })}
      />,
    )

    expect(screen.getByText('6,879')).toBeInTheDocument()
    expect(screen.getByText('374')).toBeInTheDocument()
    expect(screen.getByText('461')).toBeInTheDocument()
    expect(screen.getByText('89.2%')).toBeInTheDocument()
    expect(screen.getByText('4.8%')).toBeInTheDocument()
    // Every bucket with a game in it is drawn, and each keeps a floor width in CSS.
    expect(segments()).toHaveLength(3)
    for (const segment of screen.getByRole('img').children) {
      expect((segment as HTMLElement).style.minWidth).not.toBe('')
    }
  })

  it('draws no segment for a bucket with nothing in it', () => {
    render(
      <CoverageSplit coverage={coverage({ total: 10, no_pass: 0, quick_only: 4, deep: 6 })} />,
    )

    expect(segments()).toEqual(['60%', '40%'])
  })

  it('does not divide by an empty library', () => {
    render(<CoverageSplit coverage={coverage()} />)

    expect(screen.getByText('0 games')).toBeInTheDocument()
    expect(screen.getAllByText('0.0%')).toHaveLength(3)
    expect(segments()).toEqual([])
  })
})

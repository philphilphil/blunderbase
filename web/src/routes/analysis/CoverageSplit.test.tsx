import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { AnalysisCoverage } from '@/lib/api/types'

import { CoverageSplit } from './CoverageSplit'

function coverage(overrides: Partial<AnalysisCoverage> = {}): AnalysisCoverage {
  return {
    total: 0,
    analysed: 0,
    no_pass: 0,
    missing: 0,
    failed: 0,
    maia: {
      configured: [],
      games_with_any: 0,
      per_level: [],
      missing_games: 0,
      orphan_levels: [],
    },
    estimates: {
      analysis_seconds: null,
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
  it('shows the two buckets as counts and shares', () => {
    render(<CoverageSplit coverage={coverage({ total: 100, no_pass: 30, analysed: 70 })} />)

    expect(screen.getByText('70')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText('70.0%')).toBeInTheDocument()
    expect(screen.getByText('100 games')).toBeInTheDocument()
    expect(screen.getByText('Analysed')).toBeInTheDocument()
    expect(screen.getByText('No pass')).toBeInTheDocument()
  })

  it('uses a real colour for analysed games and reserves grey for games with no pass', () => {
    render(<CoverageSplit coverage={coverage({ total: 100, no_pass: 30, analysed: 70 })} />)

    const [analysed, noPass] = screen.getByRole('img').children
    expect(analysed).toHaveClass('bg-accent-teal')
    expect(noPass).toHaveClass('bg-edge-strong')
  })

  /**
   * The library this was built for: 6,879 of 7,714 games had never been analysed, so one
   * segment is 89% of the bar. The design has to survive that — the small bucket keeps a
   * visible width, and its number is readable whatever the bar looks like.
   */
  it('stays readable when one bucket is 89% of the library', () => {
    render(<CoverageSplit coverage={coverage({ total: 7714, no_pass: 6879, analysed: 835 })} />)

    expect(screen.getByText('6,879')).toBeInTheDocument()
    expect(screen.getByText('835')).toBeInTheDocument()
    expect(screen.getByText('89.2%')).toBeInTheDocument()
    expect(screen.getByText('10.8%')).toBeInTheDocument()
    // Every bucket with a game in it is drawn, and each keeps a floor width in CSS.
    expect(segments()).toHaveLength(2)
    for (const segment of screen.getByRole('img').children) {
      expect((segment as HTMLElement).style.minWidth).not.toBe('')
    }
  })

  it('draws no segment for a bucket with nothing in it', () => {
    render(<CoverageSplit coverage={coverage({ total: 10, no_pass: 0, analysed: 10 })} />)

    expect(segments()).toEqual(['100%'])
  })

  it('does not divide by an empty library', () => {
    render(<CoverageSplit coverage={coverage()} />)

    expect(screen.getByText('0 games')).toBeInTheDocument()
    expect(screen.getAllByText('0.0%')).toHaveLength(2)
    expect(segments()).toEqual([])
  })
})

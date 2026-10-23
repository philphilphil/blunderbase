import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { formatElapsed } from '@/lib/analysis'
import { publishLiveSearch } from '@/lib/analysis/liveSearchBeacon'

import { LiveSearchReadout } from './LiveSearchReadout'

function draw() {
  render(
    <TooltipProvider>
      <LiveSearchReadout />
    </TooltipProvider>,
  )
}

afterEach(() => act(() => publishLiveSearch(null)))

describe('LiveSearchReadout', () => {
  it('stays out of the bar while nothing searches, and for a search only just started', () => {
    draw()
    expect(screen.queryByTestId('live-search-readout')).not.toBeInTheDocument()
    act(() => publishLiveSearch({ engine: 'Stockfish 17', depth: 18, nodes: 9_000_000, timeMs: 3_000 }))
    expect(screen.queryByTestId('live-search-readout')).not.toBeInTheDocument()
  })

  it('says how long and how far once a search has been left to run', () => {
    draw()
    act(() =>
      publishLiveSearch({ engine: 'Stockfish 17', depth: 41, nodes: 2_430_000_000, timeMs: 252_000 }),
    )
    const readout = screen.getByTestId('live-search-readout')
    expect(readout).toHaveTextContent('4:12')
    expect(readout).toHaveTextContent('2.4G nodes')
    expect(readout).toHaveAccessibleName('Stockfish 17 has searched this position for 4:12, to depth 41')

    act(() => publishLiveSearch(null))
    expect(screen.queryByTestId('live-search-readout')).not.toBeInTheDocument()
  })

  it('runs its clock on between the engine reports', () => {
    vi.useFakeTimers()
    try {
      draw()
      act(() => publishLiveSearch({ engine: 'Stockfish 17', depth: 38, nodes: 900_000_000, timeMs: 9_000 }))
      expect(screen.queryByTestId('live-search-readout')).not.toBeInTheDocument()

      // No new `info` line: the readout still comes in on time and keeps counting.
      act(() => vi.advanceTimersByTime(2_000))
      expect(screen.getByTestId('live-search-readout')).toHaveTextContent('0:11')
      // Nodes moving on the same engine time keep the stamp rather than restarting it.
      act(() => publishLiveSearch({ engine: 'Stockfish 17', depth: 38, nodes: 950_000_000, timeMs: 9_000 }))
      act(() => vi.advanceTimersByTime(30_000))
      expect(screen.getByTestId('live-search-readout')).toHaveTextContent('0:41')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('formatElapsed', () => {
  it('reads like a clock', () => {
    expect(formatElapsed(42_400)).toBe('0:42')
    expect(formatElapsed(252_000)).toBe('4:12')
    expect(formatElapsed(3_723_000)).toBe('1:02:03')
  })
})

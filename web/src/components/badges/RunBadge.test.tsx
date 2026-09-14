import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RunBadge } from './RunBadge'

/**
 * The chip used to name a kind of pass ("Quick", "Deep"). With one pass and a dialog that
 * chooses the limit, what ran is only described honestly by the limit itself, and these
 * pin the three ways a run can stop, the singular, and the two colours.
 */
describe('RunBadge', () => {
  it('prints a depth, a time and a node budget the way the dialog chose them', () => {
    const { rerender } = render(<RunBadge run={{ depth: 24, multipv: 2, requested: true }} />)
    expect(screen.getByText('d24 · 2 lines')).toBeInTheDocument()
    rerender(<RunBadge run={{ seconds: 10, multipv: 2, requested: true }} />)
    expect(screen.getByText('10s · 2 lines')).toBeInTheDocument()
    rerender(<RunBadge run={{ nodes: 500_000, multipv: 1 }} />)
    expect(screen.getByText('500k · 1 line')).toBeInTheDocument()
  })

  it('renders a legacy row from the nodes and lines it stored', () => {
    render(<RunBadge run={{ nodes: 2_000_000, depth: null, multipv: 4, requested: true }} />)
    expect(screen.getByText('2M · 4 lines')).toBeInTheDocument()
  })

  it('colours a requested run and leaves the import pass neutral', () => {
    const { rerender } = render(<RunBadge run={{ nodes: 500_000, multipv: 2, requested: true }} />)
    expect(screen.getByText(/500k/)).toHaveClass('text-deep')
    rerender(<RunBadge run={{ nodes: 500_000, multipv: 2, requested: false }} />)
    expect(screen.getByText(/500k/)).not.toHaveClass('text-deep')
  })

  it('says a Maia fill is one rather than printing the budget it was queued with', () => {
    render(<RunBadge run={{ nodes: 500_000, multipv: 1, maia_only: true }} />)
    expect(screen.getByText('Maia fill')).toBeInTheDocument()
  })

  it('says only "Analysed" for a game card, which carries no limits', () => {
    render(<RunBadge run={{ requested: false }} />)
    expect(screen.getByText('Analysed')).toBeInTheDocument()
  })
})

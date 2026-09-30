import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { PaneTab, PaneTabList } from './PaneTabList'

function Strip() {
  const [tab, setTab] = useState<'moves' | 'flagged' | 'book'>('moves')
  return (
    <PaneTabList label="Moves and flagged moments">
      <PaneTab selected={tab === 'moves'} onSelect={() => setTab('moves')}>
        Moves
      </PaneTab>
      <PaneTab selected={tab === 'flagged'} onSelect={() => setTab('flagged')} count={10}>
        Flagged
      </PaneTab>
      <PaneTab selected={tab === 'book'} onSelect={() => setTab('book')} disabled>
        Book
      </PaneTab>
    </PaneTabList>
  )
}

/** A pane's tabs are a real tablist: sibling tabs, one tab stop, arrows that choose. */
describe('PaneTabs', () => {
  it('draws the chosen tab as a folder tab, never a face or the blue fill', () => {
    render(<Strip />)
    expect(screen.getByRole('tablist', { name: 'Moves and flagged moments' })).toBeInTheDocument()
    const moves = screen.getByRole('tab', { name: 'Moves' })
    expect(moves).toHaveAttribute('aria-selected', 'true')
    expect(moves).toHaveClass('bg-surface', 'shadow-tab-on', 'font-medium')
    expect(moves).not.toHaveClass('bg-selected')
    expect(moves).not.toHaveClass('bg-control')
    expect(screen.getByRole('tab', { name: /Flagged/ })).toHaveAttribute('tabindex', '-1')
    expect(screen.getByText('10')).toBeInTheDocument()
  })

  it('moves and chooses with the arrows, skipping a disabled tab', async () => {
    const user = userEvent.setup()
    render(<Strip />)
    await user.tab()
    expect(screen.getByRole('tab', { name: 'Moves' })).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    const flagged = screen.getByRole('tab', { name: /Flagged/ })
    expect(flagged).toHaveFocus()
    expect(flagged).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Moves' })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{End}')
    expect(flagged).toHaveAttribute('aria-selected', 'true')
  })
})

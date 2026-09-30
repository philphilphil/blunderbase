import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ActionMenu } from './action-menu'

function items(onCsv = vi.fn(), onPgn = vi.fn()) {
  return [
    { label: 'Export CSV', onSelect: onCsv },
    { label: 'Export PDF', onSelect: vi.fn(), disabled: true },
    { label: 'Export PGN', onSelect: onPgn, hint: '⇧P' },
  ]
}

/** A list of commands behind one face: ⌄ when labelled, ⋯ when not, and a real menu. */
describe('ActionMenu', () => {
  it('opens a menu from a labelled face and focuses its first item', async () => {
    const user = userEvent.setup()
    render(<ActionMenu label="Export" items={items()} />)
    const trigger = screen.getByRole('button', { name: 'Export' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu', { name: 'Export' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Export CSV' })).toHaveFocus()
  })

  it('walks the items with the arrows, skipping a disabled one, and runs the chosen', async () => {
    const user = userEvent.setup()
    const onPgn = vi.fn()
    render(<ActionMenu label="Export" items={items(vi.fn(), onPgn)} />)
    await user.click(screen.getByRole('button', { name: 'Export' }))
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: /Export PGN/ })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Export CSV' })).toHaveFocus()
    await user.keyboard('{End}{Enter}')
    expect(onPgn).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on Escape, back on its trigger, and on a press elsewhere', async () => {
    const user = userEvent.setup()
    render(
      <>
        <ActionMenu label="More for this game" iconOnly items={items()} />
        <p>elsewhere</p>
      </>,
    )
    const trigger = screen.getByRole('button', { name: 'More for this game' })
    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    await user.click(screen.getByText('elsewhere'))
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Switch } from './switch'

/** A mode that persists is a switch: its own role, its label in its hit area. */
describe('Switch', () => {
  it('is a switch named by its visible label, and flips on a click on the words', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Switch checked={false} onCheckedChange={onCheckedChange} label="Hide engine" />)
    const control = screen.getByRole('switch', { name: 'Hide engine' })
    expect(control).toHaveAttribute('aria-checked', 'false')
    await user.click(screen.getByText('Hide engine'))
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('keeps a hidden label as the accessible name only', () => {
    render(<Switch checked onCheckedChange={() => {}} label="Enabled" hideLabel />)
    expect(screen.getByRole('switch', { name: 'Enabled' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByText('Enabled')).toBeNull()
  })

  it('toggles from the keyboard and does nothing while disabled', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    const { rerender } = render(
      <Switch checked onCheckedChange={onCheckedChange} label="Sync automatically" />,
    )
    await user.tab()
    await user.keyboard(' ')
    expect(onCheckedChange).toHaveBeenCalledWith(false)
    rerender(
      <Switch checked onCheckedChange={onCheckedChange} label="Sync automatically" disabled />,
    )
    await user.click(screen.getByRole('switch'))
    expect(onCheckedChange).toHaveBeenCalledTimes(1)
  })
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Segmented } from './segmented'

const OPTIONS = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: 'Year', disabled: true },
  { value: 'all', label: 'All time' },
] as const

type Window = (typeof OPTIONS)[number]['value']

function Harness() {
  const [value, setValue] = useState<Window>('30d')
  return <Segmented label="Window" value={value} onChange={setValue} options={OPTIONS} />
}

/**
 * One component for every one-of-N choice: a radiogroup with one tab stop and the arrows
 * choosing as they move, the chosen option as the raised neutral thumb (decision D2-A).
 */
describe('Segmented', () => {
  it('is a radiogroup whose chosen option is checked and the one tab stop', () => {
    render(<Harness />)
    const group = screen.getByRole('radiogroup', { name: 'Window' })
    expect(group).toHaveClass('bg-void')
    const chosen = screen.getByRole('radio', { name: '30 days' })
    expect(chosen).toHaveAttribute('aria-checked', 'true')
    expect(chosen).toHaveAttribute('tabindex', '0')
    expect(chosen).toHaveClass('bg-control', 'shadow-thumb', 'text-ink')
    expect(chosen).not.toHaveClass('bg-selected')
    expect(screen.getByRole('radio', { name: '90 days' })).toHaveAttribute('tabindex', '-1')
  })

  it('moves and chooses with the arrows, skipping a disabled option and wrapping', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.tab()
    expect(screen.getByRole('radio', { name: '30 days' })).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: '90 days' })).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'All time' })).toHaveFocus()
    expect(screen.getByRole('radio', { name: 'All time' })).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: '30 days' })).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{End}')
    expect(screen.getByRole('radio', { name: 'All time' })).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{Home}')
    expect(screen.getByRole('radio', { name: '30 days' })).toHaveAttribute('aria-checked', 'true')
  })

  it('does not report a click on the chosen option as a change', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Segmented label="Window" value="30d" onChange={onChange} options={OPTIONS} />)
    await user.click(screen.getByRole('radio', { name: '30 days' }))
    expect(onChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('radio', { name: '90 days' }))
    expect(onChange).toHaveBeenCalledWith('90d')
  })

  it('dims the whole control when disabled', () => {
    render(
      <Segmented label="Window" value="30d" onChange={() => {}} options={OPTIONS} disabled />,
    )
    expect(screen.getByRole('radiogroup')).toHaveClass('opacity-50')
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
  })
})

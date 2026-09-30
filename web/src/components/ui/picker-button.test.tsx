import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { PickerButton } from './picker-button'

/** A value from a list: a face that names what it sets, its value, and a ⇅ inside it. */
describe('PickerButton', () => {
  it('reads "Label" when unset, as a face with the chevron inside the button', () => {
    render(<PickerButton label="Source" />)
    const button = screen.getByRole('button', { name: 'Source' })
    expect(button).toHaveClass('bg-control', 'shadow-face')
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button).not.toHaveAttribute('data-set')
  })

  it('reads "Label: value" and lights while set, the value never in accent or mono', () => {
    render(<PickerButton label="Date" value="Last 30 days" set />)
    const button = screen.getByRole('button', { name: /Date:\s*Last 30 days/ })
    expect(button).toHaveClass('bg-selected', 'border-accent-teal/45')
    const value = screen.getByText('Last 30 days')
    expect(value).toHaveClass('font-medium', 'text-ink')
    expect(value).not.toHaveClass('text-accent-teal')
    expect(value).not.toHaveClass('font-mono')
  })

  it('shows a default value without lighting ("Speed: All")', () => {
    render(<PickerButton label="Speed" value="All" />)
    expect(screen.getByRole('button', { name: /Speed:\s*All/ })).not.toHaveClass('bg-selected')
  })

  it('spaces "Label: value" with a word space, not the flex gap', () => {
    render(<PickerButton label="Speed" value="All" />)
    // One run of text: the gap spaced two siblings a few pixels wider than a space.
    expect(screen.getByRole('button')).toHaveTextContent(/^Speed: All$/)
    expect(screen.getByText('All').parentElement).toHaveTextContent(/^Speed: All$/)
  })

  it('adds a clear segment inside the outline only while set', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    const { rerender } = render(<PickerButton label="Source" onClear={onClear} />)
    expect(screen.queryByRole('button', { name: 'Clear Source filter' })).toBeNull()
    rerender(<PickerButton label="Source" value="Lichess" set onClear={onClear} />)
    await user.click(screen.getByRole('button', { name: 'Clear Source filter' }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('passes aria-expanded through and takes the one disabled look', () => {
    const { rerender } = render(<PickerButton label="Rows" aria-expanded />)
    expect(screen.getByRole('button', { name: 'Rows' })).toHaveAttribute('aria-expanded', 'true')
    rerender(<PickerButton label="Rows" disabled title="Nothing to page" />)
    const button = screen.getByRole('button', { name: 'Rows' })
    expect(button).toBeDisabled()
    expect(button).toHaveClass('bg-transparent', 'text-faint-2', 'cursor-not-allowed')
  })

  it('is quiet in a pane strip until it is pointed at', () => {
    render(<PickerButton label="Level" value="1500" size="strip" hideLabel />)
    const button = screen.getByRole('button', { name: 'Level' })
    expect(button).toHaveClass('h-6', 'bg-transparent', 'border-transparent', 'hover:shadow-face')
  })
})

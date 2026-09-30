import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Pager } from './pager'

/** Faced arrows around a flat position; an end is disabled and says why. */
describe('Pager', () => {
  it('shows where you are between two faced arrows', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<Pager page={2} pages={231} onPrev={() => {}} onNext={onNext} label="Pages" />)
    expect(screen.getByText('2 / 231')).toHaveClass('font-mono')
    const next = screen.getByRole('button', { name: 'Next page' })
    expect(next).toHaveClass('border-control-edge-strong', 'bg-control')
    await user.click(next)
    expect(onNext).toHaveBeenCalledOnce()
  })

  it('disables the first page’s back arrow with a reason', () => {
    render(<Pager page={1} pages={3} onPrev={() => {}} onNext={() => {}} label="Pages" />)
    const previous = screen.getByRole('button', { name: 'Previous page' })
    expect(previous).toBeDisabled()
    expect(previous).toHaveAttribute('title', 'Already on the first page')
  })
})

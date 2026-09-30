import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ButtonGroup, ButtonGroupItem } from './button-group'

/** "Do one of these": attached faces, never the segmented control's sunken track. */
describe('ButtonGroup', () => {
  it('is a named group of faced cells with no track of its own', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(
      <ButtonGroup label="Move navigation">
        <ButtonGroupItem aria-label="Previous move" title="Previous move (←)" disabled>
          ‹
        </ButtonGroupItem>
        <ButtonGroupItem aria-label="Next move" title="Next move (→)" onClick={onNext}>
          ›
        </ButtonGroupItem>
      </ButtonGroup>,
    )
    const group = screen.getByRole('group', { name: 'Move navigation' })
    expect(group).toHaveClass('border-control-edge', 'shadow-face')
    expect(group).not.toHaveClass('bg-void')
    const next = screen.getByRole('button', { name: 'Next move' })
    expect(next).toHaveClass('bg-control')
    await user.click(next)
    expect(onNext).toHaveBeenCalledOnce()
    const previous = screen.getByRole('button', { name: 'Previous move' })
    expect(previous).toBeDisabled()
    expect(previous).toHaveClass('disabled:bg-transparent')
  })
})

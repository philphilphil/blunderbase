import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Checkbox } from './checkbox'

describe('Checkbox', () => {
  it('is a checkbox named by its label, which is part of its hit area', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Checkbox checked={false} onCheckedChange={onCheckedChange} label="Blitz" />)
    const box = screen.getByRole('checkbox', { name: 'Blitz' })
    expect(box).toHaveAttribute('aria-checked', 'false')
    await user.click(screen.getByText('Blitz'))
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything())
  })

  it('draws off as an outlined field and on with a glyph, never a bare square', () => {
    const { rerender, container } = render(
      <Checkbox checked={false} onCheckedChange={() => {}} aria-label="Select" />,
    )
    const box = () => container.querySelector('button > span')!
    expect(box()).toHaveClass('bg-field', 'border-control-edge-strong')
    expect(box().querySelector('svg')).toBeNull()
    rerender(<Checkbox checked onCheckedChange={() => {}} aria-label="Select" />)
    expect(box()).toHaveClass('bg-accent-teal')
    expect(box().querySelector('svg')).not.toBeNull()
  })

  it('reports mixed and turns it on when pressed', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Checkbox checked="mixed" onCheckedChange={onCheckedChange} aria-label="All rows" />)
    const box = screen.getByRole('checkbox', { name: 'All rows' })
    expect(box).toHaveAttribute('aria-checked', 'mixed')
    await user.click(box)
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything())
  })

  it('does nothing while disabled', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Checkbox checked onCheckedChange={onCheckedChange} aria-label="x" disabled />)
    await user.click(screen.getByRole('checkbox'))
    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})

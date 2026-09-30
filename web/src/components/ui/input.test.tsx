import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Input, SearchInput } from './input'
import { Textarea } from './textarea'

/** A field is sunk where a button is raised, and focus shows both its border and the ring. */
describe('fields', () => {
  it('draws an input as a sunk field that keeps the focus ring', () => {
    render(<Input aria-label="Name" />)
    const input = screen.getByRole('textbox', { name: 'Name' })
    expect(input).toHaveClass('bg-field', 'shadow-field', 'border-edge-input', 'h-8')
    expect(input.className).not.toContain('outline-none')
    expect(input).toHaveClass('focus-visible:border-accent-teal')
  })

  it('has a toolbar size', () => {
    render(<Input aria-label="Name" inputSize="sm" />)
    expect(screen.getByRole('textbox')).toHaveClass('h-7')
  })

  it('leads a page search field with a magnifier', () => {
    const { container } = render(<SearchInput aria-label="Filter notes" placeholder="Filter notes…" />)
    expect(screen.getByRole('textbox', { name: 'Filter notes' })).toHaveClass('pl-7')
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('draws a textarea as the same field', () => {
    render(<Textarea aria-label="Note" />)
    const area = screen.getByRole('textbox', { name: 'Note' })
    expect(area).toHaveAttribute('data-slot', 'textarea')
    expect(area).toHaveClass('bg-field', 'shadow-field')
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ChipRow, FilterChip } from './chip'

/** A chip is a border with no face; on carries a ✓, and blue only while the set narrows. */
describe('FilterChip', () => {
  it('draws off as a bare border with no check', () => {
    render(<FilterChip label="2000+" on={false} onClick={() => {}} />)
    const chip = screen.getByRole('button', { name: '2000+' })
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    expect(chip).toHaveClass('border-edge', 'text-soft')
    expect(chip).not.toHaveClass('bg-control')
    expect(chip.querySelector('svg')).toBeNull()
  })

  it('lights an on chip blue with a check while its set is narrowed', () => {
    render(<FilterChip label="2000+" on onClick={() => {}} />)
    const chip = screen.getByRole('button', { name: '2000+' })
    expect(chip).toHaveClass('bg-selected')
    expect(chip.querySelector('svg')).not.toBeNull()
  })

  it('keeps an on chip neutral with its check while every member is on', () => {
    render(<FilterChip label="2000+" on narrowed={false} onClick={() => {}} />)
    const chip = screen.getByRole('button', { name: '2000+' })
    expect(chip).not.toHaveClass('bg-selected')
    expect(chip).toHaveClass('text-body')
    expect(chip.querySelector('svg')).not.toBeNull()
  })
})

describe('ChipRow', () => {
  it('names its group in sentence-case label text, not column caps', () => {
    render(
      <ChipRow label="Rating">
        <FilterChip label="2000+" on onClick={() => {}} />
      </ChipRow>,
    )
    expect(screen.getByRole('group', { name: 'Rating' })).toBeInTheDocument()
    expect(screen.getByText('Rating')).not.toHaveClass('uppercase')
  })
})

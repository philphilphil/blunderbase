import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Badge, badgeVariants, Readout } from './badge'

/** A readout is a fact: no border in any variant, not focusable. */
describe('Badge', () => {
  it('carries no border in any variant', () => {
    for (const variant of [
      'default',
      'outline',
      'dashed',
      'accent',
      'deep',
      'danger',
      'warn',
      'good',
    ] as const) {
      const classes = badgeVariants({ variant }).split(' ')
      expect(classes.filter((name) => /(^|:)border(-|$)/.test(name)), variant).toEqual([])
    }
  })

  it('is a tint, not a control', () => {
    render(<Badge>MPV 2</Badge>)
    const badge = screen.getByText('MPV 2')
    expect(badge).toHaveClass('bg-chip-neutral', 'text-dim')
    expect(badge).not.toHaveAttribute('tabindex')
  })
})

describe('Readout', () => {
  it('sets a figure in mono meta and words in sans label, both dim', () => {
    const { rerender } = render(<Readout num>40 plies</Readout>)
    expect(screen.getByText('40 plies')).toHaveClass('font-mono', 'text-meta', 'text-dim')
    rerender(<Readout>played</Readout>)
    expect(screen.getByText('played')).toHaveClass('text-label', 'text-dim')
    expect(screen.getByText('played')).not.toHaveClass('font-mono')
  })
})

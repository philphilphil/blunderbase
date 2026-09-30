import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Button, buttonVariants } from './button'

/**
 * A face means "press me" and a disabled button loses it: these pin the grammar's classes
 * so a later edit cannot quietly put the old flat tool button or the faded disabled back.
 */
describe('Button', () => {
  it('draws the tool button as a raised face', () => {
    render(<Button variant="secondary">Export</Button>)
    expect(screen.getByRole('button')).toHaveClass(
      'bg-control',
      'border-control-edge',
      'shadow-face',
      'text-body',
    )
  })

  it('keeps pointer events on a disabled button, so its title can say why', () => {
    render(
      <Button variant="default" disabled title="Choose a file first">
        Import
      </Button>,
    )
    const button = screen.getByRole('button')
    expect(button.className).not.toContain('disabled:pointer-events-none')
    expect(button).toHaveClass('disabled:cursor-not-allowed')
    expect(button.className).not.toContain('disabled:opacity-50')
    expect(button).toHaveClass('disabled:bg-transparent', 'disabled:text-faint-2')
  })

  it('gives an icon-only face the strong edge instead of the labelled one', () => {
    const classes = buttonVariants({ variant: 'secondary', size: 'icon-sm' }).split(' ')
    expect(classes).toContain('border-control-edge-strong')
    expect(classes).not.toContain('border-control-edge')
  })

  it('draws the retired outline exactly as the tool button', () => {
    expect(buttonVariants({ variant: 'outline', size: 'sm' })).toBe(
      buttonVariants({ variant: 'secondary', size: 'sm' }),
    )
  })

  it('has a red command for toolbars that is a face, not the filled confirm', () => {
    const classes = buttonVariants({ variant: 'destructive-outline' }).split(' ')
    expect(classes).toEqual(expect.arrayContaining(['bg-control', 'text-blunder', 'shadow-face']))
    expect(classes).not.toContain('bg-blunder')
  })
})

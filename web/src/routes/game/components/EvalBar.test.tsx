import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EvalBar } from './EvalBar'

/** The three absolutely-positioned fills, in the order the component writes them. */
function fills(): HTMLElement[] {
  return [...screen.getByRole('img').children] as HTMLElement[]
}

const black = () => fills()[0]
const white = () => fills()[1]
const hairline = () => fills()[2]

describe('EvalBar', () => {
  // The suite runs with `css: false`, so a Tailwind class has no computed style — the
  // anchors are asserted as the classes they are, and the inline heights as styles.
  it('fills White from the bottom on a board White is sitting at', () => {
    render(<EvalBar win={80} score={{ cp: 300, mate: null }} />)
    expect(white()).toHaveStyle({ height: '80%' })
    expect(white()).toHaveClass('bottom-0')
    expect(black()).toHaveStyle({ height: '20%' })
    expect(black()).toHaveClass('top-0')
    expect(hairline()).toHaveStyle({ top: '20%' })
  })

  it('mirrors the fills on a board Black is sitting at', () => {
    // Same 80 % for White — the number never flips, only where it is drawn from. White's
    // fill now comes down from the top and the hairline is measured from the other end.
    render(<EvalBar win={80} score={{ cp: 300, mate: null }} orientation="black" />)
    expect(white()).toHaveStyle({ height: '80%' })
    expect(white()).toHaveClass('top-0')
    expect(black()).toHaveStyle({ height: '20%' })
    expect(black()).toHaveClass('bottom-0')
    expect(hairline()).toHaveStyle({ top: '80%' })
  })

  it('names White’s percentage either way up', () => {
    const label = 'Evaluation: +3.00 · White 80%'
    const { rerender } = render(<EvalBar win={80} score={{ cp: 300, mate: null }} />)
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', label)
    expect(screen.getByRole('img')).toHaveAttribute('title', '+3.00 · White 80%')
    rerender(<EvalBar win={80} score={{ cp: 300, mate: null }} orientation="black" />)
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', label)
  })

  it('is a dimmed 50/50 with nothing to say, whichever way up', () => {
    const { rerender } = render(<EvalBar win={null} score={null} />)
    expect(white()).toHaveStyle({ height: '50%', opacity: '0.25' })
    expect(black()).toHaveStyle({ height: '50%' })
    // No hairline: there is no balance to mark.
    expect(fills()).toHaveLength(2)
    expect(screen.getByRole('img')).toHaveAttribute('title', 'not analysed')

    rerender(<EvalBar win={null} score={null} orientation="black" />)
    expect(white()).toHaveStyle({ height: '50%', opacity: '0.25' })
    expect(black()).toHaveStyle({ height: '50%' })
    expect(fills()).toHaveLength(2)
  })

  it('keeps the height transitions that animate the bar', () => {
    render(<EvalBar win={40} score={{ cp: 0, mate: null }} orientation="black" />)
    expect(white()).toHaveClass('transition-[height]')
    expect(black()).toHaveClass('transition-[height]')
    expect(hairline()).toHaveClass('transition-[top]')
  })
})

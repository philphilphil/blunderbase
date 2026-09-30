import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Button } from './button'
import { Tooltip, TooltipProvider, TooltipTrigger } from './tooltip'

function Harness({ disabled }: { disabled: boolean }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild wrapDisabled>
          <Button disabled={disabled}>Import</Button>
        </TooltipTrigger>
      </Tooltip>
    </TooltipProvider>
  )
}

/** A disabled button keeps a readable reason, without being remounted when it turns off. */
describe('TooltipTrigger wrapDisabled', () => {
  it('gives the wrapper the tab stop only while the button is disabled, keeping the node', () => {
    const { rerender } = render(<Harness disabled={false} />)
    const button = screen.getByRole('button', { name: 'Import' })
    expect(button.parentElement).not.toHaveAttribute('tabindex')
    rerender(<Harness disabled />)
    expect(screen.getByRole('button', { name: 'Import' })).toBe(button)
    expect(button).toBeDisabled()
    expect(button.parentElement).toHaveAttribute('tabindex', '0')
  })
})

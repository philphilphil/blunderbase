/**
 * The move path shared by the explorer and the repertoire: every step walks the line back
 * to itself, and the step the board stands on is the current one.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { buildLine } from '../line'
import { LineBreadcrumb } from './LineBreadcrumb'

describe('LineBreadcrumb', () => {
  it('marks the start as current before any move is played', () => {
    render(<LineBreadcrumb steps={[]} onTruncate={vi.fn()} />)
    expect(screen.getByRole('group', { name: 'Move path' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'start' })).toHaveAttribute('aria-current', 'step')
  })

  it('numbers White’s moves, marks the last step current, and walks back to any step', async () => {
    const onTruncate = vi.fn()
    const { steps } = buildLine(['e2e4', 'e7e5', 'g1f3'])
    render(<LineBreadcrumb steps={steps} onTruncate={onTruncate} />)

    expect(screen.getByRole('button', { name: '2.Nf3' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: 'e5' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: 'start' })).not.toHaveAttribute('aria-current')

    // `e5` is the second ply, so walking back to it keeps two moves.
    await userEvent.click(screen.getByRole('button', { name: 'e5' }))
    expect(onTruncate).toHaveBeenCalledWith(2)
    await userEvent.click(screen.getByRole('button', { name: 'start' }))
    expect(onTruncate).toHaveBeenLastCalledWith(0)
  })
})

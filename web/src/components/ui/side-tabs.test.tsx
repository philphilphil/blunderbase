import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { SideTab, SideTabList } from './side-tabs'

function Pages({ disabledLast = false }: { disabledLast?: boolean }) {
  const [page, setPage] = useState('a')
  return (
    <SideTabList label="Pages">
      <SideTab selected={page === 'a'} onSelect={() => setPage('a')}>A</SideTab>
      <SideTab selected={page === 'b'} onSelect={() => setPage('b')}>B</SideTab>
      {disabledLast ? null : (
        <SideTab selected={page === 'c'} onSelect={() => setPage('c')}>C</SideTab>
      )}
    </SideTabList>
  )
}

describe('SideTabList', () => {
  it('is a vertical tablist with one tab stop, on the chosen tab', () => {
    render(<Pages />)
    expect(screen.getByRole('tablist', { name: 'Pages' })).toHaveAttribute(
      'aria-orientation',
      'vertical',
    )
    const [a, b, c] = screen.getAllByRole('tab')
    expect(a).toHaveAttribute('aria-selected', 'true')
    expect(a).toHaveAttribute('tabindex', '0')
    expect(b).toHaveAttribute('tabindex', '-1')
    expect(c).toHaveAttribute('tabindex', '-1')
  })

  it('moves and chooses at once with Up, Down, Home and End, wrapping at the ends', async () => {
    render(<Pages />)
    screen.getByRole('tab', { name: 'A' }).focus()

    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('tab', { name: 'B' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'B' })).toHaveFocus()

    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'C' })).toHaveAttribute('aria-selected', 'true')

    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('tab', { name: 'A' })).toHaveAttribute('aria-selected', 'true')

    await userEvent.keyboard('{ArrowUp}')
    expect(screen.getByRole('tab', { name: 'C' })).toHaveAttribute('aria-selected', 'true')

    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'A' })).toHaveAttribute('aria-selected', 'true')
  })

  // Below `sm` the list lies across the top of the dialog, so Left and Right walk it too.
  it('answers Left and Right as well', async () => {
    render(<Pages />)
    screen.getByRole('tab', { name: 'A' }).focus()

    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'B' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'A' })).toHaveAttribute('aria-selected', 'true')
  })
})

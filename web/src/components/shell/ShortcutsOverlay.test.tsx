import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ShortcutsButton, ShortcutsOverlayProvider } from './ShortcutsOverlay'

function mount(at = '/stats') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <ShortcutsOverlayProvider>
        <ShortcutsButton />
        <input aria-label="Somewhere to type" />
      </ShortcutsOverlayProvider>
    </MemoryRouter>,
  )
}

describe('the shortcuts overlay', () => {
  it('comes up on ? and goes away on escape', async () => {
    const user = userEvent.setup()
    mount()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.keyboard('?')
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('comes up on the titlebar button', async () => {
    const user = userEvent.setup()
    mount()

    await user.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }))
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
  })

  it('leaves the question mark to a field being typed in', async () => {
    const user = userEvent.setup()
    mount()

    const box = screen.getByLabelText('Somewhere to type')
    await user.click(box)
    await user.keyboard('?')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(box).toHaveValue('?')
  })

  it('prints the board keys on a game and not on another screen', async () => {
    const user = userEvent.setup()
    const { unmount } = mount('/games/7')
    await user.keyboard('?')
    expect(screen.getByText('Moving about the game')).toBeInTheDocument()
    expect(screen.getByText('The next flagged move')).toBeInTheDocument()
    // The global half is true here too, so it stays.
    expect(screen.getByText('Anywhere')).toBeInTheDocument()
    unmount()

    mount('/stats')
    await user.keyboard('?')
    expect(screen.queryByText('Moving about the game')).not.toBeInTheDocument()
  })
})

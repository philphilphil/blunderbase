import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetEngineHidden, setEngineHidden, useEngineHidden } from '@/lib/ui/engineVisibility'

import { EngineToggle } from './EngineToggle'

/** jsdom in this setup exposes no `localStorage`, so the test brings its own. */
function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, String(value)),
  }
}

const toasts: string[] = []
vi.mock('@/lib/toast', () => ({
  toast: {
    info: (message: string) => toasts.push(message),
    error: (message: string) => toasts.push(message),
    success: (message: string) => toasts.push(message),
  },
}))

/** A second reader of the mode, so the test can see what the rest of the app would. */
function Readout() {
  return <span data-testid="mode">{useEngineHidden() ? 'hidden' : 'shown'}</span>
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  resetEngineHidden()
  toasts.length = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetEngineHidden()
})

function draw() {
  render(
    <>
      <EngineToggle />
      <Readout />
      <input aria-label="a field" />
    </>,
  )
}

describe('EngineToggle', () => {
  it('is a Hide engine switch, off by default, with its key in the title', () => {
    draw()
    const toggle = screen.getByRole('switch', { name: 'Hide engine' })
    // Off is the engine speaking, which is where a reader starts: the unusual mode lights.
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(toggle).toHaveTextContent('Hide engine')
    expect(toggle).toHaveAttribute('title', 'Hide engine evaluations, lines and flags (⇧E)')
    // No glyph of a computer, which read as the theme's monitor.
    expect(toggle.querySelector('.lucide-computer')).toBeNull()
  })

  it('hides the engine and brings it back', async () => {
    const user = userEvent.setup()
    draw()
    const toggle = screen.getByRole('switch', { name: 'Hide engine' })

    await user.click(toggle)
    expect(screen.getByTestId('mode')).toHaveTextContent('hidden')
    // Checked means hidden.
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    // The switch is its own answer; a toast for it would read its label back.
    expect(toasts).toEqual([])

    await user.click(toggle)
    expect(screen.getByTestId('mode')).toHaveTextContent('shown')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('drops its word on a phone but keeps it as the name', () => {
    render(<EngineToggle compact />)
    const toggle = screen.getByRole('switch', { name: 'Hide engine' })
    expect(toggle).not.toHaveTextContent('Hide engine')
  })

  it('answers ⇧E from anywhere, and says which way it went', async () => {
    const user = userEvent.setup()
    draw()
    await user.keyboard('{Shift>}E{/Shift}')
    expect(screen.getByTestId('mode')).toHaveTextContent('hidden')
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatch(/hidden/i)

    await user.keyboard('{Shift>}E{/Shift}')
    expect(screen.getByTestId('mode')).toHaveTextContent('shown')
    expect(toasts).toHaveLength(2)
  })

  it('leaves a capital E to whoever is typing one', async () => {
    const user = userEvent.setup()
    draw()
    await user.click(screen.getByLabelText('a field'))
    await user.keyboard('{Shift>}E{/Shift}')
    expect(screen.getByTestId('mode')).toHaveTextContent('shown')
    expect(screen.getByLabelText('a field')).toHaveValue('E')
  })

  it('starts on where the mode was already on', () => {
    setEngineHidden(true)
    draw()
    expect(screen.getByRole('switch', { name: 'Hide engine' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })
})

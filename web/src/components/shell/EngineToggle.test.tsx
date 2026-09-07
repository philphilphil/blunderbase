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
  it('hides the engine and brings it back', async () => {
    const user = userEvent.setup()
    draw()
    // Pressed is the engine speaking, which is where a reader starts.
    const button = screen.getByRole('button', { name: /hide the engine/i })
    expect(button).toHaveAttribute('aria-pressed', 'true')

    await user.click(button)
    expect(screen.getByTestId('mode')).toHaveTextContent('hidden')
    expect(screen.getByRole('button', { name: /show the engine/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    // The button is its own answer; a toast for it would read its label back.
    expect(toasts).toEqual([])

    await user.click(screen.getByRole('button', { name: /show the engine/i }))
    expect(screen.getByTestId('mode')).toHaveTextContent('shown')
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

  it('starts dark where the mode was already on', () => {
    setEngineHidden(true)
    draw()
    expect(screen.getByRole('button', { name: /show the engine/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LINE_PREVIEW_KEY, resetLinePreviewPrefs } from '@/lib/board/linePreviewPrefs'

import { BoardPreviewCard } from './BoardPreviewCard'

/** jsdom in this setup exposes no `localStorage`, so the tests bring their own. */
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

/** What is under the `blunderbase.linePreview` key, as `setLinePreviewPrefs` wrote it. */
function stored(): Record<string, unknown> {
  const raw = window.localStorage.getItem(LINE_PREVIEW_KEY)
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  resetLinePreviewPrefs()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetLinePreviewPrefs()
})

describe('BoardPreviewCard', () => {
  it('round-trips the row-hover mode to localStorage', async () => {
    render(<BoardPreviewCard />)

    await userEvent.selectOptions(screen.getByLabelText('Row hover'), 'overlay')

    expect(stored().row).toBe('overlay')
    expect(screen.getByLabelText('Row hover')).toHaveValue('overlay')
  })

  it('shows the playthrough controls only in play mode', async () => {
    render(<BoardPreviewCard />)

    expect(screen.queryByLabelText('Tempo')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Start delay')).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Row hover'), 'play')

    expect(screen.getByLabelText('Tempo')).toBeInTheDocument()
    expect(screen.getByLabelText('Start delay')).toBeInTheDocument()
    expect(screen.getByText('Loop when it reaches the end')).toBeInTheDocument()
    expect(screen.getByText('Arrow one move ahead')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Row hover'), 'arrows')
    expect(screen.queryByLabelText('Tempo')).not.toBeInTheDocument()
  })

  it('shows the dim-pieces control only in overlay mode', async () => {
    render(<BoardPreviewCard />)

    expect(screen.queryByText('Dim the current pieces')).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Row hover'), 'overlay')

    expect(screen.getByText('Dim the current pieces')).toBeInTheDocument()
  })

  it('shows the look-ahead control only when scrub is on', async () => {
    render(<BoardPreviewCard />)

    // Scrub defaults on, so look-ahead starts visible.
    expect(screen.getByLabelText('Look-ahead')).toBeInTheDocument()

    await userEvent.click(
      screen.getByLabelText('Hovering a move in the line shows the position after it'),
    )

    expect(screen.queryByLabelText('Look-ahead')).not.toBeInTheDocument()
    expect(stored().scrub).toBe(false)

    await userEvent.click(
      screen.getByLabelText('Hovering a move in the line shows the position after it'),
    )
    expect(screen.getByLabelText('Look-ahead')).toBeInTheDocument()
  })
})

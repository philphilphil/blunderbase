import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LINE_PREVIEW_KEY, resetLinePreviewPrefs } from '@/lib/board/linePreviewPrefs'

import { LinePreviewFields, LinePreviewRowChip } from './LinePreviewSettings'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  resetLinePreviewPrefs()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetLinePreviewPrefs()
})

describe('LinePreviewFields', () => {
  it('stores preview behaviour in this browser and reveals the mode’s own controls', async () => {
    render(<LinePreviewFields />)

    expect(screen.queryByLabelText('Tempo')).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Row hover'), 'play')

    expect(screen.getByLabelText('Tempo')).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(LINE_PREVIEW_KEY) ?? '{}')).toMatchObject({ row: 'play' })
  })

  // A control that depends on another stays where it is, disabled, rather than vanishing.
  it('disables the look-ahead and the badge label while what they depend on is off', async () => {
    render(<LinePreviewFields />)

    expect(screen.getByRole('slider', { name: 'Look-ahead' })).toBeEnabled()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Hover a move to show its position' }))
    expect(screen.getByRole('slider', { name: 'Look-ahead' })).toBeDisabled()

    expect(screen.getByLabelText('Badge label')).toBeEnabled()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Move badges' }))
    expect(screen.getByLabelText('Badge label')).toBeDisabled()
  })
})

describe('LinePreviewRowChip', () => {
  it('picks what hovering a line does from a list, and remembers it', async () => {
    render(<LinePreviewRowChip />)

    // A picker over the native select: the value is shown, the list is the select's.
    const picker = screen.getByRole('combobox', { name: 'Line preview' })
    expect(picker).toHaveValue('arrows')
    expect(screen.getByText('Arrows', { selector: 'span' })).toBeInTheDocument()
    await userEvent.selectOptions(picker, 'overlay')
    expect(screen.getByText('Overlay', { selector: 'span' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(LINE_PREVIEW_KEY) ?? '{}')).toMatchObject({
      row: 'overlay',
    })
  })
})

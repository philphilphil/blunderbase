import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LINE_PREVIEW_KEY, resetLinePreviewPrefs } from '@/lib/board/linePreviewPrefs'

import { LinePreviewRowChip, LinePreviewSettingsButton } from './LinePreviewSettings'

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

describe('LinePreviewSettingsButton', () => {
  it('opens contextually and stores preview behavior in this browser', async () => {
    render(<LinePreviewSettingsButton />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Line preview settings' }))
    await userEvent.selectOptions(screen.getByLabelText('Row hover'), 'play')

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Tempo')).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(LINE_PREVIEW_KEY) ?? '{}')).toMatchObject({ row: 'play' })
  })
})

describe('LinePreviewRowChip', () => {
  it('cycles what hovering a line does, and remembers it', async () => {
    render(<LinePreviewRowChip />)

    await userEvent.click(screen.getByRole('button', { name: 'arrows' }))
    expect(screen.getByRole('button', { name: 'overlay' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(LINE_PREVIEW_KEY) ?? '{}')).toMatchObject({
      row: 'overlay',
    })
  })
})

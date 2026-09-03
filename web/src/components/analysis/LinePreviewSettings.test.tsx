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
})

describe('LinePreviewRowChip', () => {
  it('cycles what hovering a line does, and remembers it', async () => {
    render(<LinePreviewRowChip />)

    await userEvent.click(screen.getByRole('button', { name: 'Line preview: arrows' }))
    expect(screen.getByRole('button', { name: 'Line preview: overlay' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(LINE_PREVIEW_KEY) ?? '{}')).toMatchObject({
      row: 'overlay',
    })
  })
})

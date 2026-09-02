import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BOARD_ARROW_KEY, resetBoardArrowPrefs } from '@/lib/board/arrowPrefs'
import { LINE_PREVIEW_KEY, resetLinePreviewPrefs } from '@/lib/board/linePreviewPrefs'

import { BoardSettingsButton } from './BoardSettings'

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
  resetBoardArrowPrefs()
  resetLinePreviewPrefs()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetBoardArrowPrefs()
  resetLinePreviewPrefs()
})

describe('BoardSettingsButton', () => {
  it('opens from the board’s own toolbar and switches one arrow off', async () => {
    render(<BoardSettingsButton />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Board settings' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Maia move'))

    expect(JSON.parse(window.localStorage.getItem(BOARD_ARROW_KEY) ?? '{}')).toMatchObject({
      engine: true,
      maia: false,
      played: true,
    })
  })

  // The whole reason this dialog exists: the line-preview settings used to be behind a gear
  // in a panel header nobody opened, and they are now a section of the board's own dialog.
  it('carries the line-preview settings in the same dialog', async () => {
    render(<BoardSettingsButton />)
    await userEvent.click(screen.getByRole('button', { name: 'Board settings' }))
    await userEvent.selectOptions(screen.getByLabelText('Row hover'), 'peek')

    expect(JSON.parse(window.localStorage.getItem(LINE_PREVIEW_KEY) ?? '{}')).toMatchObject({
      row: 'peek',
    })
  })
})

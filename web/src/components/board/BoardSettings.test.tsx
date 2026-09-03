import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BOARD_ARROW_KEY, resetBoardArrowPrefs } from '@/lib/board/arrowPrefs'
import { LINE_PREVIEW_KEY, resetLinePreviewPrefs } from '@/lib/board/linePreviewPrefs'
import { EVAL_GRAPH_KEY, resetEvalGraphPrefs } from '@/lib/ui/evalGraphPrefs'

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
  resetEvalGraphPrefs()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetBoardArrowPrefs()
  resetLinePreviewPrefs()
  resetEvalGraphPrefs()
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

  // Bars are what an unconfigured browser draws; the curve is here for whoever prefers the
  // shape of the game to the direction of each move, and nothing is stored until they say so.
  it('offers the eval graph’s two shapes, bars first', async () => {
    render(<BoardSettingsButton />)
    await userEvent.click(screen.getByRole('button', { name: 'Board settings' }))

    const shape = screen.getByLabelText('Shape')
    expect(shape).toHaveValue('bars')
    expect(window.localStorage.getItem(EVAL_GRAPH_KEY)).toBeNull()

    await userEvent.selectOptions(shape, 'area')
    expect(JSON.parse(window.localStorage.getItem(EVAL_GRAPH_KEY) ?? '{}')).toMatchObject({
      style: 'area',
    })
  })

  // The glyphs are the loud mark, so all three are offered rather than one switch: the tab,
  // the quiet disc, or a plot with nothing on it.
  it('turns the graph’s marks down to discs', async () => {
    render(<BoardSettingsButton />)
    await userEvent.click(screen.getByRole('button', { name: 'Board settings' }))

    const marks = screen.getByLabelText('Marks')
    expect(marks).toHaveValue('glyphs')

    await userEvent.selectOptions(marks, 'dots')
    expect(JSON.parse(window.localStorage.getItem(EVAL_GRAPH_KEY) ?? '{}')).toMatchObject({
      marks: 'dots',
    })
  })
})

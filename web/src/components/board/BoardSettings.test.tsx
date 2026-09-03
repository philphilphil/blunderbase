import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BOARD_ARROW_KEY, resetBoardArrowPrefs } from '@/lib/board/arrowPrefs'
import { LINE_PREVIEW_KEY, resetLinePreviewPrefs } from '@/lib/board/linePreviewPrefs'
import { MOVE_SOUND_KEY, resetMoveSoundPrefs } from '@/lib/board/moveSoundPrefs'
import { EVAL_GRAPH_KEY, resetEvalGraphPrefs } from '@/lib/ui/evalGraphPrefs'

import { playMoveSound } from '@/lib/board/moveSound'

import { BoardSettingsButton } from './BoardSettings'

// The click itself needs a Web Audio context jsdom does not have. What is worth asserting
// here is not the sound but *that the dialog asks for one*, and at which level.
vi.mock('@/lib/board/moveSound', () => ({ playMoveSound: vi.fn() }))

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
  vi.mocked(playMoveSound).mockClear()
  resetBoardArrowPrefs()
  resetLinePreviewPrefs()
  resetMoveSoundPrefs()
  resetEvalGraphPrefs()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  resetBoardArrowPrefs()
  resetLinePreviewPrefs()
  resetMoveSoundPrefs()
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

  // The sound is on out of the box, so the checkbox's job is turning it off, and the level
  // slider goes with it — disabled rather than removed, so it is still where it was.
  it('turns the move sound off and takes the level slider with it', async () => {
    render(<BoardSettingsButton />)
    await userEvent.click(screen.getByRole('button', { name: 'Board settings' }))

    const level = screen.getByRole('slider', { name: 'Level' })
    expect(level).toHaveValue('60')
    expect(level).toBeEnabled()

    await userEvent.click(screen.getByLabelText('Move sounds'))
    expect(JSON.parse(window.localStorage.getItem(MOVE_SOUND_KEY) ?? '{}')).toMatchObject({
      enabled: false,
    })
    expect(level).toBeDisabled()
  })

  // The readout beside the slider is the only thing that says where it has been dragged to,
  // so it moves with it.
  it('writes the level the slider is dragged to, and shows it', () => {
    render(<BoardSettingsButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Board settings' }))

    fireEvent.change(screen.getByRole('slider', { name: 'Level' }), { target: { value: '25' } })
    expect(JSON.parse(window.localStorage.getItem(MOVE_SOUND_KEY) ?? '{}')).toMatchObject({
      volume: 25,
    })
    expect(screen.getByText('25%')).toBeInTheDocument()
  })

  // Without this the slider is a number between 0 and 100 with no meaning: you cannot judge
  // a volume you have not heard. Trailing, so a sweep across the track is one click at the
  // value it landed on rather than twenty on the way there.
  it('plays the level the slider lands on, once the drag stops', () => {
    vi.useFakeTimers()
    render(<BoardSettingsButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Board settings' }))

    const level = screen.getByRole('slider', { name: 'Level' })
    fireEvent.change(level, { target: { value: '30' } })
    fireEvent.change(level, { target: { value: '35' } })
    fireEvent.change(level, { target: { value: '40' } })
    expect(playMoveSound).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)
    expect(playMoveSound).toHaveBeenCalledTimes(1)
    expect(playMoveSound).toHaveBeenCalledWith('move', 40)
  })

  // Ticking the box answers itself. Turning it off does not: a confirming click from a
  // control whose whole job was to stop the clicks would be a joke at the reader's expense.
  it('sounds once when the box is ticked and never when it is cleared', () => {
    vi.useFakeTimers()
    render(<BoardSettingsButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Board settings' }))

    const box = screen.getByLabelText('Move sounds')
    fireEvent.click(box)
    vi.advanceTimersByTime(200)
    expect(playMoveSound).not.toHaveBeenCalled()

    fireEvent.click(box)
    vi.advanceTimersByTime(200)
    expect(playMoveSound).toHaveBeenCalledTimes(1)
    expect(playMoveSound).toHaveBeenCalledWith('move', 60)
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

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ColumnSplitter } from './ColumnSplitter'

// jsdom builds PointerEvents but captures nothing, and the splitter asks for the capture
// before it reads a single delta.
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = function setPointerCapture() {}
  Element.prototype.releasePointerCapture = function releasePointerCapture() {}
  Element.prototype.hasPointerCapture = function hasPointerCapture() {
    return false
  }
}

function renderSplitter() {
  const onResizeStart = vi.fn()
  const onResize = vi.fn()
  const onResizeEnd = vi.fn()
  const onReset = vi.fn()
  render(
    <ColumnSplitter
      label="Board column width"
      onResizeStart={onResizeStart}
      onResize={onResize}
      onResizeEnd={onResizeEnd}
      onReset={onReset}
    />,
  )
  return {
    splitter: screen.getByRole('separator', { name: 'Board column width' }),
    onResizeStart,
    onResize,
    onResizeEnd,
    onReset,
  }
}

describe('ColumnSplitter', () => {
  it('is a focusable vertical separator', () => {
    const { splitter } = renderSplitter()
    expect(splitter).toHaveAttribute('aria-orientation', 'vertical')
    expect(splitter).toHaveAttribute('tabindex', '0')
  })

  it('reports pointer travel measured from where the drag went down', () => {
    const { splitter, onResizeStart, onResize, onResizeEnd } = renderSplitter()

    fireEvent.pointerDown(splitter, { button: 0, pointerId: 1, clientX: 600 })
    expect(onResizeStart).toHaveBeenCalledTimes(1)
    expect(onResize).not.toHaveBeenCalled()

    fireEvent.pointerMove(splitter, { pointerId: 1, clientX: 660 })
    fireEvent.pointerMove(splitter, { pointerId: 1, clientX: 540 })
    // Each move is the whole distance from the start, not the step since the last one.
    expect(onResize.mock.calls).toEqual([[60], [-60]])

    fireEvent.pointerUp(splitter, { pointerId: 1, clientX: 540 })
    expect(onResizeEnd).toHaveBeenCalledTimes(1)
  })

  it('ignores pointer movement that is not part of a drag', () => {
    const { splitter, onResize, onResizeEnd } = renderSplitter()

    fireEvent.pointerMove(splitter, { pointerId: 1, clientX: 660 })
    fireEvent.pointerUp(splitter, { pointerId: 1, clientX: 660 })
    expect(onResize).not.toHaveBeenCalled()
    expect(onResizeEnd).not.toHaveBeenCalled()
  })

  it('ends the drag when the pointer is taken away mid-flight', () => {
    const { splitter, onResizeEnd } = renderSplitter()

    fireEvent.pointerDown(splitter, { button: 0, pointerId: 1, clientX: 600 })
    fireEvent.pointerCancel(splitter, { pointerId: 1 })
    expect(onResizeEnd).toHaveBeenCalledTimes(1)
    // The page has its selection back.
    expect(document.body.style.userSelect).toBe('')
  })

  it('nudges by a pixel step on the arrow keys, and keeps them from the board', () => {
    const { splitter, onResizeStart, onResize, onResizeEnd } = renderSplitter()
    const onWindowKeyDown = vi.fn()
    window.addEventListener('keydown', onWindowKeyDown)

    fireEvent.keyDown(splitter, { key: 'ArrowRight' })
    fireEvent.keyDown(splitter, { key: 'ArrowLeft' })
    expect(onResize.mock.calls).toEqual([[16], [-16]])
    // A press is a whole drag, so the owner clamps and persists it like one.
    expect(onResizeStart).toHaveBeenCalledTimes(2)
    expect(onResizeEnd).toHaveBeenCalledTimes(2)
    // The game's own arrow keys are bound on `window`; with focus here they are not the
    // game's.
    expect(onWindowKeyDown).not.toHaveBeenCalled()

    fireEvent.keyDown(splitter, { key: 'ArrowUp' })
    expect(onResize).toHaveBeenCalledTimes(2)
    expect(onWindowKeyDown).toHaveBeenCalledTimes(1)

    window.removeEventListener('keydown', onWindowKeyDown)
  })

  it('shows it can be dragged: a grip on the line, a title, and a mark while it moves', () => {
    const { splitter } = renderSplitter()
    expect(splitter).toHaveAttribute('title', 'Drag to resize · double-click to reset')

    // The grip is the part that answers in blue, under the pointer, the keyboard and a drag.
    const grip = screen.getByTestId('splitter-grip')
    expect(grip).toHaveClass('rounded-full', 'bg-edge-strong', 'group-hover:bg-accent-teal')
    expect(grip).toHaveClass('group-focus-visible:bg-accent-teal', 'group-data-[dragging]:bg-accent-teal')

    expect(splitter).not.toHaveAttribute('data-dragging')
    fireEvent.pointerDown(splitter, { button: 0, pointerId: 1, clientX: 600 })
    expect(splitter).toHaveAttribute('data-dragging')
    fireEvent.pointerUp(splitter, { pointerId: 1, clientX: 600 })
    expect(splitter).not.toHaveAttribute('data-dragging')
  })
})

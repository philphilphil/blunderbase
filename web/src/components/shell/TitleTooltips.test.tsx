import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TitleTooltips } from './TitleTooltips'

describe('TitleTooltips', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('takes the title off a hovered control and draws it as a tooltip', () => {
    render(
      <>
        <button type="button" title="Collapse the navigation">
          <svg aria-hidden />
        </button>
        <TitleTooltips />
      </>,
    )
    const button = screen.getByRole('button')

    fireEvent.pointerOver(button, { pointerType: 'mouse' })
    // The browser must never get to draw its own: the attribute goes on the first hover.
    expect(button).not.toHaveAttribute('title')
    // An icon-only control keeps its name for a screen reader.
    expect(button).toHaveAccessibleName('Collapse the navigation')
    expect(screen.queryByRole('tooltip')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Collapse the navigation')
    expect(button).toHaveAttribute('aria-describedby', 'bb-title-tooltip')

    fireEvent.pointerOut(button, { relatedTarget: document.body })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(button).not.toHaveAttribute('aria-describedby')
  })

  it('leaves a control that already has a name alone, and draws the new words after a re-render', () => {
    const { rerender } = render(
      <>
        <a href="#x" title="Blunderbase on GitHub">
          GitHub
        </a>
        <TitleTooltips />
      </>,
    )
    const link = screen.getByRole('link')
    fireEvent.pointerOver(link, { pointerType: 'mouse' })
    expect(link).not.toHaveAttribute('aria-label')
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Blunderbase on GitHub')
    fireEvent.pointerOut(link, { relatedTarget: document.body })

    rerender(
      <>
        <a href="#x" title="Blunderbase on Codeberg">
          GitHub
        </a>
        <TitleTooltips />
      </>,
    )
    fireEvent.pointerOver(link, { pointerType: 'mouse' })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Blunderbase on Codeberg')
  })

  it('goes away on Escape and on a press, and never appears for touch', () => {
    render(
      <>
        <button type="button" title="Flip the board">
          <svg aria-hidden />
        </button>
        <TitleTooltips />
      </>,
    )
    const button = screen.getByRole('button')

    fireEvent.pointerOver(button, { pointerType: 'touch' })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.pointerOver(button, { pointerType: 'mouse' })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.pointerOver(button, { pointerType: 'mouse' })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.pointerDown(button)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

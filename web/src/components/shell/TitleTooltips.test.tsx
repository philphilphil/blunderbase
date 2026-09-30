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

  it('draws a rail row’s shortcut, and leaves the row named by its words alone', () => {
    render(
      <>
        <a href="/games" title="Games ⌘2">
          Games
        </a>
        <a href="/collections" aria-label="Collections" title="Collections ⌘6" />
        <TitleTooltips />
      </>,
    )
    const [games, collections] = screen.getAllByRole('link')

    fireEvent.pointerOver(games!, { pointerType: 'mouse' })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Games ⌘2')
    // The key is a hint, not part of the name a screen reader hears.
    expect(games).toHaveAccessibleName('Games')
    fireEvent.pointerOut(games!, { relatedTarget: document.body })

    // Folded, the row is an icon named by its label, and still shows its key on hover.
    fireEvent.pointerOver(collections!, { pointerType: 'mouse' })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Collections ⌘6')
    expect(collections).toHaveAccessibleName('Collections')
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

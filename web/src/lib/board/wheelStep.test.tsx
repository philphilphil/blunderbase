import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useWheelStep } from './wheelStep'

/** One ref behind whichever of two elements is showing, the way the graph pane swaps plots. */
function Swapping({ which, onSeek }: { which: 'a' | 'b' | 'none'; onSeek: (ply: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useWheelStep(ref, { cursor: 0, onSeek })
  if (which === 'none') return <p>nothing yet</p>
  return which === 'a' ? (
    <div ref={ref} data-testid="a" />
  ) : (
    <section>
      <div ref={ref} data-testid="b" />
    </section>
  )
}

describe('useWheelStep', () => {
  it('follows the ref to whichever element is mounted behind it', () => {
    const onSeek = vi.fn()
    const { rerender } = render(<Swapping which="a" onSeek={onSeek} />)
    expect(fireEvent.wheel(screen.getByTestId('a'), { deltaY: 120 })).toBe(false)
    expect(onSeek).toHaveBeenLastCalledWith(1)

    rerender(<Swapping which="b" onSeek={onSeek} />)
    expect(fireEvent.wheel(screen.getByTestId('b'), { deltaY: 120 })).toBe(false)
    expect(onSeek).toHaveBeenCalledTimes(2)
  })

  it('binds once an element arrives after a render with none', () => {
    const onSeek = vi.fn()
    const { rerender } = render(<Swapping which="none" onSeek={onSeek} />)
    rerender(<Swapping which="a" onSeek={onSeek} />)
    expect(fireEvent.wheel(screen.getByTestId('a'), { deltaY: -120 })).toBe(false)
    expect(onSeek).toHaveBeenLastCalledWith(-1)
  })

  it('lets go of the element when the surface unmounts', () => {
    const onSeek = vi.fn()
    const { unmount } = render(<Swapping which="a" onSeek={onSeek} />)
    const node = screen.getByTestId('a')
    unmount()
    expect(fireEvent.wheel(node, { deltaY: 120 })).toBe(true)
    expect(onSeek).not.toHaveBeenCalled()
  })
})

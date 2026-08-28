import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SideDot } from './SideDot'

/**
 * The regression these guard: the dot used to be painted out of `--color-ink-2` and
 * `--color-selected`, two tokens that trade places between the dark and the light theme.
 * In the light theme that made a black game's dot pale and a white game's dark, so the
 * games table said the opposite of the board the game opened on.
 */
describe('SideDot', () => {
  it('paints white out of the side tokens, which do not swap with the theme', () => {
    render(<SideDot side="white" />)
    const dot = screen.getByRole('img', { name: 'White' })
    expect(dot).toHaveClass('bg-side-white')
    expect(dot.className).not.toMatch(/bg-(ink|selected|side-black)/)
  })

  it('paints black out of the side tokens', () => {
    render(<SideDot side="black" />)
    const dot = screen.getByRole('img', { name: 'Black' })
    expect(dot).toHaveClass('bg-side-black')
    expect(dot.className).not.toMatch(/bg-(ink|selected|side-white)/)
  })

  it('outlines a game no account claimed a side of', () => {
    render(<SideDot side={null} />)
    const dot = screen.getByRole('img', { name: 'Side unknown' })
    expect(dot).toHaveClass('border-dashed')
    expect(dot.className).not.toMatch(/bg-side-/)
  })
})

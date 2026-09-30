import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { TextLink } from './text-link'

const wrap = (node: React.ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>)

/** Accent text is a link and nothing else, and a standalone link says where it goes. */
describe('TextLink', () => {
  it('ends a standalone in-app link in a chevron', () => {
    wrap(<TextLink to="/games">All blunders</TextLink>)
    const link = screen.getByRole('link', { name: 'All blunders' })
    expect(link).toHaveAttribute('href', '/games')
    expect(link).toHaveClass('text-accent-teal')
    expect(link.querySelector('svg')).not.toBeNull()
  })

  it('opens an external link in a new tab', () => {
    wrap(
      <TextLink href="https://lichess.org" external>
        Lichess
      </TextLink>,
    )
    const link = screen.getByRole('link', { name: 'Lichess' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
    expect(link.querySelector('svg')).not.toBeNull()
  })

  it('draws a quiet link in soft text', () => {
    wrap(
      <TextLink to="/notes" tone="quiet">
        In 1 game of yours
      </TextLink>,
    )
    expect(screen.getByRole('link')).toHaveClass('text-soft')
  })

  it('underlines an inline link at rest and gives it no chevron', () => {
    wrap(
      <TextLink to="/games" placement="inline">
        Pick a game
      </TextLink>,
    )
    const link = screen.getByRole('link')
    expect(link).toHaveClass('underline')
    expect(link.querySelector('svg')).toBeNull()
  })
})

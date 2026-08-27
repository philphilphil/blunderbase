import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { ConnectionStatus } from '@/lib/events/EventsProvider'
import { ThemeProvider } from '@/lib/ui/theme'

import { SideNav } from './SideNav'

const { useEngines, useGames, useLiveState } = vi.hoisted(() => ({
  useEngines: vi.fn(),
  useGames: vi.fn(),
  useLiveState: vi.fn(),
}))
vi.mock('@/lib/api/queries', () => ({ useEngines, useGames, useLiveState }))

const { useEvents } = vi.hoisted(() => ({ useEvents: vi.fn() }))
vi.mock('@/lib/events/EventsProvider', () => ({ useEvents }))

const pending = { data: undefined, isPending: true }

function draw({ status = 'open' as ConnectionStatus, reconnects = 0 } = {}) {
  useEngines.mockReturnValue(pending)
  useGames.mockReturnValue(pending)
  useLiveState.mockReturnValue(pending)
  useEvents.mockReturnValue({ status, reconnects })
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <SideNav />
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe('the rail footer', () => {
  it('prints the version Vite baked in from package.json', () => {
    // Read off disk rather than restated, so a bump that misses `define` fails here.
    const { version } = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { version: string }

    draw()

    expect(screen.getByText(`v${version}`)).toBeInTheDocument()
  })

  it('labels the library the same on every route, and never restates the Games total', () => {
    draw()

    expect(screen.getByText('Library')).toBeInTheDocument()
    expect(screen.queryByText('Book · your games')).not.toBeInTheDocument()
    expect(screen.queryByText('Sample')).not.toBeInTheDocument()
  })

  it('carries the theme control, the source link and the connection dot', () => {
    draw({ status: 'connecting', reconnects: 0 })

    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /github/i })).toHaveAttribute(
      'href',
      'https://github.com/philphilphil/blunderbase',
    )
    expect(screen.getByRole('link', { name: /github/i })).toHaveAttribute('target', '_blank')
    expect(screen.getByLabelText('connecting to /events')).toBeInTheDocument()
  })
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { SideNav } from './SideNav'

const { useEngines, useGames, useLiveState } = vi.hoisted(() => ({
  useEngines: vi.fn(),
  useGames: vi.fn(),
  useLiveState: vi.fn(),
}))
vi.mock('@/lib/api/queries', () => ({ useEngines, useGames, useLiveState }))

const pending = { data: undefined, isPending: true }

function draw() {
  useEngines.mockReturnValue(pending)
  useGames.mockReturnValue(pending)
  useLiveState.mockReturnValue(pending)
  return render(
    <MemoryRouter>
      <SideNav />
    </MemoryRouter>,
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
})

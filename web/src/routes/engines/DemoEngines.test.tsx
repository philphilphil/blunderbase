/**
 * The demo's Engines page has one job beyond its button: not to leave a visitor thinking
 * Blunderbase has no engines, when what it has is a demo with none of its own.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'

import { DemoEngines } from './DemoEngines'

const fake = vi.hoisted(() => ({ ready: false, install: vi.fn(), supported: true }))
vi.mock('@/lib/demo/analysis', () => ({
  demoAnalysis: { install: fake.install },
  useDemoAnalysis: () => ({ ready: fake.ready }),
}))
vi.mock('@/lib/runner/support', () => ({
  browserRunnerSupport: () => ({ supported: fake.supported, reason: 'no WebAssembly here' }),
}))

function mount() {
  return render(
    <Providers>
      <MemoryRouter>
        <DemoEngines />
      </MemoryRouter>
    </Providers>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  fake.ready = false
  fake.supported = true
  fake.install.mockResolvedValue(undefined)
})

describe('DemoEngines', () => {
  it('names the two kinds of engine the demo cannot show, and where to get them', () => {
    mount()
    expect(screen.getByText('Local engines')).toBeInTheDocument()
    expect(screen.getByText('Remote runners')).toBeInTheDocument()
    expect(screen.getByText('Roles')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'run your own' })).toHaveAttribute(
      'href',
      'https://blunderbase.org',
    )
  })

  it('installs the one engine it can offer', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: 'Set up browser engine' }))
    expect(fake.install).toHaveBeenCalledOnce()
  })

  it('reports a browser that cannot run one instead of offering the button', () => {
    fake.supported = false
    mount()
    expect(screen.getByRole('button', { name: 'Set up browser engine' })).toBeDisabled()
    expect(screen.getByText('no WebAssembly here')).toBeInTheDocument()
  })

  it('says so once the engine is up', () => {
    fake.ready = true
    mount()
    expect(screen.getByRole('status')).toHaveTextContent('Stockfish is ready in this browser')
    expect(screen.queryByRole('button', { name: 'Set up browser engine' })).not.toBeInTheDocument()
  })

  it('shows what went wrong when it will not start', async () => {
    fake.install.mockRejectedValueOnce(new Error('the engine could not be started'))
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: 'Set up browser engine' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('the engine could not be started'),
    )
  })
})

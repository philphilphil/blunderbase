import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RuntimeCapabilitiesContext } from '@/lib/runtime/capabilities'
import { SERVER_CAPABILITIES } from '@/lib/api/types'

import { Providers } from '@/app/Providers'
import { useEngineSetup } from './useEngineSetup'

const fake = vi.hoisted(() => ({
  resume: vi.fn(), start: vi.fn(), install: vi.fn(), ready: vi.fn(), roles: vi.fn(), assign: vi.fn(),
  runnerId: null as number | null,
}))
vi.mock('@/lib/runner', () => ({
  browserRunner: { getSnapshot: () => ({ runnerId: fake.runnerId }), start: fake.start, resume: fake.resume },
  browserRunnerSupport: () => ({ supported: true }),
}))
vi.mock('@/lib/runner/install', () => ({
  installBrowserRunner: fake.install,
  whenBrowserEngineReady: fake.ready,
}))
vi.mock('@/lib/api/endpoints', () => ({
  createRunner: vi.fn(),
  listEngineRoles: fake.roles,
  setEngineRoles: fake.assign,
  getRunnersStatus: async () => ({ local: { engines: [] }, runners: [{
    id: 7, name: 'Browser', connected: true, transport: 'websocket', browser: true,
    engines: [{ id: 42, name: 'Stockfish', kind: 'uci', enabled: true, streams: true }],
  }] }),
}))

function Harness({ resume }: { resume: (id: number) => void }) {
  const setup = useEngineSetup()
  return <><button onClick={() => setup.show('quick', resume)}>Quick</button>{setup.dialog}</>
}
function mount(resume = vi.fn()) {
  const view = render(<Providers><MemoryRouter><Harness resume={resume} /></MemoryRouter></Providers>)
  return { ...view, resume }
}

beforeEach(() => {
  vi.clearAllMocks()
  fake.runnerId = null
  fake.install.mockImplementation(async () => { fake.runnerId = 7 })
  fake.ready.mockResolvedValue(undefined)
  fake.roles.mockResolvedValue({ roles: [{ role: 'quick', configured: false }] })
  fake.assign.mockResolvedValue({})
})

describe('engine setup', () => {
  it('offers working browser setup in the public demo', async () => {
    const user = userEvent.setup()
    render(<Providers><MemoryRouter>
      <RuntimeCapabilitiesContext value={{ ...SERVER_CAPABILITIES, read_only: true }}>
        <Harness resume={vi.fn()} />
      </RuntimeCapabilitiesContext>
    </MemoryRouter></Providers>)
    await user.click(screen.getByText('Quick'))
    expect(screen.getByRole('button', { name: 'Set up browser engine' })).toBeEnabled()
  })

  it('waits for registration, assigns the missing tier, then resumes without navigation', async () => {
    let ready!: () => void
    fake.ready.mockImplementation(() => new Promise<void>((resolve) => { ready = resolve }))
    const user = userEvent.setup()
    const { resume } = mount()
    await user.click(screen.getByText('Quick'))
    expect(screen.getByRole('link', { name: 'Go to engine page' })).toHaveAttribute('href', '/engines')
    await user.click(screen.getByRole('button', { name: 'Set up browser engine' }))
    expect(resume).not.toHaveBeenCalled()
    await act(async () => ready())
    await waitFor(() => expect(resume).toHaveBeenCalledExactlyOnceWith(42))
    expect(fake.assign).toHaveBeenCalledWith({ quick: 42 })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('reuses an installed runner and preserves configured roles', async () => {
    fake.runnerId = 7
    fake.roles.mockResolvedValue({ roles: [{ role: 'quick', configured: true }] })
    const user = userEvent.setup()
    const { resume } = mount()
    await user.click(screen.getByText('Quick'))
    await user.click(screen.getByRole('button', { name: 'Set up browser engine' }))
    await waitFor(() => expect(resume).toHaveBeenCalledWith(42))
    expect(fake.resume).toHaveBeenCalledOnce()
    expect(fake.install).not.toHaveBeenCalled()
    expect(fake.assign).not.toHaveBeenCalled()
  })

  it('keeps startup failures visible and permits retry', async () => {
    fake.ready.mockRejectedValueOnce(new Error('Stockfish could not load'))
    const user = userEvent.setup()
    const { resume } = mount()
    await user.click(screen.getByText('Quick'))
    await user.click(screen.getByRole('button', { name: 'Set up browser engine' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Stockfish could not load')
    expect(resume).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Set up browser engine' }))
    await waitFor(() => expect(resume).toHaveBeenCalledOnce())
  })

  it('does not start analysis after cancellation', async () => {
    let ready!: () => void
    fake.ready.mockImplementation(() => new Promise<void>((resolve) => { ready = resolve }))
    const user = userEvent.setup()
    const { resume } = mount()
    await user.click(screen.getByText('Quick'))
    await user.click(screen.getByRole('button', { name: 'Set up browser engine' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await act(async () => ready())
    expect(resume).not.toHaveBeenCalled()
    expect(fake.assign).not.toHaveBeenCalled()
  })
})

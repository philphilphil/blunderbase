import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'
import { MCP_SERVER_NAME } from '@/lib/mcp/status'

import { McpPage } from './McpPage'

function renderPage(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </Providers>,
  )
}

describe('McpPage', () => {
  it('hands an MCP client a config pointed at this origin, secret left blank', async () => {
    const writeText = vi.fn(async (_text: string) => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPage(<McpPage />)

    await userEvent.click(await screen.findByRole('button', { name: /Copy config/ }))

    expect(writeText).toHaveBeenCalledTimes(1)
    const config = JSON.parse(writeText.mock.calls[0]![0])
    // The same name the titlebar shows, so the config and the chrome agree.
    const server = config.mcpServers[MCP_SERVER_NAME]
    expect(server.type).toBe('http')
    expect(server.url).toBe(`${window.location.origin}/mcp`)
    // A placeholder, never the password: this page cannot know it and must not carry it.
    expect(server.headers.Authorization).toMatch(/^Bearer </)
    expect(await screen.findByRole('button', { name: /Copied/ })).toBeInTheDocument()
  })

  it('says so when there is no clipboard to copy the config to', async () => {
    // An insecure origin, which a self-hosted Blunderbase on a LAN often is.
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    renderPage(<McpPage />)

    await userEvent.click(await screen.findByRole('button', { name: /Copy config/ }))

    expect(await screen.findByRole('button', { name: /No clipboard/ })).toBeInTheDocument()
  })

  it('points at the import page for a database with nothing in it yet', () => {
    renderPage(<McpPage />)

    expect(screen.getByRole('link', { name: 'Import some games' })).toHaveAttribute(
      'href',
      '/import',
    )
  })
})

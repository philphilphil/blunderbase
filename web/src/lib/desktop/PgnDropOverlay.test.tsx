import { QueryClient } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/Providers'

import { PgnDropOverlay } from './PgnDropOverlay'

vi.mock('@/lib/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

const PGN = '[Event "Leipzig"]\n[White "Tarrasch"]\n[Black "Lasker"]\n\n1. d4 d5 0-1\n'

function renderOverlay() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers client={client}>
      <PgnDropOverlay />
    </Providers>,
  )
}

/** A window drop carrying one `.pgn` file, which is what the overlay listens for. */
function dropFile(name = 'games.pgn') {
  const file = new File([PGN], name, { type: 'text/plain' })
  fireEvent.drop(window, {
    dataTransfer: { files: [file], types: ['Files'] },
  })
}

function uploadUrls(): string[] {
  return vi
    .mocked(fetch)
    .mock.calls.map(([input]) => String(input))
    .filter((url) => url.split('?')[0] === '/api/import/pgn/upload')
}

describe('PgnDropOverlay', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ source: 'pgn', status: 'running', job_id: 7 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('asks whose games a dropped file holds instead of importing it', async () => {
    renderOverlay()
    dropFile('kasparov.pgn')

    expect(await screen.findByText('Whose games are these?')).toBeInTheDocument()
    expect(screen.getByText('kasparov.pgn')).toBeInTheDocument()
    // Nothing has been sent yet: the drop is waiting on the answer.
    expect(uploadUrls()).toHaveLength(0)
  })

  it('sends the answer, and sends nothing at all when the drop is cancelled', async () => {
    renderOverlay()
    dropFile()
    await screen.findByText('Whose games are these?')

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Whose games are these?')).not.toBeInTheDocument()
    expect(uploadUrls()).toHaveLength(0)

    dropFile()
    await screen.findByText('Whose games are these?')
    await userEvent.click(screen.getByRole('button', { name: 'Not mine' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() => expect(uploadUrls()).toHaveLength(1))
    expect(uploadUrls()[0]).toContain('mine=false')
  })

  it('says nothing about ownership when the games are the owner’s own', async () => {
    renderOverlay()
    dropFile()
    await screen.findByText('Whose games are these?')

    await userEvent.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() => expect(uploadUrls()).toHaveLength(1))
    expect(uploadUrls()[0]).not.toContain('mine')
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeProvider } from '@/lib/ui/theme'

import { SetupPage } from './SetupPage'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

let answer: () => Response

function draw() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <SetupPage />
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

beforeEach(() => {
  answer = () => json(200, { setup_required: false, authenticated: true })
  vi.stubGlobal('fetch', vi.fn(async () => answer()))
})

afterEach(() => vi.unstubAllGlobals())

describe('SetupPage', () => {
  it('says what the password is for before anything is typed', () => {
    draw()
    expect(screen.getByText(/MCP bearer key/)).toBeInTheDocument()
  })

  it('refuses a password shorter than the server would accept, without asking it', async () => {
    draw()
    await userEvent.type(screen.getByLabelText('Password'), 'short')
    await userEvent.type(screen.getByLabelText('Repeat it'), 'short')
    await userEvent.click(screen.getByRole('button', { name: /set the password/i }))

    expect(screen.getByRole('alert')).toHaveTextContent('at least 8 characters')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('will not set a password the two fields disagree about', async () => {
    draw()
    await userEvent.type(screen.getByLabelText('Password'), 'a good long one')
    await userEvent.type(screen.getByLabelText('Repeat it'), 'a good long onf')
    await userEvent.click(screen.getByRole('button', { name: /set the password/i }))

    expect(screen.getByRole('alert')).toHaveTextContent('those two do not match')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows the server’s own refusal when it is the one that says no', async () => {
    answer = () =>
      json(422, {
        error: 'weak_password',
        detail: 'the password has to be at least 8 characters',
      })
    draw()
    await userEvent.type(screen.getByLabelText('Password'), 'passworded')
    await userEvent.type(screen.getByLabelText('Repeat it'), 'passworded')
    await userEvent.click(screen.getByRole('button', { name: /set the password/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'the password has to be at least 8 characters',
    )
  })
})

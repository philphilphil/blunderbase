import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Collection } from '@/lib/api/types'

import { CollectionDialog, type CollectionDialogProps } from './CollectionDialog'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const LEAGUE: Collection = {
  id: 7,
  name: '45-45 League',
  color: 'accent',
  description: 'Lichess 45+45 league rounds',
  pinned: false,
  rule: { source: 'lichess', time_control: '2700+45', rated: true },
  game_count: 8,
  created_at: '2026-09-26T10:00:00Z',
}

/** Every write the case sent, as `METHOD path` plus its body. */
let writes: { call: string; body: unknown }[]
/** The query strings `GET /games` was asked with — the dialog's live count. */
let counts: URLSearchParams[]
let matching: number
/** How many of the matches the edited collection already holds (`?collection=7`). */
let inside: number
/** Whether the count never answers, as on a busy server. */
let countHangs: boolean
/** Whether the count fails, as when the server is restarting. */
let countFails: boolean
let nameTaken: boolean

beforeEach(() => {
  writes = []
  counts = []
  matching = 8
  inside = 0
  countHangs = false
  countFails = false
  nameTaken = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      const method = init?.method ?? 'GET'
      const body = init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown)
      if (url.pathname === '/api/games') {
        counts.push(url.searchParams)
        if (countHangs) return new Promise<Response>(() => {})
        if (countFails) return json(503, { error: 'unavailable', detail: 'restarting' })
        const total = url.searchParams.has('collection') ? inside : matching
        return json(200, { games: [], total, limit: 1, offset: 0 })
      }
      if (method !== 'GET') writes.push({ call: `${method} ${url.pathname}`, body })
      if (url.pathname === '/api/collections' && method === 'POST') {
        if (nameTaken) return json(409, { error: 'name_taken', detail: 'taken' })
        return json(201, { ...LEAGUE, ...(body as object), id: 12 })
      }
      if (url.pathname === '/api/collections/7' && method === 'PATCH') {
        return json(200, { ...LEAGUE, ...(body as object) })
      }
      if (url.pathname === '/api/collections/7' && method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      if (url.pathname === '/api/collections/7/apply-rule') {
        return json(200, { added: 3, collection: LEAGUE })
      }
      return json(404, { error: 'not_found', detail: url.pathname })
    }),
  )
})

function draw(props: Partial<CollectionDialogProps> = {}) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const onDeleted = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CollectionDialog onClose={onClose} onSaved={onSaved} onDeleted={onDeleted} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { onClose, onSaved, onDeleted }
}

describe('CollectionDialog — making one', () => {
  it('creates a plain collection with a name and a colour, and no rule', async () => {
    const user = userEvent.setup()
    const { onSaved, onClose } = draw()
    await user.type(screen.getByLabelText('Name'), 'Tough losses')
    await user.click(screen.getByRole('radio', { name: 'Orange' }))
    await user.click(screen.getByRole('button', { name: 'Create collection' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(writes).toEqual([
      {
        call: 'POST /api/collections',
        body: {
          name: 'Tough losses',
          color: 'way-back',
          description: null,
          pinned: false,
          rule: null,
          apply_to_existing: false,
        },
      },
    ])
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 12 }))
  })

  it('takes the rule from the filter that was open, counts the matches and adds them', async () => {
    const user = userEvent.setup()
    draw({
      initialRule: { source: 'lichess', time_control: '2700+45', rated: true },
      addExistingByDefault: true,
    })
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText('Source')).toHaveValue('lichess')
    expect(screen.getByLabelText('Time control')).toHaveValue('2700+45')
    expect(screen.getByLabelText('Rated')).toHaveValue('true')

    const addNow = await screen.findByRole('checkbox', {
      name: 'Also add the 8 games you already have that match',
    })
    expect(addNow).toBeChecked()
    // The count is the library's own list at one row, over the rule's filter.
    const asked = counts.at(-1)!
    expect(asked.get('limit')).toBe('1')
    expect(asked.get('source')).toBe('lichess')
    expect(asked.get('time_control')).toBe('2700+45')
    expect(asked.get('rated')).toBe('true')

    await user.type(screen.getByLabelText('Name'), '45-45 League')
    await user.click(screen.getByRole('button', { name: 'Create collection' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]!.body).toMatchObject({
      name: '45-45 League',
      rule: { source: 'lichess', time_control: '2700+45', rated: true },
      apply_to_existing: true,
    })
  })

  it('keeps a ticked "add the games already there" when saved before the count lands', async () => {
    countHangs = true
    const user = userEvent.setup()
    draw({
      initialRule: { source: 'lichess', time_control: '2700+45', rated: true },
      addExistingByDefault: true,
    })
    expect(screen.getByText('Counting the games you already have…')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Name'), 'League')
    await user.click(screen.getByRole('button', { name: 'Create collection' }))

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]!.body).toMatchObject({ apply_to_existing: true })
  })

  it('puts the picked games in by hand when made from a selection', async () => {
    const user = userEvent.setup()
    draw({ gameIds: [4, 5, 6] })
    expect(screen.getByText('With the 3 games you picked.')).toBeInTheDocument()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    await user.type(screen.getByLabelText('Name'), 'Prep')
    await user.click(screen.getByRole('button', { name: 'Create collection' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]!.body).toMatchObject({ game_ids: [4, 5, 6], rule: null })
  })

  it('says so beside the name when another collection already has it', async () => {
    nameTaken = true
    const user = userEvent.setup()
    const { onClose } = draw()
    await user.type(screen.getByLabelText('Name'), '45-45 league')
    await user.click(screen.getByRole('button', { name: 'Create collection' }))
    expect(
      await screen.findByText('There is already a collection with that name.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('asks for something to match rather than counting the whole library', async () => {
    const user = userEvent.setup()
    draw()
    await user.click(screen.getByRole('switch'))
    expect(
      screen.getByText('Pick at least one thing a game must match, or switch the rule off.'),
    ).toBeInTheDocument()
    expect(counts).toHaveLength(0)
  })

  it('offers no box when nothing already in the library matches', async () => {
    matching = 0
    draw({ initialRule: { opponent: 'nobody' } })
    expect(
      await screen.findByText('None of the games you already have match.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Also add/ })).toBeNull()
  })
})

describe('CollectionDialog — editing one', () => {
  it('saves every field, and clears the rule when it is switched off', async () => {
    const user = userEvent.setup()
    const { onClose } = draw({ collection: LEAGUE })
    expect(screen.getByLabelText('Name')).toHaveValue('45-45 League')
    await user.click(screen.getByRole('switch'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(writes).toEqual([
      {
        call: 'PATCH /api/collections/7',
        body: {
          name: '45-45 League',
          color: 'accent',
          description: 'Lichess 45+45 league rounds',
          pinned: false,
          rule: null,
        },
      },
    ])
  })

  it('pins it to the rail, or takes it off, with the box', async () => {
    const user = userEvent.setup()
    const { onClose } = draw({ collection: LEAGUE })
    const box = screen.getByRole('checkbox', { name: 'Show in the rail, under Collections' })
    expect(box).not.toBeChecked()
    await user.click(box)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(writes[0]!.body).toMatchObject({ pinned: true })
    cleanup()

    writes = []
    draw({ collection: { ...LEAGUE, pinned: true } })
    expect(
      screen.getByRole('checkbox', { name: 'Show in the rail, under Collections' }),
    ).toBeChecked()
  })

  it('runs the rule over the library once when asked to add the games already there', async () => {
    inside = 5
    const user = userEvent.setup()
    draw({ collection: LEAGUE })
    // Of the 8 that match, 5 are in it already: the box offers the other 3.
    const addNow = await screen.findByRole('checkbox', {
      name: 'Also add the 3 games that match and are not in it yet',
    })
    expect(counts.some((asked) => asked.get('collection') === '7')).toBe(true)
    expect(addNow).not.toBeChecked()
    await user.click(addNow)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(writes.map((write) => write.call)).toEqual([
      'PATCH /api/collections/7',
      'POST /api/collections/7/apply-rule',
    ])
  })

  it('offers no box when every game that matches is in it already', async () => {
    inside = 8
    draw({ collection: LEAGUE })
    expect(
      await screen.findByText('Every game you already have that matches is in it.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Also add/ })).toBeNull()
  })

  it('asks before deleting, and says the games stay', async () => {
    const user = userEvent.setup()
    const { onDeleted, onClose } = draw({ collection: LEAGUE })
    await user.click(screen.getByRole('button', { name: 'Delete…' }))
    expect(screen.getByText(/Its games stay in your library/)).toBeInTheDocument()
    expect(writes).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Delete collection' }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(7))
    expect(onClose).toHaveBeenCalled()
    expect(writes).toEqual([{ call: 'DELETE /api/collections/7', body: undefined }])
  })

  it('offers no delete while making one', () => {
    draw()
    expect(screen.queryByRole('button', { name: 'Delete…' })).toBeNull()
  })

  it('leaves the rule out of a save that did not change it', async () => {
    const user = userEvent.setup()
    const { onClose } = draw({ collection: LEAGUE })
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'League')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    // A rename must not re-send, and so restamp or undo, a rule nobody touched.
    expect(writes).toEqual([
      {
        call: 'PATCH /api/collections/7',
        body: {
          name: 'League',
          color: 'accent',
          description: 'Lichess 45+45 league rounds',
          pinned: false,
        },
      },
    ])
  })

  it('says a count that failed failed, and counts again when asked', async () => {
    countFails = true
    const user = userEvent.setup()
    draw({ collection: LEAGUE })
    expect(await screen.findByText('Could not count the games you already have.')).toBeInTheDocument()
    expect(screen.queryByText(/Counting the games/)).toBeNull()

    countFails = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('checkbox', {
        name: 'Also add the 8 games that match and are not in it yet',
      }),
    ).toBeInTheDocument()
  })
})

describe('CollectionDialog — the colours', () => {
  it('are one tab stop, walked with the arrow keys', async () => {
    const user = userEvent.setup()
    draw()
    const radios = screen.getAllByRole('radio')
    expect(radios.filter((radio) => radio.tabIndex === 0)).toHaveLength(1)

    radios[0].focus()
    await user.keyboard('{ArrowRight}')
    expect(radios[1]).toBeChecked()
    expect(document.activeElement).toBe(radios[1])

    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    // Round the end of the row.
    expect(radios[radios.length - 1]).toBeChecked()
  })
})

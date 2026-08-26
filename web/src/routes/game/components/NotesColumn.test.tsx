import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MoveRow } from '@/lib/api/types'

import type { GameNote } from '../gameModel'
import { NOTES_COLLAPSED_KEY, NotesColumn } from './NotesColumn'

/** jsdom in this setup exposes no `localStorage`; the fold brings its own. */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  }
}

const MOVES: MoveRow[] = [
  { ply: 0, move_number: 1, san: 'e4', uci: 'e2e4' },
  { ply: 1, move_number: 1, san: 'd5', uci: 'd7d5', classification: 'blunder' },
]

const NOTES: GameNote[] = [
  {
    id: 4,
    text: 'The queen comes out too early here.',
    tags: ['opening'],
    ply: 1,
    scope: 'position',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
]

function renderColumn(notes: GameNote[] = NOTES) {
  const onSelectPly = vi.fn()
  render(
    <NotesColumn
      notes={notes}
      moves={MOVES}
      recurring={null}
      recurringPending={false}
      onSelectPly={onSelectPly}
    />,
  )
  return { onSelectPly }
}

let storage: Storage

beforeEach(() => {
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('NotesColumn', () => {
  it('shows the notes and their MCP attribution', () => {
    renderColumn()
    expect(screen.getByText(/The queen comes out too early/)).toBeInTheDocument()
    expect(screen.getByText('via MCP')).toBeInTheDocument()
    // The MCP server's own status panel lives in the titlebar now, not down here.
    expect(screen.queryByText(/Notes are written by your own assistant/)).toBeNull()
  })

  it('folds the list away from the header and remembers it', async () => {
    const user = userEvent.setup()
    renderColumn()

    const header = screen.getByRole('button', { expanded: true })
    await user.click(header)

    expect(screen.queryByText(/The queen comes out too early/)).toBeNull()
    // The header itself stays: the count and the chip are the whole collapsed column.
    expect(screen.getByText('via MCP')).toBeInTheDocument()
    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument()
    expect(storage.getItem(NOTES_COLLAPSED_KEY)).toBe('1')

    await user.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText(/The queen comes out too early/)).toBeInTheDocument()
    expect(storage.getItem(NOTES_COLLAPSED_KEY)).toBe('0')
  })

  it('starts folded when that is what was stored', () => {
    storage.setItem(NOTES_COLLAPSED_KEY, '1')
    renderColumn()
    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument()
    expect(screen.queryByText(/The queen comes out too early/)).toBeNull()
  })

  it('opens with no storage at all', async () => {
    // A private window, or site data blocked: the fold degrades to a session-only toggle
    // rather than throwing on the way in.
    vi.stubGlobal('localStorage', undefined)
    const user = userEvent.setup()
    renderColumn([])

    expect(screen.getByText(/No notes on this game yet/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { expanded: true }))
    expect(screen.queryByText(/No notes on this game yet/)).toBeNull()
  })
})

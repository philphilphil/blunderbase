import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ExplorerResponse } from '@/lib/api/types'

import { MoveTreeTable } from './MoveTreeTable'

const TREE = {
  fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -',
  side_to_move: 'black',
  path: [],
  totals: { games: 12, wins: 5, draws: 1, losses: 6, score: 0.4583 },
  moves: [
    {
      uci: 'e7e5',
      san: 'e5',
      games: 5,
      wins: 3,
      draws: 1,
      losses: 1,
      score: 0.7,
      owner_moves: 5,
      evaluated: 5,
      avg_win_loss: 0.294,
      blunders: 0,
      eco: 'C20',
      name: "King's Pawn Game",
      note: { id: 12, text: 'the open games, when I want a fight' },
    },
    {
      uci: 'g8f6',
      san: 'Nf6',
      games: 3,
      wins: 1,
      draws: 0,
      losses: 2,
      score: 0.3333,
      owner_moves: 3,
      evaluated: 3,
      avg_win_loss: 12.8,
      blunders: 2,
      // Unnamed — same as most continuations past the opening, and not shown as blank text.
      eco: null,
      name: null,
      // Nothing written about where this goes either: no second line on the row.
      note: null,
    },
    {
      uci: 'g1f3',
      san: 'Nf3',
      games: 6,
      wins: 3,
      draws: 1,
      losses: 2,
      score: 0.5833,
      owner_moves: 6,
      evaluated: 6,
      avg_win_loss: 1.0,
      blunders: 0,
      eco: 'C40',
      name: "King's Knight Opening",
      note: null,
    },
  ],
  main_line: [{ ply: 0, uci: 'e7e5', san: 'e5', games: 5 }],
  book_depth: 3,
  leaves_book_with: { ply: 3, uci: 'b1c3', san: 'Nc3', games: 1 },
  leaves_book_because: 'novelty',
} as unknown as ExplorerResponse

describe('MoveTreeTable', () => {
  it('shows skeleton rows while the tree loads', () => {
    render(<MoveTreeTable tree={undefined} ply={1} loading onPlay={vi.fn()} />)
    expect(screen.getByTestId('tree-loading')).toBeInTheDocument()
  })

  it('says so when no game of the owner’s goes further', () => {
    render(
      <MoveTreeTable
        tree={{ ...TREE, moves: [] }}
        ply={1}
        loading={false}
        onPlay={vi.fn()}
      />,
    )
    expect(screen.getByText(/No game of yours goes any further/)).toBeInTheDocument()
  })

  it('renders one row per continuation, numbered at the right ply', () => {
    render(<MoveTreeTable tree={TREE} ply={1} loading={false} onPlay={vi.fn()} />)
    expect(screen.getByText('1…e5')).toBeInTheDocument()
    expect(screen.getByText('1…Nf6')).toBeInTheDocument()
    // score 0.7 -> 70.0, avg drop 12.8 win percentage points, 2 blunders behind Nf6.
    expect(screen.getByText('70.0')).toBeInTheDocument()
    expect(screen.getByText('−12.8%')).toBeInTheDocument()
  })

  it('dashes both accuracy columns on a move the owner never played', () => {
    // A continuation reached in six games where the owner was never the one to move: the
    // service counts blunders and the drop on their moves alone, so there is nothing to
    // report. A `0` and a `0.0%` would read as six games played perfectly.
    const tree = {
      ...TREE,
      moves: [
        {
          ...TREE.moves[2],
          owner_moves: 0,
          evaluated: 0,
          avg_win_loss: null,
          blunders: 0,
        },
      ],
    } as unknown as ExplorerResponse
    render(<MoveTreeTable tree={tree} ply={1} loading={false} onPlay={vi.fn()} />)
    const row = screen.getByText('1…Nf3').closest('button') as HTMLButtonElement
    expect(row.textContent).toContain('—')
    expect(row.textContent).not.toContain('0.0%')
    // Two dashes, one per column, and no bare zero standing in for either.
    expect(row.textContent?.match(/—/g)).toHaveLength(2)
  })

  it('gives the opening and the note a column each, in that order', () => {
    render(<MoveTreeTable tree={TREE} ply={1} loading={false} onPlay={vi.fn()} />)
    expect(screen.getByText('Opening')).toBeInTheDocument()
    expect(screen.getByText('Note')).toBeInTheDocument()
    // e5 both enters a named opening and stands on a position the owner has written about.
    const name = screen.getByText("King's Pawn Game")
    expect(name).toHaveAttribute('title', "King's Pawn Game")
    const note = screen.getByText('the open games, when I want a fight')
    expect(name.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the owner’s own note, whole in the title, and nothing derived', () => {
    render(<MoveTreeTable tree={TREE} ply={1} loading={false} onPlay={vi.fn()} />)
    // The Note column is truncated in place, so the full text is on the element to hover.
    expect(screen.getByText('the open games, when I want a fight')).toHaveAttribute(
      'title',
      'the open games, when I want a fight',
    )
    // What the ladder of derived notes used to say here, from numbers the row already shows
    // in its own columns. None of it is invented any more.
    expect(screen.queryByText('main line')).not.toBeInTheDocument()
    expect(screen.queryByText('2 blunders from here')).not.toBeInTheDocument()
  })

  it('leaves the Note column empty on a continuation nobody has written about', () => {
    render(<MoveTreeTable tree={TREE} ply={1} loading={false} onPlay={vi.fn()} />)
    // Nf3 carries a null note: its opening name shows and its Note cell says nothing at
    // all rather than borrowing from the row above or inventing a fact about the move.
    const row = screen.getByText('1…Nf3').closest('button') as HTMLButtonElement
    expect(row).toHaveTextContent("King's Knight Opening")
    const cells = row.querySelectorAll('.font-sans')
    expect(cells).toHaveLength(2)
    expect(cells[1]).toBeEmptyDOMElement()
  })

  it('never invents a name for an unnamed continuation', () => {
    render(<MoveTreeTable tree={TREE} ply={1} loading={false} onPlay={vi.fn()} />)
    // Nf6 is unnamed in the tree even though the row above it is, and nothing was written
    // about where it goes: nothing borrows the row above's name or note onto this row.
    const nf6Row = screen.getByText('1…Nf6').closest('button') as HTMLButtonElement
    expect(nf6Row).not.toHaveTextContent("King's Pawn Game")
    expect(nf6Row).not.toHaveTextContent('the open games')
  })

  it('scrolls past ten continuations rather than growing the page', () => {
    // Twenty-four is what the page asks for, and the cards under the table must sit in the
    // same place at four continuations and at twenty-four.
    const many = Array.from({ length: 24 }, (_, index) => ({
      ...TREE.moves[1],
      uci: `x${index}`,
      san: `M${index}`,
    }))
    const { container } = render(
      <MoveTreeTable
        tree={{ ...TREE, moves: many } as unknown as ExplorerResponse}
        ply={1}
        loading={false}
        onPlay={vi.fn()}
      />,
    )
    // Every row is rendered — the cap scrolls, it does not fetch or draw less.
    expect(screen.getAllByRole('row')).toHaveLength(many.length + 1) // + the header
    // Fifteen rows of 1.5rem and the fourteen 0.125rem gaps between them.
    const rows = container.querySelector('.overflow-y-auto') as HTMLElement
    expect(rows.style.height).toBe('24.25rem')
    // The rows may not shrink to fit the box: that is what made them change height with
    // the number of continuations instead of scrolling.
    for (const row of Array.from(rows.children)) expect(row).toHaveClass('flex-none')
    // The header is outside the scroller, so it stays put while the rows move.
    expect(rows.textContent).not.toContain('Avg drop')
  })

  it('keeps four continuations the same height as ten', () => {
    const { container } = render(<MoveTreeTable tree={TREE} ply={1} loading={false} onPlay={vi.fn()} />)
    // A height, not a maximum: the pane is the same size whatever the position has to
    // show, so walking a line or switching to a reference book moves nothing below it.
    const rows = container.querySelector('.overflow-y-auto') as HTMLElement
    expect(rows.style.height).toBe('24.25rem')
    expect(rows.children).toHaveLength(TREE.moves.length)
  })

  it('gives the loading and empty states that same height', () => {
    const loading = render(<MoveTreeTable tree={undefined} ply={1} loading onPlay={vi.fn()} />)
    expect(loading.getByTestId('tree-loading').style.height).toBe('24.25rem')
    loading.unmount()

    const empty = render(
      <MoveTreeTable
        tree={{ ...TREE, moves: [] } as unknown as ExplorerResponse}
        ply={1}
        loading={false}
        onPlay={vi.fn()}
      />,
    )
    const box = empty.getByText(/No game of yours/).parentElement as HTMLElement
    expect(box.style.height).toBe('24.25rem')
  })

  it('walks the tree when a continuation is clicked', async () => {
    const onPlay = vi.fn()
    render(<MoveTreeTable tree={TREE} ply={1} loading={false} onPlay={onPlay} />)
    await userEvent.click(screen.getByText('1…Nf6'))
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ uci: 'g8f6' }))
  })

  it('previews a continuation on hover and clears it on leave', async () => {
    const user = userEvent.setup()
    const onPreview = vi.fn()
    render(
      <MoveTreeTable tree={TREE} ply={1} loading={false} onPlay={vi.fn()} onPreview={onPreview} />,
    )
    const row = screen.getByText('1…Nf6')
    await user.hover(row)
    expect(onPreview).toHaveBeenLastCalledWith(['g8f6'])
    await user.unhover(row)
    expect(onPreview).toHaveBeenLastCalledWith(null)
  })

  it('mirrors the same preview on keyboard focus and blur', () => {
    const onPreview = vi.fn()
    render(
      <MoveTreeTable tree={TREE} ply={1} loading={false} onPlay={vi.fn()} onPreview={onPreview} />,
    )
    const row = screen.getByText('1…e5').closest('button') as HTMLButtonElement
    row.focus()
    expect(onPreview).toHaveBeenLastCalledWith(['e7e5'])
    row.blur()
    expect(onPreview).toHaveBeenLastCalledWith(null)
  })
})

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { EngineLineView, HumanMoveView } from '../gameModel'
import { MaiaPanel } from './MaiaPanel'

/** The position after 1.e4: what a 1700 plays as Black, and what the engine says about it. */
const HUMAN: HumanMoveView[] = [
  {
    uci: 'd7d5',
    san: 'd5',
    rank: 1,
    probability: 0.62,
    played: true,
    classification: 'blunder',
    loss: 26.3,
    multipv: null,
  },
  {
    uci: 'c7c6',
    san: 'c6',
    rank: 2,
    probability: 0.2,
    played: false,
    classification: 'best',
    loss: 0,
    multipv: 1,
  },
  {
    uci: 'a7a6',
    san: 'a6',
    rank: 3,
    probability: null,
    played: false,
    classification: null,
    loss: null,
    multipv: null,
  },
]

const ENGINE: EngineLineView[] = [
  {
    multipv: 1,
    score: { cp: 40 },
    text: '1…c6 2.d4 d5',
    sans: ['c6', 'd4', 'd5'],
    pv: ['c7c6', 'd2d4', 'd7d5'],
    firstUci: 'c7c6',
    played: false,
    classification: null,
  },
  {
    multipv: 2,
    score: { cp: 120 },
    text: '1…e6',
    sans: ['e6'],
    pv: ['e7e6'],
    firstUci: 'e7e6',
    played: false,
    classification: null,
  },
]

describe('MaiaPanel', () => {
  it('puts the human distribution beside the engine’s own moves', () => {
    render(<MaiaPanel rating="1700" human={HUMAN} engine={ENGINE} ply={1} />)

    const panel = screen.getByTestId('maia-panel')
    expect(panel).toHaveTextContent('Maia 1700')
    expect(panel).toHaveTextContent('Stockfish')
    // Popularity and cost, side by side — the whole point of the card.
    expect(panel).toHaveTextContent('62%')
    expect(panel).toHaveTextContent('−26.3%')
    expect(within(panel).getByText('+0.40')).toBeInTheDocument()
    // The single-sentence "a 1700 plays d5 here" copy is gone.
    expect(panel).not.toHaveTextContent('plays')
  })

  it('marks the move that was actually played and colours it with the engine’s verdict', () => {
    render(<MaiaPanel rating="1700" human={HUMAN} engine={ENGINE} ply={1} />)

    const played = screen.getByTestId('maia-played-row')
    expect(within(played).getByText('d5')).toHaveClass('text-blunder')
    expect(played.style.borderLeftColor).toBe('var(--bb-blunder)')
    // The engine's own choice is teal on the same list, unplayed and unmarked.
    const rows = screen.getAllByTestId('maia-row')
    expect(within(rows[0]).getByText('c6')).toHaveClass('text-accent-teal')
  })

  it('leaves a move with no probability and no verdict in its neutral treatment', () => {
    render(<MaiaPanel rating="1700" human={HUMAN} engine={ENGINE} ply={1} />)
    const unknown = screen.getAllByTestId('maia-row')[1]
    expect(within(unknown).getByText('a6')).toHaveClass('text-soft')
    expect(unknown).toHaveTextContent('—')
  })

  it('expands an engine row to its stored line, and plays a move off it', async () => {
    const onPlayLine = vi.fn()
    render(<MaiaPanel rating="1700" human={HUMAN} engine={ENGINE} ply={1} onPlayLine={onPlayLine} />)

    // Collapsed: only the first move of the line is on screen.
    expect(screen.queryByRole('button', { name: 'd4' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show the line' }))
    expect(screen.getByRole('button', { name: 'd4' })).toBeInTheDocument()

    // Clicking the second move plays the line up to it onto the analysis board.
    await userEvent.click(screen.getByRole('button', { name: 'd4' }))
    expect(onPlayLine).toHaveBeenLastCalledWith(['c7c6', 'd2d4'])
  })

  it('says it is live, and offers the rollout as a line to walk into', async () => {
    const onPlayLine = vi.fn()
    render(
      <MaiaPanel
        rating="1700"
        human={HUMAN}
        engine={[]}
        ply={1}
        live={{
          rollout: [
            { uci: 'd7d5', san: 'd5', rank: 1, probability: 0.62 },
            { uci: 'e4d5', san: 'exd5', rank: 1, probability: 0.9 },
          ],
          pending: false,
        }}
        onPlayLine={onPlayLine}
      />,
    )

    expect(screen.getByTestId('maia-live')).toHaveTextContent('live')
    const rollout = screen.getByTestId('maia-rollout')
    expect(rollout).toHaveTextContent('90%')

    await userEvent.click(within(rollout).getByRole('button', { name: 'exd5' }))
    expect(onPlayLine).toHaveBeenLastCalledWith(['d7d5', 'e4d5'])
  })

  it('holds the card while a live query is in flight, rather than blinking out', () => {
    render(
      <MaiaPanel rating={null} human={[]} engine={[]} ply={1} live={{ rollout: [], pending: true }} />,
    )
    expect(screen.getByTestId('maia-panel')).toHaveTextContent('Reading this position…')
  })

  it('is nothing at all where there is nothing to say', () => {
    render(<MaiaPanel rating={null} human={[]} engine={[]} ply={1} />)
    expect(screen.queryByTestId('maia-panel')).not.toBeInTheDocument()
  })
})

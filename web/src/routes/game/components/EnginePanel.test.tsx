import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { EngineLineView } from '../gameModel'
import { EnginePanel } from './EnginePanel'

const LINES: EngineLineView[] = [
  {
    multipv: 1,
    score: { cp: 40 },
    text: '1…c6 2.d4',
    firstUci: 'c7c6',
    played: false,
    classification: null,
  },
  {
    multipv: 2,
    score: { cp: -300 },
    text: '1…d5 2.exd5',
    firstUci: 'd7d5',
    played: true,
    classification: 'blunder',
  },
]

describe('EnginePanel', () => {
  it('offers the pointed-at line’s first move for the board, and clears it on leaving', async () => {
    const onHoverMove = vi.fn()
    render(<EnginePanel run={null} lines={LINES} ply={1} onHoverMove={onHoverMove} />)

    const row = screen.getByText('1…c6 2.d4').closest('div')!
    await userEvent.hover(row)
    expect(onHoverMove).toHaveBeenLastCalledWith('c7c6')
    await userEvent.unhover(row)
    expect(onHoverMove).toHaveBeenLastCalledWith(null)

    // The played move is a line like any other — pointing at it shows what it does.
    await userEvent.hover(screen.getByTestId('engine-played-line'))
    expect(onHoverMove).toHaveBeenLastCalledWith('d7d5')
  })

  it('renders without a hover handler at all', () => {
    render(<EnginePanel run={null} lines={LINES} ply={1} />)
    expect(screen.getByText('No engine run')).toBeInTheDocument()
  })
})

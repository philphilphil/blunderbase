import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { PracticeOpponents } from '@/lib/api/types'

import { PracticeDialog } from './PracticeDialog'

const OPPONENTS: PracticeOpponents = {
  engines: [
    {
      engine_id: 1,
      name: 'stockfish',
      runner_id: null,
      available: true,
      reason: null,
      strength: { min: 1320, max: 3190, default: 1320 },
    },
    { engine_id: 2, name: 'leela', runner_id: null, available: true, reason: null, strength: null },
    {
      engine_id: 3,
      name: 'box-sf',
      runner_id: 4,
      available: false,
      reason: "'gpu-box' runs a version that cannot play practice moves; update it",
      strength: null,
    },
  ],
  default_engine_id: 1,
  maia: { available: true, reason: null },
  movetime_ms: { default: 1000, min: 100, max: 10000 },
}

function renderDialog(overrides: Partial<Parameters<typeof PracticeDialog>[0]> = {}) {
  const onStart = vi.fn()
  render(
    <PracticeDialog
      opponents={OPPONENTS}
      loadError={null}
      maiaLevels={[1700, 1100]}
      defaultSide="white"
      onStart={onStart}
      onClose={vi.fn()}
      {...overrides}
    />,
  )
  return { onStart }
}

describe('PracticeDialog', () => {
  it('opens on Maia at the target level, and starts a game against it', async () => {
    const user = userEvent.setup()
    const { onStart } = renderDialog()
    expect(screen.getByRole('button', { name: 'Maia' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Maia level')).toHaveValue('1700')

    await user.selectOptions(screen.getByLabelText('Maia level'), '1100')
    await user.click(screen.getByRole('button', { name: 'Black' }))
    await user.click(screen.getByRole('button', { name: 'Play' }))
    expect(onStart).toHaveBeenCalledWith({ side: 'black', opponent: { kind: 'maia', level: 1100 } })
  })

  it('holds an engine to a rating, or plays it at full strength', async () => {
    const user = userEvent.setup()
    const { onStart } = renderDialog()
    await user.click(screen.getByRole('button', { name: 'stockfish' }))
    expect(screen.getByRole('slider')).toHaveValue('1700')

    await user.click(screen.getByRole('button', { name: '2 s' }))
    await user.click(screen.getByRole('checkbox', { name: 'Full strength' }))
    await user.click(screen.getByRole('button', { name: 'Play' }))
    expect(onStart).toHaveBeenCalledWith({
      side: 'white',
      opponent: { kind: 'engine', engineId: 1, name: 'stockfish', elo: null, movetimeMs: 2000 },
    })
  })

  it('says an engine without a rating limit plays at full strength', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: 'leela' }))
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.getByText(/leela declares no rating limit/)).toBeInTheDocument()
  })

  it('greys an engine that cannot answer, and says why', () => {
    renderDialog()
    expect(screen.getByRole('button', { name: 'box-sf' })).toBeDisabled()
    expect(screen.getByText(/cannot play practice moves; update it/)).toBeInTheDocument()
  })
})

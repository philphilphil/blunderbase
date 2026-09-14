import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { CorrespondenceSearchEngine } from '@/lib/api/types'
import { I18nProvider } from '@/lib/i18n/I18nProvider'

import { AnalyseDialog, parseLimit, type AnalyseDialogProps } from './AnalyseDialog'

const ENGINES: CorrespondenceSearchEngine[] = [
  { engine_id: 1, name: 'Stockfish 17', default: false },
  { engine_id: 2, name: 'Stockfish 17', default: true, runner_id: 4, host: "runner 'gpu-box'" },
]

function draw(props: Partial<AnalyseDialogProps> = {}) {
  const onQueue = vi.fn()
  render(
    <I18nProvider>
      <AnalyseDialog
        engines={ENGINES}
        defaultMultipv={2}
        defaultNodes={500_000}
        cursor={5}
        cursorSan="Nf6"
        plyCount={40}
        pending={false}
        error={null}
        onQueue={onQueue}
        onClose={vi.fn()}
        {...props}
      />
    </I18nProvider>,
  )
  return { onQueue }
}

describe('AnalyseDialog', () => {
  it('opens on the analysis role’s engine, depth 24 and the whole game', async () => {
    const { onQueue } = draw()
    // A runner's engine is fine: a run is queue work, not a search that drives a board.
    expect(screen.getByRole('button', { name: /gpu-box/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Depth' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Limit')).toHaveValue(24)
    expect(screen.getByLabelText('Lines')).toHaveAttribute('placeholder', '2')
    expect(screen.getByRole('button', { name: 'Whole game' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Analyse' }))
    expect(onQueue).toHaveBeenCalledWith({ engine_id: 2, depth: 24 })
  })

  it('greys an engine the server would refuse, says why, and does not preselect it', async () => {
    const { onQueue } = draw({
      engines: [
        { engine_id: 1, name: 'Leela', default: false },
        {
          engine_id: 2,
          name: 'Stockfish 17',
          default: true,
          search_trouble: "'Stockfish 17' has no binary at /usr/bin/stockfish",
        },
      ],
    })
    expect(screen.getByRole('button', { name: /Stockfish 17/ })).toBeDisabled()
    expect(
      screen.getByText("Stockfish 17: 'Stockfish 17' has no binary at /usr/bin/stockfish"),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Analyse' }))
    expect(onQueue).toHaveBeenCalledWith({ engine_id: 1, depth: 24 })
  })

  it('resets the number to the kind’s own default when the kind changes', async () => {
    const { onQueue } = draw()
    await userEvent.click(screen.getByRole('button', { name: 'Seconds' }))
    expect(screen.getByLabelText('Limit')).toHaveValue(5)
    await userEvent.click(screen.getByRole('button', { name: 'Nodes' }))
    // The import pass's budget, so "nodes" starts from the number the library already has.
    expect(screen.getByLabelText('Limit')).toHaveValue(500_000)
    await userEvent.click(screen.getByRole('button', { name: 'Analyse' }))
    expect(onQueue).toHaveBeenCalledWith({ engine_id: 2, nodes: 500_000 })
  })

  it('sends this move and from here on as windows starting at the move on the board', async () => {
    const { onQueue } = draw()
    await userEvent.click(screen.getByRole('button', { name: 'This move' }))
    expect(screen.getByText(/3… Nf6/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Lines'), '4')
    await userEvent.click(screen.getByRole('button', { name: 'Analyse' }))
    expect(onQueue).toHaveBeenLastCalledWith({
      engine_id: 2,
      multipv: 4,
      depth: 24,
      ply_start: 5,
      ply_end: 6,
    })

    await userEvent.click(screen.getByRole('button', { name: 'From here on' }))
    await userEvent.click(screen.getByRole('button', { name: 'Stockfish 17' }))
    await userEvent.click(screen.getByRole('button', { name: 'Analyse' }))
    expect(onQueue).toHaveBeenLastCalledWith({
      engine_id: 1,
      multipv: 4,
      depth: 24,
      ply_start: 5,
      ply_end: 40,
    })
  })

  it('has no move to offer at the starting position', () => {
    draw({ cursor: -1, cursorSan: null })
    expect(screen.getByRole('button', { name: 'This move' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'From here on' })).toBeDisabled()
  })

  it('holds the button back on a limit or a line count it cannot send', async () => {
    draw()
    const submit = screen.getByRole('button', { name: 'Analyse' })
    await userEvent.clear(screen.getByLabelText('Limit'))
    // Unlike a correspondence search, an empty limit is not "run on": every move needs one.
    expect(submit).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Limit'), '30')
    expect(submit).toBeEnabled()
    await userEvent.type(screen.getByLabelText('Lines'), '9')
    expect(submit).toBeDisabled()
  })

  it('says a refusal inside the dialog, and waits for the engine list', () => {
    draw({ engines: undefined, error: "'sf-nuc' runs on 'nuc', which is not connected" })
    expect(screen.getByRole('alert')).toHaveTextContent('which is not connected')
    expect(screen.getByText('Looking for engines…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Analyse' })).toBeDisabled()
  })
})

describe('parseLimit', () => {
  it('keeps a fraction of a second and truncates depth and nodes', () => {
    expect(parseLimit('seconds', '0.5')).toBe(0.5)
    expect(parseLimit('depth', '24.7')).toBe(24)
    expect(parseLimit('depth', '0.5')).toBeNull()
    expect(parseLimit('nodes', '')).toBeNull()
    expect(parseLimit('nodes', '-3')).toBeNull()
  })
})

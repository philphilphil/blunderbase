import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { StreamSessionApi, StreamSnapshot } from '@/lib/analysis'
import type { StreamResponse } from '@/lib/api/types'
import type { EngineHost } from '@/lib/engines/hosts'

import { InfiniteAnalysisPanel } from './InfiniteAnalysisPanel'

/** After 1.e4 c5 2.Nf3 — Black to move, ply 3. */
const SICILIAN = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2'

const LOCAL: EngineHost = {
  engineId: 1,
  name: 'stockfish',
  kind: 'uci',
  enabled: true,
  tier: 'deep',
  path: '/usr/games/stockfish',
  runnerId: null,
  runnerName: null,
  connected: true,
  transport: null,
  streams: true,
  streamsReason: null,
}

const POLLING: EngineHost = {
  engineId: 7,
  name: 'sf-remote',
  kind: 'uci',
  enabled: true,
  tier: 'deep',
  path: '/usr/games/stockfish',
  runnerId: 3,
  runnerName: 'gpu-box',
  connected: true,
  transport: 'poll',
  streams: false,
  streamsReason: 'queue only — gpu-box is connected over polling',
}

const SESSION: StreamResponse = {
  id: 'str_1',
  surface: 'game',
  fen: SICILIAN,
  multipv: 3,
  engine_id: 1,
  engine: 'stockfish',
  runner_id: null,
  runner: null,
  state: 'running',
  reason: null,
  seq: 7,
  created_at: '2026-08-26T10:00:00+00:00',
  last_snapshot_at: '2026-08-26T10:00:10+00:00',
  game_id: 14,
  ply: 3,
}

const SNAPSHOT: StreamSnapshot = {
  sessionId: 'str_1',
  seq: 7,
  engineId: 1,
  engine: 'stockfish',
  runnerId: null,
  fen: SICILIAN,
  multipv: 3,
  depth: 24,
  nodes: 18_402_113,
  nps: 1_840_211,
  timeMs: 10_000,
  lines: [
    // Deliberately out of order: the panel sorts, the engine does not promise to.
    { multipv: 2, cp: 21, mate: null, pv: ['b8c6', 'd2d4'] },
    { multipv: 1, cp: 34, mate: null, pv: ['d7d6', 'd2d4', 'c5d4'] },
    { multipv: 3, cp: null, mate: 5, pv: ['e7e6'] },
  ],
  at: '2026-08-26T10:00:10+00:00',
}

function streamApi(overrides: Partial<StreamSessionApi> = {}): StreamSessionApi {
  return {
    enabled: false,
    setEnabled: vi.fn(),
    phase: 'off',
    session: null,
    snapshot: null,
    error: null,
    note: null,
    offer: null,
    engines: [LOCAL, POLLING],
    engineId: null,
    setEngineId: vi.fn(),
    multipv: 3,
    setMultipv: vi.fn(),
    resume: vi.fn(),
    dismissOffer: vi.fn(),
    ...overrides,
  }
}

describe('InfiniteAnalysisPanel', () => {
  it('offers the search rather than starting one', async () => {
    const setEnabled = vi.fn()
    render(
      <InfiniteAnalysisPanel stream={streamApi({ setEnabled })} fen={SICILIAN} ply={3} />,
    )

    expect(screen.getByText('Analyse this position continuously.')).toBeInTheDocument()
    const toggle = screen.getByRole('switch', { name: 'Analyse this position continuously' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    await userEvent.click(toggle)
    expect(setEnabled).toHaveBeenCalledWith(true)
  })

  it('disables the controls when there is nothing on the board', () => {
    render(<InfiniteAnalysisPanel stream={streamApi()} fen={null} />)

    const toggle = screen.getByRole('switch', { name: 'Analyse this position continuously' })
    expect(toggle).toBeDisabled()
    expect(toggle).toHaveAttribute('title', 'nothing is on the board')
    expect(screen.getByRole('combobox', { name: 'Engine' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Lines' })).toBeDisabled()
  })

  it('keeps the controls under the lines rather than over them', () => {
    render(
      <InfiniteAnalysisPanel
        stream={streamApi({
          enabled: true,
          phase: 'running',
          session: SESSION,
          snapshot: SNAPSHOT,
        })}
        fen={SICILIAN}
        ply={3}
      />,
    )

    const rows = screen.getAllByTestId('infinite-analysis-line')
    const last = rows[rows.length - 1]!
    for (const control of [
      screen.getByRole('switch', { name: 'Analyse this position continuously' }),
      screen.getByRole('combobox', { name: 'Engine' }),
      screen.getByRole('combobox', { name: 'Lines' }),
    ]) {
      expect(last.compareDocumentPosition(control)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    }
  })

  it('renders the multi-PV lines as SAN, sorted, with the engine’s own evals', () => {
    render(
      <InfiniteAnalysisPanel
        stream={streamApi({
          enabled: true,
          phase: 'running',
          session: SESSION,
          snapshot: SNAPSHOT,
        })}
        fen={SICILIAN}
        ply={3}
      />,
    )

    const rows = screen.getAllByTestId('infinite-analysis-line')
    expect(rows).toHaveLength(3)
    // multipv 1 first, whatever order the frame arrived in.
    expect(within(rows[0]!).getByText('+0.34')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('2…d6 3.d4 cxd4')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('+0.21')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('2…Nc6 3.d4')).toBeInTheDocument()
    // Mate wins over centipawns.
    expect(within(rows[2]!).getByText('M5')).toBeInTheDocument()
    expect(within(rows[2]!).getByText('2…e6')).toBeInTheDocument()

    // The lines reach the panel already in White's frame (`streamModel`); the header still
    // names whose move it is, which the numbers alone do not say.
    expect(screen.getByText('black to move')).toBeInTheDocument()
    expect(screen.getByTestId('infinite-analysis-engine')).toHaveTextContent('stockfish')
    expect(screen.getByText('local')).toBeInTheDocument()
    expect(screen.getByText('d24')).toBeInTheDocument()
    expect(screen.getByText('18.4M nodes')).toBeInTheDocument()
    expect(screen.getByText('1.8M/s')).toBeInTheDocument()
    expect(screen.queryByTestId('infinite-analysis-pending')).not.toBeInTheDocument()
  })

  it('offers the hovered line’s first move, and takes it back on leaving', async () => {
    const onHoverMove = vi.fn()
    render(
      <InfiniteAnalysisPanel
        stream={streamApi({
          enabled: true,
          phase: 'running',
          session: SESSION,
          snapshot: SNAPSHOT,
        })}
        fen={SICILIAN}
        ply={3}
        onHoverMove={onHoverMove}
      />,
    )

    const rows = screen.getAllByTestId('infinite-analysis-line')
    await userEvent.hover(rows[1]!)
    // The second-best line, not the first: the arrow follows the pointer.
    expect(onHoverMove).toHaveBeenLastCalledWith('b8c6')
    await userEvent.unhover(rows[1]!)
    expect(onHoverMove).toHaveBeenLastCalledWith(null)
  })

  it('falls back to the raw UCI when the position will not replay', () => {
    render(
      <InfiniteAnalysisPanel
        stream={streamApi({
          enabled: true,
          phase: 'running',
          session: SESSION,
          snapshot: { ...SNAPSHOT, lines: [SNAPSHOT.lines[1]!] },
        })}
        fen="not a position"
      />,
    )
    expect(screen.getByText('d7d6 d2d4 c5d4')).toBeInTheDocument()
  })

  it('holds the rows open while the search is starting', () => {
    render(
      <InfiniteAnalysisPanel
        stream={streamApi({ enabled: true, phase: 'opening' })}
        fen={SICILIAN}
      />,
    )
    expect(screen.getByTestId('infinite-analysis-pending')).toBeInTheDocument()
    expect(screen.queryAllByTestId('infinite-analysis-line')).toHaveLength(0)
  })

  it('lists only the engines that can drive a board', () => {
    render(<InfiniteAnalysisPanel stream={streamApi()} fen={SICILIAN} />)

    const picker = screen.getByRole('combobox', { name: 'Engine' })
    // The queue-only engine is not offered at all — the picker is a choice, not a roster.
    expect(within(picker).queryByRole('option', { name: /sf-remote/ })).not.toBeInTheDocument()
    expect(within(picker).getByRole('option', { name: 'stockfish · local' })).toBeEnabled()
    // The default is the deep tier, resolved by the server.
    expect(picker).toHaveValue('')
    expect(within(picker).getByRole('option', { name: 'deep tier' })).toBeInTheDocument()
  })

  it('names the deep tier’s engine once a session has resolved it', () => {
    render(
      <InfiniteAnalysisPanel
        stream={streamApi({ enabled: true, phase: 'running', session: SESSION })}
        fen={SICILIAN}
      />,
    )
    expect(
      screen.getByRole('option', { name: 'deep tier — stockfish' }),
    ).toBeInTheDocument()
  })

  it('offers the surviving engines when the runner goes away mid-search', async () => {
    const resume = vi.fn()
    const dismissOffer = vi.fn()
    render(
      <InfiniteAnalysisPanel
        stream={streamApi({
          phase: 'ended',
          session: { ...SESSION, runner_id: 3, runner: 'gpu-box', engine_id: 7 },
          resume,
          dismissOffer,
          offer: {
            reason: 'runner_gone',
            error: 'EngineTerminatedError: the link dropped',
            candidates: [LOCAL],
          },
        })}
        fen={SICILIAN}
      />,
    )

    expect(screen.getByText('gpu-box went away mid-search.')).toBeInTheDocument()
    expect(
      screen.getByText('EngineTerminatedError: the link dropped'),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Resume on stockfish' }))
    expect(resume).toHaveBeenCalledWith(1)

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(dismissOffer).toHaveBeenCalled()
  })

  it('says why a refusal left the toggle off', () => {
    render(
      <InfiniteAnalysisPanel
        stream={streamApi({
          phase: 'error',
          error: new Error('2 analysis board(s) can be open at once; close one first'),
        })}
        fen={SICILIAN}
      />,
    )
    expect(
      screen.getByText('2 analysis board(s) can be open at once; close one first'),
    ).toBeInTheDocument()
  })

  it('says when another board took the surface over', () => {
    render(
      <InfiniteAnalysisPanel
        stream={streamApi({ note: 'Another analysis board took this position over.' })}
        fen={SICILIAN}
      />,
    )
    expect(
      screen.getByText('Another analysis board took this position over.'),
    ).toBeInTheDocument()
  })
})

import { ApiError } from '@/lib/api/client'
import type { ReactElement } from 'react'
import { Providers } from '@/app/Providers'
import { MemoryRouter } from 'react-router-dom'
import { act, fireEvent, render as renderDom, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamSessionApi, StreamSnapshot } from '@/lib/analysis'
import type { StreamResponse } from '@/lib/api/types'
import { resetLinePreviewPrefs, setLinePreviewPrefs } from '@/lib/board/linePreviewPrefs'
import type { EngineHost } from '@/lib/engines/hosts'

import {
  InfiniteAnalysisPanel,
  type InfiniteAnalysisPanelProps,
} from './InfiniteAnalysisPanel'

function render(ui: ReactElement) {
  return renderDom(<Providers><MemoryRouter>{ui}</MemoryRouter></Providers>)
}

/** After 1.e4 c5 2.Nf3 — Black to move, ply 3. */
const SICILIAN = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2'

const LOCAL: EngineHost = {
  engineId: 1,
  name: 'stockfish',
  kind: 'uci',
  enabled: true,
  path: '/usr/games/stockfish',
  pathScheme: null,
  runnerId: null,
  runnerName: null,
  browser: false,
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
  path: '/usr/games/stockfish',
  pathScheme: null,
  runnerId: 3,
  runnerName: 'gpu-box',
  browser: false,
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

/** The top line's PV, which the token gestures are all about. */
const TOP_PV = ['d7d6', 'd2d4', 'c5d4']

/** The panel mid-search over the three lines above: where every hover test starts. */
function renderLines(props: Partial<InfiniteAnalysisPanelProps> = {}) {
  return render(
    <InfiniteAnalysisPanel
      stream={streamApi({
        enabled: true,
        phase: 'running',
        session: SESSION,
        snapshot: SNAPSHOT,
      })}
      fen={SICILIAN}
      ply={3}
      {...props}
    />,
  )
}

/** The `k`th token (1-based) of a row, the way the preview numbers plies. */
function token(row: HTMLElement, k: number): HTMLElement {
  const found = row.querySelector(`[data-ply="${k}"]`)
  if (!(found instanceof HTMLElement)) throw new Error(`no token at ply ${k}`)
  return found
}

/** jsdom in this setup exposes no `localStorage`, so the tests bring their own. */
function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, String(value)),
  }
}

describe('InfiniteAnalysisPanel', () => {
  beforeEach(() => {
    // The preview prefs are per browser and shared between tests through one module-level
    // cache; a test that sets a mode would otherwise pick the next one's answer for it.
    vi.stubGlobal('localStorage', memoryStorage())
    localStorage.clear()
    resetLinePreviewPrefs()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetLinePreviewPrefs()
  })

  it('offers setup after continuous analysis is refused for an unassigned deep role', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ roles: [
      { role: 'deep', configured: false, available: false },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } })))
    render(<InfiniteAnalysisPanel fen={SICILIAN} ply={3} stream={streamApi({
      phase: 'error',
      error: new ApiError(409, { error: 'stream_unavailable', detail: 'no engine is assigned' }),
    })} />)
    expect(await screen.findByRole('dialog')).toHaveTextContent('No engine is set up')
  })

  it('offers setup when the tab itself has no engine, without asking the server', async () => {
    // The demo's own refusal: the board never reached the server, so the roles it would
    // have asked about are not a question worth a round trip.
    const fetched = vi.fn()
    vi.stubGlobal('fetch', fetched)
    render(<InfiniteAnalysisPanel fen={SICILIAN} ply={3} stream={streamApi({
      phase: 'error',
      error: new ApiError(409, { error: 'browser_engine_missing', detail: 'No engine is set up' }),
    })} />)
    expect(await screen.findByRole('dialog')).toHaveTextContent('No engine is set up')
    expect(fetched).not.toHaveBeenCalled()
  })

  it('leaves an engine that is merely away to the toast that names it', async () => {
    // Deep *is* assigned — the engine holding it is on a machine that is not connected.
    // Browser Stockfish is not what that deployment is missing, so no dialog is offered.
    const roles = vi.fn(async () => new Response(JSON.stringify({ roles: [
      { role: 'deep', configured: true, available: false },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', roles)
    render(<InfiniteAnalysisPanel fen={SICILIAN} ply={3} stream={streamApi({
      phase: 'error',
      error: new ApiError(409, {
        error: 'stream_unavailable',
        detail: "'sf-nuc' runs on 'nuc', which is not connected",
      }),
    })} />)
    await waitFor(() => expect(roles).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

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
    // multipv 1 first, whatever order the frame arrived in. The variation is a row of
    // tokens now, so it is read off the whole line rather than out of one text node.
    expect(within(rows[0]!).getByText('+0.34')).toBeInTheDocument()
    expect(within(rows[0]!).getByTestId('infinite-analysis-pv')).toHaveTextContent(
      '2…d6 3.d4 cxd4',
    )
    expect(within(rows[1]!).getByText('+0.21')).toBeInTheDocument()
    expect(within(rows[1]!).getByTestId('infinite-analysis-pv')).toHaveTextContent('2…Nc6 3.d4')
    // Mate wins over centipawns.
    expect(within(rows[2]!).getByText('M5')).toBeInTheDocument()
    expect(within(rows[2]!).getByTestId('infinite-analysis-pv')).toHaveTextContent('2…e6')
    // Each move is its own token, numbered within the line from 1.
    expect(token(rows[0]!, 1)).toHaveTextContent('d6')
    expect(token(rows[0]!, 3)).toHaveTextContent('cxd4')

    // The lines reach the panel already in White's frame (`streamModel`); the header keeps
    // identity/actions and runtime stats on two deliberate rows, without repeating turn.
    expect(screen.queryByText('black to move')).not.toBeInTheDocument()
    expect(screen.getByTestId('infinite-analysis-engine')).toHaveTextContent('stockfish')
    expect(screen.getByText('local')).toBeInTheDocument()
    const meta = screen.getByTestId('infinite-analysis-meta')
    expect(within(meta).getByText('d24')).toBeInTheDocument()
    expect(within(meta).getByText('18.4M nodes')).toBeInTheDocument()
    expect(within(meta).getByText('1.8M/s')).toBeInTheDocument()
    expect(screen.queryByTestId('infinite-analysis-pending')).not.toBeInTheDocument()
  })

  it('separates a browser engine from its repeated runner name', () => {
    render(
      <InfiniteAnalysisPanel
        stream={streamApi({
          enabled: true,
          phase: 'running',
          session: {
            ...SESSION,
            engine: 'Stockfish (Firefox on macOS)',
            runner_id: 3,
            runner: 'Firefox on macOS',
          },
          snapshot: SNAPSHOT,
        })}
        fen={SICILIAN}
        onHoverLine={vi.fn()}
      />,
    )

    const engine = screen.getByTestId('infinite-analysis-engine')
    const host = screen.getByTestId('infinite-analysis-host')
    expect(engine).toHaveTextContent(/^Stockfish$/)
    expect(engine.nextElementSibling).toBe(host)
    expect(
      within(screen.getByTestId('infinite-analysis-header')).getByText('Firefox on macOS'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('infinite-analysis-meta')).queryByText('Firefox on macOS'),
    ).not.toBeInTheDocument()
    // The preview controls are not in this header any more — they live on the run panel's
    // Stockfish card, so there is one place to change the preference rather than two.
    expect(
      within(screen.getByTestId('infinite-analysis-header')).queryByRole('button', {
        name: /line preview/i,
      }),
    ).not.toBeInTheDocument()
  })

  it('offers the hovered line’s first move, and takes it back on leaving', async () => {
    const onHoverMove = vi.fn()
    const onHoverLine = vi.fn()
    renderLines({ onHoverMove, onHoverLine })

    const rows = screen.getAllByTestId('infinite-analysis-line')
    await userEvent.hover(rows[1]!)
    // The second-best line, not the first: the arrow follows the pointer.
    expect(onHoverMove).toHaveBeenLastCalledWith('b8c6')
    // Both callbacks fire: the single arrow is what a surface without a preview draws.
    expect(onHoverLine).toHaveBeenLastCalledWith({
      line: 'live:2',
      ply: null,
      pv: ['b8c6', 'd2d4'],
    })
    await userEvent.unhover(rows[1]!)
    expect(onHoverMove).toHaveBeenLastCalledWith(null)
    expect(onHoverLine).toHaveBeenLastCalledWith(null)
  })

  it('names the ply under the pointer while scrubbing', async () => {
    const onHoverLine = vi.fn()
    renderLines({ onHoverLine })

    const rows = screen.getAllByTestId('infinite-analysis-line')
    await userEvent.hover(token(rows[0]!, 2))
    expect(onHoverLine).toHaveBeenLastCalledWith({ line: 'live:1', ply: 2, pv: TOP_PV })
    // Off the token but still in the row: the row's own answer stands again.
    await userEvent.unhover(token(rows[0]!, 2))
    expect(onHoverLine).toHaveBeenLastCalledWith(null)
  })

  it('leaves the tokens alone when scrubbing is off', async () => {
    setLinePreviewPrefs({ scrub: false })
    const onHoverLine = vi.fn()
    renderLines({ onHoverLine })

    const rows = screen.getAllByTestId('infinite-analysis-line')
    await userEvent.hover(token(rows[0]!, 2))
    // Only the row spoke; nothing scrubs, so a ply is not worth reporting.
    expect(onHoverLine).toHaveBeenCalledTimes(1)
    expect(onHoverLine).toHaveBeenLastCalledWith({ line: 'live:1', ply: null, pv: TOP_PV })
  })

  it('enters the line at the token that was clicked', async () => {
    const onPlayLine = vi.fn()
    renderLines({ onPlayLine })

    const rows = screen.getAllByTestId('infinite-analysis-line')
    // The third token is the third ply of the line, which is index 2 to `playLine`.
    await userEvent.click(token(rows[0]!, 3))
    expect(onPlayLine).toHaveBeenLastCalledWith(TOP_PV, 2)
  })

  it('steps the preview when the wheel turns over a row', async () => {
    const onStepPreview = vi.fn()
    renderLines({ onHoverLine: vi.fn(), onStepPreview })

    const rows = screen.getAllByTestId('infinite-analysis-line')
    // Nothing is hovered yet, so the wheel is the page's.
    fireEvent.wheel(rows[1]!, { deltaY: 24 })
    expect(onStepPreview).not.toHaveBeenCalled()

    await userEvent.hover(rows[1]!)
    fireEvent.wheel(rows[1]!, { deltaY: 24 })
    // Down is forwards, the way a move list reads.
    expect(onStepPreview).toHaveBeenCalledWith(1)
    fireEvent.wheel(rows[1]!, { deltaY: -24 })
    expect(onStepPreview).toHaveBeenLastCalledWith(-1)
  })

  it('marks how far the preview has walked into its own line', () => {
    renderLines({ onHoverLine: vi.fn(), previewLine: 'live:1', previewPly: 2 })

    const rows = screen.getAllByTestId('infinite-analysis-line')
    expect(token(rows[0]!, 1).className).toContain('text-faint-2')
    expect(token(rows[0]!, 2).className).toContain('text-accent-teal')
    expect(token(rows[0]!, 3).className).not.toContain('text-faint-2')
    // Another line is not where the preview stands, so its tokens say nothing.
    expect(token(rows[1]!, 1).className).not.toContain('text-faint-2')
  })

  it('carries no preview controls of its own', () => {
    renderLines({ onHoverLine: vi.fn() })

    // Neither the cycler nor the gear: both used to be duplicated here and on the run
    // panel, which meant two places to change one preference. `LinePreviewRowChip`'s own
    // test covers the cycling behaviour where it now lives.
    expect(screen.queryByRole('button', { name: /line preview/i })).not.toBeInTheDocument()
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
    const { container } = render(
      <InfiniteAnalysisPanel
        stream={streamApi({ enabled: true, phase: 'opening', multipv: 5 })}
        fen={SICILIAN}
      />,
    )
    expect(screen.getByTestId('infinite-analysis-pending')).toBeInTheDocument()
    expect(screen.queryAllByTestId('infinite-analysis-line')).toHaveLength(0)
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(5)
  })

  it('reserves one row for every selected line while a snapshot fills in', () => {
    const { container } = render(
      <InfiniteAnalysisPanel
        stream={streamApi({
          enabled: true,
          phase: 'running',
          session: SESSION,
          snapshot: { ...SNAPSHOT, lines: [SNAPSHOT.lines[0]!] },
          multipv: 3,
        })}
        fen={SICILIAN}
        ply={3}
      />,
    )

    expect(screen.getAllByTestId('infinite-analysis-line')).toHaveLength(1)
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2)
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

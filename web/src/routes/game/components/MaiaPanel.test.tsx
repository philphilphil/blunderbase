import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { GameRunSummary } from '@/lib/api/types'

import type {
  EngineLineView,
  HumanMoveView,
  MaiaComparisonColumn,
  MaiaLevelOption,
} from '../gameModel'
import { MaiaPanel } from './MaiaPanel'

/** The run the engine column speaks for, and what it spent getting there. */
const RUN: GameRunSummary = {
  id: 18,
  tier: 'deep',
  status: 'done',
  engine: 'stockfish',
  engine_kind: 'uci',
  depth: 20,
  nodes: 400_000,
  multipv: 3,
}

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

/** The same position where the blunder was actually played: the last row, marked. */
const PLAYED: EngineLineView[] = [
  ENGINE[0]!,
  {
    multipv: 2,
    score: { cp: -300 },
    text: '1…d5 2.exd5',
    sans: ['d5', 'exd5'],
    pv: ['d7d5', 'e4d5'],
    firstUci: 'd7d5',
    played: true,
    classification: 'blunder',
  },
]

describe('MaiaPanel', () => {
  it('puts the human distribution beside the engine’s own moves', () => {
    render(<MaiaPanel rating="1700" human={HUMAN} engine={ENGINE} run={RUN} ply={1} />)

    const panel = screen.getByTestId('maia-panel')
    expect(panel).toHaveTextContent('Maia 1700')
    expect(panel).toHaveTextContent('stockfish')
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

  it('names the run over the engine column, and what it spent', () => {
    render(<MaiaPanel rating="1700" human={HUMAN} engine={ENGINE} run={RUN} ply={1} />)

    const panel = screen.getByTestId('maia-panel')
    // The column label pairs with the human column's — the run's protocol kind stays on
    // the engines page.
    expect(within(panel).queryByText('uci')).not.toBeInTheDocument()
    expect(within(panel).getByText('d20')).toBeInTheDocument()
    expect(within(panel).getByText('400k nodes')).toBeInTheDocument()
    expect(within(panel).getByText('MPV 3')).toBeInTheDocument()
  })

  it('says so where no run has looked at the position', () => {
    render(<MaiaPanel rating="1700" human={HUMAN} engine={[]} ply={1} />)

    const panel = screen.getByTestId('maia-panel')
    expect(panel).toHaveTextContent('No engine run')
    expect(panel).toHaveTextContent('–')
  })

  it('shows the whole stored line, and hands it over whole with the move that was clicked', async () => {
    const onPlayLine = vi.fn()
    render(
      <MaiaPanel
        rating="1700"
        human={HUMAN}
        engine={ENGINE}
        run={RUN}
        ply={1}
        onPlayLine={onPlayLine}
      />,
    )

    // The line is inline, with nothing to expand: every move of it is on screen.
    expect(screen.queryByRole('button', { name: 'Show the line' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'd4' })).toBeInTheDocument()

    // Clicking the second move is an entry point, not a cut: the whole line goes over, with
    // the index the reader asked for, so the page keeps the tail to walk into.
    await userEvent.click(screen.getByRole('button', { name: 'd4' }))
    expect(onPlayLine).toHaveBeenLastCalledWith(['c7c6', 'd2d4', 'd7d5'], 1)

    await userEvent.click(screen.getByRole('button', { name: 'c6' }))
    expect(onPlayLine).toHaveBeenLastCalledWith(['c7c6', 'd2d4', 'd7d5'], 0)
  })

  it('hands a human row over as a one-move line', async () => {
    const onPlayLine = vi.fn()
    render(
      <MaiaPanel rating="1700" human={HUMAN} engine={[]} ply={1} onPlayLine={onPlayLine} />,
    )

    await userEvent.click(screen.getByTestId('maia-played-row'))
    expect(onPlayLine).toHaveBeenLastCalledWith(['d7d5'], 0)
  })

  it('offers the pointed-at line’s first move for the board, and clears it on leaving', async () => {
    const onHoverMove = vi.fn()
    render(
      <MaiaPanel
        rating="1700"
        human={HUMAN}
        engine={PLAYED}
        run={RUN}
        ply={1}
        onHoverMove={onHoverMove}
      />,
    )

    const row = screen.getByText('+0.40').closest('div')!
    await userEvent.hover(row)
    expect(onHoverMove).toHaveBeenLastCalledWith('c7c6')
    await userEvent.unhover(row)
    expect(onHoverMove).toHaveBeenLastCalledWith(null)

    // The played move is a line like any other — pointing at it shows what it does.
    await userEvent.hover(screen.getByTestId('engine-played-line'))
    expect(onHoverMove).toHaveBeenLastCalledWith('d7d5')
  })

  it('marks the played move as the last engine row, in the verdict’s colour', () => {
    render(<MaiaPanel rating="1700" human={HUMAN} engine={PLAYED} run={RUN} ply={1} />)

    const played = screen.getByTestId('engine-played-line')
    expect(played).toHaveTextContent('played')
    expect(played.style.background).toBe('color-mix(in srgb, var(--bb-blunder) 6%, transparent)')
    expect(within(played).getByText('−3.00').getAttribute('style')).toContain(
      'color-mix(in srgb, var(--bb-blunder) 13%, transparent)',
    )
  })

  it('leaves a played move the engine had nothing against in its neutral treatment', () => {
    const top: EngineLineView[] = [{ ...ENGINE[0]!, played: true, classification: 'best' }]
    render(<MaiaPanel rating="1700" human={HUMAN} engine={top} run={RUN} ply={1} />)

    // Playing the top line is not a warning, so the row is not painted as a verdict.
    const played = screen.getByTestId('engine-played-line')
    expect(played).not.toHaveAttribute('style')
    expect(within(played).getByText('+0.40')).toHaveClass('bg-cell-strong')
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

    // The whole rollout goes over, with the clicked index: the board lands after exd5 and
    // the rest of the continuation is still there to step through.
    await userEvent.click(within(rollout).getByRole('button', { name: 'exd5' }))
    expect(onPlayLine).toHaveBeenLastCalledWith(['d7d5', 'e4d5'], 1)
  })

  it('holds the card while a live query is in flight, rather than blinking out', () => {
    render(
      <MaiaPanel rating={null} human={[]} engine={[]} ply={1} live={{ rollout: [], pending: true }} />,
    )
    expect(screen.getByTestId('maia-panel')).toHaveTextContent('Reading this position…')
  })

  it('keeps the split but empties the human column where it is switched off', () => {
    render(
      <MaiaPanel
        rating="1700"
        human={HUMAN}
        showHuman={false}
        engine={ENGINE}
        run={RUN}
        ply={1}
      />,
    )

    // Hints off takes the human column's *content*, never its place in the box and never
    // what the run found.
    const panel = screen.getByTestId('maia-panel')
    expect(panel).toHaveTextContent('Maia 1700')
    expect(within(panel).queryByText('62%')).not.toBeInTheDocument()
    expect(within(panel).queryByText('No human model for this position.')).not.toBeInTheDocument()
    expect(panel).toHaveTextContent('stockfish')
    expect(within(panel).getByText('+0.40')).toBeInTheDocument()
  })
})

/** Three configured levels, one of which this position was never analysed at. */
const LEVELS: MaiaLevelOption[] = [
  { elo: 1100, available: true },
  { elo: 1500, available: false },
  { elo: 1700, available: true },
]

/** The same position read at two levels: popular below, barely considered above. */
const COMPARISON: MaiaComparisonColumn[] = [
  {
    rating: '1100',
    moves: [
      {
        uci: 'd7d5',
        san: 'd5',
        rank: 1,
        probability: 0.71,
        played: true,
        classification: 'blunder',
        loss: 26.3,
        multipv: null,
      },
      {
        uci: 'a7a6',
        san: 'a6',
        rank: 2,
        probability: 0.12,
        played: false,
        classification: null,
        loss: null,
        multipv: null,
      },
    ],
    played: {
      uci: 'd7d5',
      san: 'd5',
      rank: 1,
      probability: 0.71,
      played: true,
      classification: 'blunder',
      loss: 26.3,
      multipv: null,
    },
  },
  {
    rating: '1700',
    moves: [
      {
        uci: 'c7c6',
        san: 'c6',
        rank: 1,
        probability: 0.51,
        played: false,
        classification: 'best',
        loss: 0,
        multipv: 1,
      },
    ],
    played: {
      uci: 'd7d5',
      san: 'd5',
      rank: 6,
      probability: 0.03,
      played: true,
      classification: 'blunder',
      loss: 26.3,
      multipv: null,
    },
  },
]

describe('MaiaPanel level picker', () => {
  it('reads the level it is showing, and offers the others', () => {
    render(
      <MaiaPanel
        rating="1700"
        human={HUMAN}
        levels={LEVELS}
        onSelectLevel={vi.fn()}
        engine={ENGINE}
        ply={1}
      />,
    )

    // The label is still the reading of who this column speaks for; the switch is over it.
    expect(screen.getByTestId('maia-panel')).toHaveTextContent('Maia 1700')
    const picker = screen.getByLabelText('Maia level')
    expect(picker).toHaveValue('1700')
    // A configured level this position has no data at is offered, disabled, and says what
    // would fix it — hiding it would make a level the owner chose look impossible.
    const missing = within(picker).getByRole('option', { name: /1500 — re-analyse to add/ })
    expect(missing).toBeDisabled()
    expect(within(picker).getByRole('option', { name: '1100' })).toBeEnabled()
  })

  it('hands the picked level over as a number', async () => {
    const onSelectLevel = vi.fn()
    render(
      <MaiaPanel
        rating="1700"
        human={HUMAN}
        levels={LEVELS}
        onSelectLevel={onSelectLevel}
        engine={ENGINE}
        ply={1}
      />,
    )

    await userEvent.selectOptions(screen.getByLabelText('Maia level'), '1100')
    expect(onSelectLevel).toHaveBeenCalledWith(1100)
  })

  it('is plain text where there is nothing to switch between', () => {
    render(
      <MaiaPanel
        rating="1700"
        human={HUMAN}
        levels={[{ elo: 1700, available: true }]}
        onSelectLevel={vi.fn()}
        engine={ENGINE}
        ply={1}
      />,
    )
    expect(screen.queryByLabelText('Maia level')).not.toBeInTheDocument()
    expect(screen.getByTestId('maia-panel')).toHaveTextContent('Maia 1700')
  })
})

describe('MaiaPanel compare mode', () => {
  function draw(props: Partial<Parameters<typeof MaiaPanel>[0]> = {}) {
    return render(
      <MaiaPanel
        rating="1100"
        human={HUMAN}
        levels={LEVELS}
        onSelectLevel={vi.fn()}
        comparison={COMPARISON}
        onCompareChange={vi.fn()}
        engine={ENGINE}
        run={RUN}
        ply={1}
        {...props}
      />,
    )
  }

  it('offers the comparison only once there is more than one level to compare', () => {
    draw({ comparison: [COMPARISON[0]!] })
    expect(screen.queryByTestId('maia-compare-toggle')).not.toBeInTheDocument()
  })

  it('turns compare on through the header', async () => {
    const onCompareChange = vi.fn()
    draw({ onCompareChange })

    const toggle = screen.getByTestId('maia-compare-toggle')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(toggle)
    expect(onCompareChange).toHaveBeenCalledWith(true)
  })

  it('reads every level side by side, and gives the card over to it', () => {
    draw({ compare: true })

    const columns = screen.getAllByTestId('maia-compare-column')
    expect(columns.map((column) => column.dataset.rating)).toEqual(['1100', '1700'])
    expect(within(columns[0]!).getByText('d5')).toBeInTheDocument()
    expect(within(columns[0]!).getByText('71%')).toBeInTheDocument()
    expect(within(columns[1]!).getByText('c6')).toBeInTheDocument()

    // The engine column has stood down: the verdict it carries is in every column's
    // colour, and five columns in a quarter of the width would be five ellipses.
    expect(screen.queryByText('stockfish')).not.toBeInTheDocument()
    expect(screen.getByTestId('maia-compare-toggle')).toHaveAttribute('aria-pressed', 'true')
    // Nothing to switch to while every level is on screen at once.
    expect(screen.queryByLabelText('Maia level')).not.toBeInTheDocument()
  })

  it('puts the played move on the column that did not rank it, with its rank there', () => {
    draw({ compare: true })

    const columns = screen.getAllByTestId('maia-compare-column')
    // 1100 has it at the top of the list already — no second row for it.
    expect(within(columns[0]!).queryByTestId('maia-compare-played')).not.toBeInTheDocument()
    expect(within(columns[0]!).getByTestId('maia-compare-played-row')).toHaveTextContent('d5')

    // 1700 puts it sixth: that is the whole comparison, so it is on the column anyway.
    const trailing = within(columns[1]!).getByTestId('maia-compare-played')
    expect(trailing).toHaveTextContent('d5')
    expect(trailing).toHaveTextContent('6')
    expect(trailing).toHaveTextContent('3%')
    expect(within(trailing).getByText('d5')).toHaveClass('text-blunder')
  })

  it('walks a compared move onto the analysis board', async () => {
    const onPlayLine = vi.fn()
    draw({ compare: true, onPlayLine })

    await userEvent.click(screen.getByTitle('Play c6 on the analysis board'))
    expect(onPlayLine).toHaveBeenLastCalledWith(['c7c6'], 0)
  })

  it('keeps the two columns where the human half is switched off', () => {
    draw({ compare: true, showHuman: false })
    // Hints off is not a reason to lose the run's own findings, compare or not.
    expect(screen.queryByTestId('maia-compare')).not.toBeInTheDocument()
    expect(screen.getByText('stockfish')).toBeInTheDocument()
  })
})

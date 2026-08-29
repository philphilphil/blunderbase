import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { CoverageMaia } from '@/lib/api/types'

import { MaiaLevels } from './MaiaLevels'

function maia(overrides: Partial<CoverageMaia> = {}): CoverageMaia {
  return {
    configured: [1700],
    games_with_any: 0,
    per_level: [{ elo: 1700, games: 0 }],
    missing_games: 0,
    orphan_levels: [],
    ...overrides,
  }
}

/** The 113 levels the owner's library carries, almost all of them over a single game. */
function legacyOrphans() {
  return Array.from({ length: 113 }, (_, index) => ({
    elo: 1100 + index * 5,
    games: index < 49 ? 2 : 1,
  }))
}

describe('MaiaLevels', () => {
  it('shows the configured levels and how many games carry each', () => {
    render(
      <MaiaLevels
        maia={maia({
          configured: [1500, 1700],
          per_level: [
            { elo: 1500, games: 42 },
            { elo: 1700, games: 7 },
          ],
          missing_games: 300,
        })}
      />,
    )

    expect(screen.getByText('1500')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('300 missing a level')).toBeInTheDocument()
  })

  /**
   * The defect the summary exists to avoid: a library keyed to each game's own rating
   * carries a hundred-odd levels nobody asks about, and a row apiece would bury the card.
   */
  it('summarises the orphan levels rather than listing 113 rows', () => {
    const orphans = legacyOrphans()
    render(<MaiaLevels maia={maia({ orphan_levels: orphans })} />)

    // 49 levels over two games and 64 over one: 162 game-level pairs.
    expect(
      screen.getByRole('button', {
        name: '113 levels no longer configured, across 162 game-level pairs',
      }),
    ).toHaveAttribute('aria-expanded', 'false')
    // Not rendered rather than hidden — a hundred rows nobody asked for is a hundred rows.
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByText(/each game’s own rating/)).toBeInTheDocument()
  })

  it('shows the detail when it is asked for', async () => {
    render(<MaiaLevels maia={maia({ orphan_levels: legacyOrphans() })} />)

    await userEvent.click(screen.getByRole('button', { name: /no longer configured/ }))

    expect(screen.getAllByRole('listitem')).toHaveLength(113)
    expect(screen.getByText('1100 · 2')).toBeInTheDocument()
  })

  it('says nothing about orphans on a library that has none', () => {
    render(<MaiaLevels maia={maia({ missing_games: 0 })} />)

    expect(screen.queryByRole('button', { name: /no longer configured/ })).not.toBeInTheDocument()
    expect(screen.getByText('every analysed game has every level')).toBeInTheDocument()
  })
})

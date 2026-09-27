import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PageChromeProvider } from '@/components/shell/PageChrome'
import { setEngineHidden } from '@/lib/ui/engineVisibility'
import { ChromeActions } from '@/test/chrome'

import { DashboardPage } from './DashboardPage'

// The panels with their own tests and their own queries stand in as named placeholders:
// this file is about which sections the page draws and in what order.
vi.mock('./RatingCard', () => ({ RatingCard: () => <section>rating-card</section> }))
vi.mock('./QueueCard', () => ({ QueueCard: () => <section>queue-card</section> }))
vi.mock('./TrendsCard', () => ({ TrendsCard: () => <section>trends-card</section> }))
vi.mock('./SyncAllButton', () => ({ SyncAllButton: () => <button type="button">Sync all</button> }))

const useWorstMoments = vi.hoisted(() => vi.fn())
const useGameCards = vi.hoisted(() => vi.fn())
const useProfile = vi.hoisted(() => vi.fn())
const useStats = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/queries', () => ({ useWorstMoments, useGameCards, useProfile, useStats }))

function pending() {
  return {
    data: undefined,
    error: null,
    isPending: true,
    isSuccess: false,
    isError: false,
    refetch: vi.fn(),
  }
}

function draw() {
  return render(
    <PageChromeProvider>
      <MemoryRouter>
        <DashboardPage />
        <ChromeActions />
      </MemoryRouter>
    </PageChromeProvider>,
  )
}

beforeEach(() => {
  for (const hook of [useWorstMoments, useGameCards, useProfile, useStats]) {
    hook.mockReset()
    hook.mockReturnValue(pending())
  }
})

afterEach(() => setEngineHidden(false))

describe('DashboardPage — layout', () => {
  it('leads the main column with the ratings, then the worst moments', () => {
    draw()
    const rating = screen.getByText('rating-card')
    const worst = screen.getByRole('heading', { name: 'Worst recent moments' })
    expect(rating.compareDocumentPosition(worst) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('puts Import PGN beside Sync all as a standard tool button', () => {
    draw()
    const link = screen.getByRole('link', { name: 'Import PGN' })
    expect(link).toHaveAttribute('href', '/library/import')
    expect(link).toHaveClass('h-7')
  })

  it('takes the worst moments off the page while the engine is hidden, and nothing else', () => {
    setEngineHidden(true)
    draw()

    expect(screen.queryByRole('heading', { name: 'Worst recent moments' })).not.toBeInTheDocument()
    expect(useWorstMoments).not.toHaveBeenCalled()
    expect(screen.getByText('rating-card')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Recent games' })).toBeInTheDocument()
    expect(screen.getByText('queue-card')).toBeInTheDocument()
    expect(screen.getByText('trends-card')).toBeInTheDocument()
  })
})

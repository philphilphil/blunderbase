import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UseQueryResult } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImportJob } from '@/lib/api/types'

import { SyncAllButton, syncTargets } from './SyncAllButton'

const useImportJobs = vi.hoisted(() => vi.fn())
const useStartImport = vi.hoisted(() => vi.fn())
const useImportProgress = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api/queries', () => ({ useImportJobs, useStartImport }))
vi.mock('@/routes/import/useImportProgress', () => ({ useImportProgress }))

function job(over: Partial<ImportJob> & Pick<ImportJob, 'id' | 'source'>): ImportJob {
  return {
    status: 'done',
    created_at: '2026-08-20T10:00:00Z',
    finished_at: '2026-08-20T10:04:00Z',
    games_seen: 10,
    games_imported: 8,
    games_skipped: 2,
    games_failed: 0,
    errors: [],
    message: 'phib',
    ...over,
  }
}

function jobs(state: Partial<UseQueryResult<ImportJob[], Error>>) {
  return {
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...state,
  }
}

const mutateAsync = vi.fn()

function draw(
  jobsState: Partial<UseQueryResult<ImportJob[], Error>>,
  progress: Record<string, unknown> = {},
) {
  useImportJobs.mockReturnValue(jobs(jobsState))
  useImportProgress.mockReturnValue(progress)
  useStartImport.mockReturnValue({ mutateAsync })
  return render(
    <MemoryRouter>
      <SyncAllButton />
    </MemoryRouter>,
  )
}

describe('syncTargets — which accounts a press should re-sync', () => {
  it('takes the username off the newest job that finished cleanly', () => {
    expect(
      syncTargets([
        job({ id: 1, source: 'lichess', message: 'old_name', finished_at: '2026-01-01T00:00:00Z' }),
        job({ id: 2, source: 'lichess', message: 'phib', finished_at: '2026-08-01T00:00:00Z' }),
      ]),
    ).toEqual([{ source: 'lichess', username: 'phib' }])
  })

  it('never seeds from a failed job, whose message is the exception text', () => {
    expect(
      syncTargets([job({ id: 3, source: 'lichess', status: 'failed', message: 'AdapterError: 404' })]),
    ).toEqual([])
  })

  it('ignores sources a sync cannot be started for', () => {
    expect(syncTargets([job({ id: 4, source: 'pgn', message: 'export.pgn' })])).toEqual([])
  })

  it('returns one target per source, lichess first', () => {
    expect(
      syncTargets([
        job({ id: 5, source: 'chesscom', message: 'phib_cc' }),
        job({ id: 6, source: 'lichess', message: 'phib' }),
      ]),
    ).toEqual([
      { source: 'lichess', username: 'phib' },
      { source: 'chesscom', username: 'phib_cc' },
    ])
  })
})

describe('SyncAllButton', () => {
  beforeEach(() => {
    useImportJobs.mockReset()
    useStartImport.mockReset()
    useImportProgress.mockReset()
    mutateAsync.mockReset()
    mutateAsync.mockResolvedValue({ source: 'lichess', status: 'queued' })
  })

  it('links to the import page when nothing has ever synced', () => {
    draw({ data: [] })
    expect(screen.getByRole('link', { name: /connect account/i })).toHaveAttribute('href', '/library/import')
  })

  it('starts one import per previously synced account', async () => {
    draw({
      data: [
        job({ id: 1, source: 'lichess', message: 'phib' }),
        job({ id: 2, source: 'chesscom', message: 'phib_cc' }),
      ],
    })

    await userEvent.click(screen.getByRole('button', { name: /sync all/i }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2))
    expect(mutateAsync).toHaveBeenCalledWith({ source: 'lichess', body: { username: 'phib' } })
    expect(mutateAsync).toHaveBeenCalledWith({ source: 'chesscom', body: { username: 'phib_cc' } })
  })

  it('reads as syncing, and refuses a second press, while /events says a job is running', () => {
    draw({ data: [job({ id: 1, source: 'lichess', message: 'phib' })] }, { lichess: { running: true } })

    const button = screen.getByRole('button', { name: /syncing/i })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('shows why a sync did not start', async () => {
    mutateAsync.mockRejectedValue(new Error('lichess said no'))
    draw({ data: [job({ id: 1, source: 'lichess', message: 'phib' })] })

    await userEvent.click(screen.getByRole('button', { name: /sync all/i }))

    expect(await screen.findByText('lichess said no')).toBeInTheDocument()
  })
})

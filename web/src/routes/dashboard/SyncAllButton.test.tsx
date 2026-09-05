import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UseQueryResult } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImportJob, ImportJobList } from '@/lib/api/types'

import { SyncAllButton, syncTargets } from './SyncAllButton'

const useSyncSchedule = vi.hoisted(() => vi.fn(() => ({ data: { minutes: null, disabled_sources: [] as string[] } })))
const useImportJobs = vi.hoisted(() => vi.fn())
const useStartImport = vi.hoisted(() => vi.fn())
const useImportProgress = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api/queries', () => ({ useImportJobs, useStartImport, useSyncSchedule }))
vi.mock('@/routes/import/useImportProgress', () => ({ useImportProgress }))

function job(over: Partial<ImportJob> & Pick<ImportJob, 'id' | 'source'>): ImportJob {
  return {
    status: 'done',
    created_at: '2026-08-20T10:00:00Z',
    finished_at: '2026-08-20T10:04:00Z',
    games_seen: 10,
    games_imported: 8,
    games_skipped: 2,
    games_blocked: 0,
    games_failed: 0,
    errors: [],
    message: 'phib',
    ...over,
  }
}

/** `/import/jobs` answers with a page of the history, not a bare array. */
function page(rows: ImportJob[]): ImportJobList {
  return { jobs: rows, total: rows.length, limit: 25, offset: 0 }
}

function jobs(state: Partial<UseQueryResult<ImportJobList, Error>>) {
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
  jobsState: Partial<UseQueryResult<ImportJobList, Error>>,
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

  it('returns one target per source in platform order', () => {
    expect(
      syncTargets([
        job({ id: 5, source: 'chesscom', message: 'phib_cc' }),
        job({ id: 6, source: 'lichess', message: 'phib' }),
        job({ id: 7, source: 'fics', message: 'phib_fics' }),
      ]),
    ).toEqual([
      { source: 'lichess', username: 'phib' },
      { source: 'chesscom', username: 'phib_cc' },
      { source: 'fics', username: 'phib_fics' },
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
    draw({ data: page([]) })
    expect(screen.getByRole('link', { name: /connect account/i })).toHaveAttribute('href', '/library/import')
  })

  it('starts one import per previously synced account', async () => {
    draw({
      data: page([
        job({ id: 1, source: 'lichess', message: 'phib' }),
        job({ id: 2, source: 'chesscom', message: 'phib_cc' }),
      ]),
    })

    await userEvent.click(screen.getByRole('button', { name: /sync all/i }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2))
    expect(mutateAsync).toHaveBeenCalledWith({ source: 'lichess', body: { username: 'phib' } })
    expect(mutateAsync).toHaveBeenCalledWith({ source: 'chesscom', body: { username: 'phib_cc' } })
  })

  it('reads as syncing, and refuses a second press, while /events says a job is running', () => {
    draw({ data: page([job({ id: 1, source: 'lichess', message: 'phib' })]) }, { lichess: { running: true } })

    const button = screen.getByRole('button', { name: /syncing/i })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('shows why a sync did not start', async () => {
    mutateAsync.mockRejectedValue(new Error('lichess said no'))
    draw({ data: page([job({ id: 1, source: 'lichess', message: 'phib' })]) })

    await userEvent.click(screen.getByRole('button', { name: /sync all/i }))

    expect(await screen.findByText('lichess said no')).toBeInTheDocument()
  })
})


it('skips disabled sources when syncing all', async () => {
  mutateAsync.mockClear()
  mutateAsync.mockResolvedValue({})
  useSyncSchedule.mockReturnValue({ data: { minutes: null, disabled_sources: ['fics'] } })
  draw({ data: page([job({ id: 1, source: 'lichess' }), job({ id: 2, source: 'fics' })]) })
  await userEvent.click(screen.getByRole('button', { name: /Sync all/i }))
  await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ source: 'lichess', body: { username: 'phib' } }))
  expect(mutateAsync.mock.calls.some(([request]) => request.source === 'fics')).toBe(false)
})

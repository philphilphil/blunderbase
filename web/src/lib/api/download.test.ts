/**
 * The two things about a download that are not just another `request()`: the filename the
 * backend chose, and a failure that has to stay a failure rather than becoming a file.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiUrl, ApiError, requestDownload } from './client'
import { exportNotes, exportNotesUrl } from './endpoints'

function answer(body: string, headers: Record<string, string>): Response {
  return new Response(body, { status: 200, headers })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiUrl', () => {
  it('builds a path under the API base, with the query encoded the way requests are', () => {
    expect(apiUrl('/notes/export', { format: 'md', tags: ['pattern', 'endgame'] })).toBe(
      '/api/notes/export?format=md&tags=pattern&tags=endgame',
    )
  })

  it('leaves out what was not set, so an untouched filter is not a filter', () => {
    expect(apiUrl('/notes/export', { format: 'md', game_id: undefined, fen: '' })).toBe(
      '/api/notes/export?format=md',
    )
  })
})

describe('exportNotesUrl', () => {
  it('carries the same filters the listing takes', () => {
    const url = exportNotesUrl('pgn', { scope: 'line', game_id: 7, has_position: true })
    expect(url).toBe('/api/notes/export?scope=line&game_id=7&has_position=true&format=pgn')
  })
})

describe('requestDownload', () => {
  it('takes the filename the backend named in content-disposition', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        answer('# notes', {
          'content-type': 'text/markdown; charset=utf-8',
          'content-disposition': 'attachment; filename="blunderbase-notes.md"',
        }),
      ),
    )
    const download = await exportNotes('md', { tags: ['pattern'] })
    expect(download.filename).toBe('blunderbase-notes.md')
    expect(download.mediaType).toContain('text/markdown')
    expect(await download.blob.text()).toBe('# notes')
  })

  it('falls back to a name of its own when the answer names none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer('[Event "?"]', {})))
    expect((await exportNotes('pgn')).filename).toBe('blunderbase-notes.pgn')
  })

  it('throws the backend error rather than handing back an error page as a file', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'invalid_request', detail: 'unknown format' }), {
            status: 422,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    await expect(requestDownload('/notes/export')).rejects.toBeInstanceOf(ApiError)
  })
})

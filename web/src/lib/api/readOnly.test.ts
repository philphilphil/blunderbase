import { afterEach, describe, expect, it, vi } from 'vitest'

import { http } from './client'
import { onWriteRefused } from './readOnly'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a write the demo refuses', () => {
  it('is reported once to the shell and still thrown to the caller', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(403, { error: 'read_only', detail: 'this is the read-only demo' })),
    )
    const heard = vi.fn()
    const stop = onWriteRefused(heard)

    await expect(http.post('/notes', { body: { text: 'x' } })).rejects.toMatchObject({
      status: 403,
      error: 'read_only',
    })

    expect(heard).toHaveBeenCalledTimes(1)
    stop()
  })

  it('is not what any other 403 is', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(403, { error: 'forbidden', detail: 'not yours' })),
    )
    const heard = vi.fn()
    const stop = onWriteRefused(heard)

    await expect(http.post('/notes', { body: { text: 'x' } })).rejects.toBeTruthy()

    expect(heard).not.toHaveBeenCalled()
    stop()
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { I18nProvider } from '@/lib/i18n/I18nProvider'
import type { CorrespondenceStatus } from '@/lib/api/types'

import { CapacityStrip, formatMemory, parkedMegabytes } from './CapacityStrip'

function status(patch: Partial<CorrespondenceStatus> = {}): CorrespondenceStatus {
  return {
    slots: 2,
    in_use: 0,
    queued: 0,
    paused: 0,
    parked: [],
    hosts: [{ runner_id: null, host: 'this host', slots: 2, in_use: 0, parked: 0 }],
    engines: [],
    ...patch,
  } as CorrespondenceStatus
}

function draw(value: CorrespondenceStatus | undefined) {
  return render(
    <I18nProvider>
      <CapacityStrip status={value} />
    </I18nProvider>,
  )
}

describe('the capacity strip', () => {
  it('counts the warm processes, with what they hold', () => {
    draw(
      status({
        in_use: 1,
        paused: 1,
        parked: [
          { search_id: 8, node_id: 4, engine_id: 1, engine_name: 'Stockfish 17', hash_mb: 8192 },
        ],
      }),
    )
    const strip = screen.getByTestId('correspondence-capacity')
    expect(strip).toHaveTextContent('1 engine parked')
    expect(strip).toHaveTextContent('8 GB')
  })

  it('says nothing is parked when every paused search is cold', () => {
    // What a restart leaves behind: three paused rows and no process anywhere. Counting
    // the rows would charge the owner for memory nothing is holding, and the strip is the
    // one place they decide that parked has become too much.
    draw(status({ paused: 3, parked: [] }))
    const strip = screen.getByTestId('correspondence-capacity')
    expect(strip).not.toHaveTextContent(/parked/)
    // Nor is it an empty installation: three searches are waiting to be resumed.
    expect(strip).not.toHaveTextContent(/Nothing is searching/)
  })

  it('adds up only the hashes it was given', () => {
    expect(
      parkedMegabytes(
        status({
          parked: [
            { search_id: 1, node_id: 1, engine_id: 1, engine_name: 'A', hash_mb: 4096 },
            { search_id: 2, node_id: 2, engine_id: 2, engine_name: 'B', hash_mb: null },
          ],
        }),
      ),
    ).toBe(4096)
    expect(parkedMegabytes(status())).toBeNull()
    expect(formatMemory(512)).toBe('512 MB')
    expect(formatMemory(1536)).toBe('1.5 GB')
  })
})

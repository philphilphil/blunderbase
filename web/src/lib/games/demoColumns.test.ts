import { afterEach, describe, expect, it, vi } from 'vitest'

import { GAME_COLUMNS_KEY, readLocalColumns, writeLocalColumns } from './demoColumns'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.removeItem(GAME_COLUMNS_KEY)
})

describe('the local copy of the column choice', () => {
  it('reads back what was written', () => {
    writeLocalColumns({ order: ['white', 'date', 'later_column'], hidden: ['date'] })
    expect(readLocalColumns()).toEqual({ order: ['white', 'date', 'later_column'], hidden: ['date'] })
  })

  it('has nothing to read before anything is written', () => {
    expect(readLocalColumns()).toBeNull()
  })

  it('removes the copy for null and for the default', () => {
    writeLocalColumns({ order: ['white'], hidden: [] })
    writeLocalColumns(null)
    expect(localStorage.getItem(GAME_COLUMNS_KEY)).toBeNull()
    writeLocalColumns({ order: ['white'], hidden: [] })
    writeLocalColumns({ order: [], hidden: [] })
    expect(localStorage.getItem(GAME_COLUMNS_KEY)).toBeNull()
  })

  it('reads a value that is not JSON, or not the right shape, as nothing', () => {
    for (const raw of ['{not json', '"white"', '["white"]', '{"order": "white"}', '{"order": [1]}', 'null']) {
      localStorage.setItem(GAME_COLUMNS_KEY, raw)
      expect(readLocalColumns(), raw).toBeNull()
    }
    // A bad hidden list alone costs only the hidden list.
    localStorage.setItem(GAME_COLUMNS_KEY, '{"order": ["white"], "hidden": "white"}')
    expect(readLocalColumns()).toEqual({ order: ['white'], hidden: [] })
  })

  it('survives a browser that will not store anything', () => {
    const refusing = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
    }
    vi.stubGlobal('localStorage', refusing)
    expect(() => writeLocalColumns({ order: ['white'], hidden: [] })).not.toThrow()
    expect(() => writeLocalColumns(null)).not.toThrow()
    expect(readLocalColumns()).toBeNull()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_KEY,
  pageRange,
  readPageSize,
  resolvePageSize,
  writePageSize,
} from './paging'

describe('resolvePageSize', () => {
  it('spends the measured row count for "fit" and the number itself otherwise', () => {
    expect(resolvePageSize('fit', 18)).toBe(18)
    expect(resolvePageSize(50, 18)).toBe(50)
  })

  it('never asks for a page of nothing, however small the window got', () => {
    expect(resolvePageSize('fit', 0)).toBe(1)
  })
})

describe('pageRange', () => {
  it('names the slice of the library this page is', () => {
    expect(pageRange(1, 25, 25, 120)).toEqual({ first: 1, last: 25 })
    expect(pageRange(3, 25, 25, 120)).toEqual({ first: 51, last: 75 })
  })

  it('reads the short last page off what actually came back', () => {
    expect(pageRange(5, 25, 20, 120)).toEqual({ first: 101, last: 120 })
  })

  it('starts at nothing rather than at one when the library is empty', () => {
    expect(pageRange(1, 25, 0, 0)).toEqual({ first: 0, last: 0 })
  })
})

describe('the stored page size', () => {
  /** jsdom in this setup exposes no `localStorage`, so the test brings its own. */
  beforeEach(() => {
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      get length() {
        return map.size
      },
      key: (index: number) => [...map.keys()][index] ?? null,
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, String(value)),
      removeItem: (key: string) => void map.delete(key),
      clear: () => map.clear(),
    } satisfies Storage)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('falls back to the default for an empty or nonsense store', () => {
    expect(readPageSize()).toBe(DEFAULT_PAGE_SIZE)
    localStorage.setItem(PAGE_SIZE_KEY, '37')
    expect(readPageSize()).toBe(DEFAULT_PAGE_SIZE)
  })

  it('round-trips a choice the footer offers', () => {
    writePageSize(100)
    expect(readPageSize()).toBe(100)
    writePageSize('fit')
    expect(readPageSize()).toBe('fit')
  })
})

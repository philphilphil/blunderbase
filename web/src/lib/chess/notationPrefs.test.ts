import { renderHook } from '@testing-library/react'
import { i18n } from '@lingui/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  NOTATION_DEFAULTS,
  NOTATION_KEY,
  getNotationPrefs,
  resetNotationPrefs,
  setNotationPrefs,
  useNotation,
} from './notationPrefs'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  resetNotationPrefs()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetNotationPrefs()
  i18n.loadAndActivate({ locale: 'en', messages: {} })
})

describe('notationPrefs', () => {
  // Letters in the UI's language, which is the one choice that is not a choice: nobody has
  // to find a setting to stop reading `Nc3` in a German app.
  it('follows the language until someone says otherwise', () => {
    expect(NOTATION_DEFAULTS).toEqual({ style: 'local' })
    expect(getNotationPrefs()).toEqual(NOTATION_DEFAULTS)
    expect(window.localStorage.getItem(NOTATION_KEY)).toBeNull()
  })

  it('writes the style straight through', () => {
    setNotationPrefs({ style: 'figurines' })
    expect(JSON.parse(window.localStorage.getItem(NOTATION_KEY) ?? '{}')).toEqual({
      style: 'figurines',
    })
  })

  it.each([['"figurines"'], ['{"style":"runes"}'], ['{"style":7}'], ['not json']])(
    'falls back to the default for %s',
    (stored) => {
      window.localStorage.setItem(NOTATION_KEY, stored)
      resetNotationPrefs()
      expect(getNotationPrefs()).toEqual(NOTATION_DEFAULTS)
    },
  )
})

describe('useNotation', () => {
  it('writes the letters of the active language, and figurines when asked', () => {
    i18n.loadAndActivate({ locale: 'de', messages: {} })
    const { result, rerender } = renderHook(() => useNotation())
    expect(result.current('Nf3')).toBe('Sf3')

    setNotationPrefs({ style: 'english' })
    rerender()
    expect(result.current('Nf3')).toBe('Nf3')

    setNotationPrefs({ style: 'figurines' })
    rerender()
    expect(result.current('Nf3')).toBe('♞f3')
  })
})

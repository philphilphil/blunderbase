import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  EVAL_GRAPH_DEFAULTS,
  EVAL_GRAPH_KEY,
  resetEvalGraphPrefs,
  setEvalGraphPrefs,
} from './evalGraphPrefs'

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
  resetEvalGraphPrefs()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetEvalGraphPrefs()
})

describe('evalGraphPrefs', () => {
  it('draws bars with glyph marks until someone says otherwise', () => {
    expect(EVAL_GRAPH_DEFAULTS).toEqual({ style: 'bars', marks: 'glyphs' })
  })

  it('writes the chosen shape straight through', () => {
    setEvalGraphPrefs({ style: 'area' })
    setEvalGraphPrefs({ marks: 'none' })
    expect(JSON.parse(window.localStorage.getItem(EVAL_GRAPH_KEY) ?? '{}')).toEqual({
      style: 'area',
      marks: 'none',
    })
  })

  // A hand-edited or stale entry names a shape this build does not draw. That is the
  // default's job, not a crash's and not a blank pane's.
  it.each([['"bars"'], ['{"style":"sparkline"}'], ['{"style":7,"marks":"pills"}'], ['not json']])(
    'falls back to the default for %s',
    (stored) => {
      window.localStorage.setItem(EVAL_GRAPH_KEY, stored)
      resetEvalGraphPrefs()
      setEvalGraphPrefs({})
      expect(JSON.parse(window.localStorage.getItem(EVAL_GRAPH_KEY) ?? '{}')).toEqual({
        style: 'bars',
        marks: 'glyphs',
      })
    },
  )
})

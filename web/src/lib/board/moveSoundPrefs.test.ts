import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MOVE_SOUND_DEFAULTS,
  MOVE_SOUND_KEY,
  getMoveSoundPrefs,
  resetMoveSoundPrefs,
  setMoveSoundPrefs,
} from './moveSoundPrefs'

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
  resetMoveSoundPrefs()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetMoveSoundPrefs()
})

describe('moveSoundPrefs', () => {
  // On by default is only defensible because a browser will not make a sound before it has
  // been clicked or typed into, and the only thing that plays one here is a click or a key.
  it('clicks at a middling level until someone says otherwise', () => {
    expect(MOVE_SOUND_DEFAULTS).toEqual({ enabled: true, volume: 60 })
    expect(getMoveSoundPrefs()).toEqual(MOVE_SOUND_DEFAULTS)
    expect(window.localStorage.getItem(MOVE_SOUND_KEY)).toBeNull()
  })

  it('writes the switch and the level straight through', () => {
    setMoveSoundPrefs({ enabled: false })
    setMoveSoundPrefs({ volume: 85 })
    expect(JSON.parse(window.localStorage.getItem(MOVE_SOUND_KEY) ?? '{}')).toEqual({
      enabled: false,
      volume: 85,
    })
  })

  // Silence is a legal place to leave the slider, and is not the same thing as the switch:
  // the sound stays on and comes back at whatever the slider is dragged to next.
  it('keeps a slider dragged to nothing', () => {
    setMoveSoundPrefs({ volume: 0 })
    expect(getMoveSoundPrefs()).toEqual({ enabled: true, volume: 0 })
  })

  // A hand-edited entry, or one from a build whose slider had a different range.
  it.each([
    [-40, 0],
    [1000, 100],
    [42.6, 43],
  ])('clamps a stored %s to %s', (stored, expected) => {
    window.localStorage.setItem(MOVE_SOUND_KEY, JSON.stringify({ volume: stored }))
    resetMoveSoundPrefs()
    expect(getMoveSoundPrefs().volume).toBe(expected)
  })

  it.each([['"loud"'], ['{"volume":"deafening"}'], ['{"enabled":"yes"}'], ['not json']])(
    'falls back to the default for %s',
    (stored) => {
      window.localStorage.setItem(MOVE_SOUND_KEY, stored)
      resetMoveSoundPrefs()
      expect(getMoveSoundPrefs()).toEqual(MOVE_SOUND_DEFAULTS)
    },
  )
})

import { describe, expect, it } from 'vitest'

import {
  BOARD_KEYS,
  BOARD_SHORTCUTS,
  chordOf,
  SHORTCUT_GROUPS,
  shortcutsFor,
  type BoardAction,
} from './shortcuts'

describe('the shortcut table', () => {
  it('gives every board shortcut something to press and something to print', () => {
    for (const shortcut of BOARD_SHORTCUTS) {
      expect(shortcut.press.length).toBeGreaterThan(0)
      expect(shortcut.keys.length).toBeGreaterThan(0)
      expect(shortcut.label.message).not.toBe('')
    }
  })

  it('never binds one key to two actions', () => {
    const seen = new Map<string, BoardAction>()
    for (const shortcut of BOARD_SHORTCUTS) {
      for (const key of shortcut.press) {
        expect(seen.get(key)).toBeUndefined()
        seen.set(key, shortcut.action)
      }
    }
    // Which is exactly what the dispatch map is, so nothing was lost building it.
    expect(BOARD_KEYS.size).toBe(seen.size)
  })

  it('keeps a shifted keystroke apart from the plain one', () => {
    expect(BOARD_KEYS.get('ArrowLeft')).toBe('step-back')
    expect(BOARD_KEYS.get('shift+ArrowLeft')).toBe('jump-back')
  })

  it('jumps between flagged moves without asking for Shift either way', () => {
    // A jump backwards is worth as little effort as a jump forwards.
    expect(BOARD_KEYS.get(',')).toBe('previous-flagged')
    expect(BOARD_KEYS.get('.')).toBe('next-flagged')
    expect(BOARD_KEYS.get('ArrowUp')).toBe('previous-flagged')
    expect(BOARD_KEYS.get('ArrowDown')).toBe('next-flagged')
  })

  it('spells a keystroke the way the table spells one', () => {
    // A plain object rather than a real event: this file runs without a DOM, and the two
    // fields `chordOf` reads are the whole of what it needs.
    const chord = (init: { key: string; shiftKey?: boolean }) =>
      chordOf({ shiftKey: false, ...init } as KeyboardEvent)
    expect(chord({ key: 'ArrowLeft' })).toBe('ArrowLeft')
    expect(chord({ key: 'ArrowLeft', shiftKey: true })).toBe('shift+ArrowLeft')
    // The browser has already folded Shift into the letter; the prefix goes on anyway, so
    // one spelling covers both kinds of key.
    expect(chord({ key: 'J', shiftKey: true })).toBe('shift+J')
  })

  it('describes each group once', () => {
    const names = SHORTCUT_GROUPS.map((group) => group.name.message)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('shortcutsFor', () => {
  // The names are message descriptors now; what a reader sees is the source text on each.
  const names = (pathname: string) =>
    shortcutsFor(pathname).map((group) => group.name.message)

  it('prints the global group on any screen', () => {
    expect(names('/stats')).toEqual(['Anywhere'])
  })

  it('adds the board keys, in sections, on a game and on a model game', () => {
    // Three headings rather than one list of two dozen keys — see `BoardSection`.
    expect(names('/games/12')).toEqual([
      'Anywhere',
      'Moving about the game',
      'The board',
      'The game itself',
    ])
    expect(names('/reference/masters/abc')).toContain('The board')
  })

  it('does not mistake the library index for a game', () => {
    expect(names('/games')).toEqual(['Anywhere', 'The library table'])
    expect(names('/games')).not.toContain('The board')
  })

  it('adds the line-walking keys in the explorer and the repertoire', () => {
    expect(names('/explorer')).toContain('Walking a line')
    expect(names('/repertoire')).toContain('Walking a line')
  })
})

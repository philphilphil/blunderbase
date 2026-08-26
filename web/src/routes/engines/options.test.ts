import { describe, expect, it } from 'vitest'

import type { ProbeResponse } from '@/lib/api/types'

import {
  declaredOptions,
  draftFrom,
  isEditable,
  normalizeDefault,
  optionError,
  parseOption,
  resolveDraft,
  toDeclared,
} from './options'

/**
 * The shape `POST /engines/probe` really answers with, verified against Stockfish 18.
 *
 * Cast because the wire sends `null` for an option's `min`/`max`/`default` where the
 * shared `ProbeOption` type says `number | undefined` — this is the payload, nulls and
 * all, which is precisely what the parsing here has to survive.
 */
const PROBE = {
  name: 'Stockfish 18',
  author: 'the Stockfish developers (see AUTHORS file)',
  options: [
    { name: 'Threads', type: 'spin', default: 1, min: 1, max: 1024, var: [], managed: false },
    { name: 'Hash', type: 'spin', default: 16, min: 1, max: 33554432, var: [], managed: false },
    { name: 'Ponder', type: 'check', default: false, min: null, max: null, var: [], managed: true },
    { name: 'MultiPV', type: 'spin', default: 1, min: 1, max: 256, var: [], managed: true },
    {
      name: 'SyzygyPath',
      type: 'string',
      default: '<empty>',
      min: null,
      max: null,
      var: [],
      managed: false,
    },
    {
      name: 'Syzygy50MoveRule',
      type: 'check',
      default: true,
      min: null,
      max: null,
      var: [],
      managed: false,
    },
    {
      name: 'Style',
      type: 'combo',
      default: 'normal',
      min: null,
      max: null,
      var: ['normal', 'risky'],
      managed: false,
    },
    {
      name: 'Clear Hash',
      type: 'button',
      default: null,
      min: null,
      max: null,
      var: [],
      managed: false,
    },
  ],
} as unknown as ProbeResponse

const declared = declaredOptions(PROBE)
const option = (name: string) => declared.find((entry) => entry.name === name)!

describe('declaredOptions', () => {
  it('reads every option the binary declared', () => {
    expect(declared.map((entry) => entry.name)).toContain('Threads')
    expect(option('Threads')).toMatchObject({ type: 'spin', min: 1, max: 1024, default: '1' })
  })

  it("turns UCI's <empty> into an empty default", () => {
    expect(option('SyzygyPath').default).toBe('')
    expect(normalizeDefault('<empty>')).toBe('')
    expect(normalizeDefault(true)).toBe('true')
  })

  it('reads the choices from the wire key `var`, which is the only one sent', () => {
    expect(option('Style').choices).toEqual(['normal', 'risky'])
    expect(toDeclared({ name: 'X', type: 'combo', var: ['a'] }).choices).toEqual(['a'])
    expect(toDeclared({ name: 'X', type: 'combo' }).choices).toEqual([])
  })

  it('marks the options the engine driver sets per analysis as not editable', () => {
    expect(isEditable(option('MultiPV'))).toBe(false)
    expect(isEditable(option('Clear Hash'))).toBe(false)
    expect(isEditable(option('Threads'))).toBe(true)
  })
})

describe('optionError', () => {
  it('accepts an empty field — that is the engine default, not a value', () => {
    expect(optionError(option('Threads'), '')).toBeNull()
    expect(optionError(option('MultiPV'), '')).toBeNull()
  })

  it('holds a spin to its declared range', () => {
    expect(optionError(option('Threads'), '8')).toBeNull()
    expect(optionError(option('Threads'), '0')).toBe('at least 1')
    expect(optionError(option('Threads'), '2048')).toBe('at most 1024')
    expect(optionError(option('Threads'), '1.5')).toBe('has to be a whole number')
  })

  it('holds a combo to its declared choices', () => {
    expect(optionError(option('Style'), 'risky')).toBeNull()
    expect(optionError(option('Style'), 'wild')).toBe('one of normal, risky')
  })

  it('refuses a value for an option the driver manages', () => {
    expect(optionError(option('MultiPV'), '4')).toBe('set per analysis — it cannot be stored')
    expect(optionError(option('Clear Hash'), 'go')).toBe('a button is an action, not a stored value')
  })

  it('takes only true or false for a check', () => {
    expect(optionError(option('Syzygy50MoveRule'), 'false')).toBeNull()
    expect(optionError(option('Syzygy50MoveRule'), 'yes')).toBe('has to be true or false')
  })
})

describe('parseOption', () => {
  it('coerces to the type the engine declared', () => {
    expect(parseOption(option('Threads'), '8')).toBe(8)
    expect(parseOption(option('Syzygy50MoveRule'), 'false')).toBe(false)
    expect(parseOption(option('SyzygyPath'), '/tables')).toBe('/tables')
  })
})

describe('resolveDraft', () => {
  it('sends only what was set', () => {
    const result = resolveDraft(declared, { values: { Threads: '8', Hash: '' } }, {})
    expect(result.errors).toEqual({})
    expect(result.options).toEqual({ Threads: 8 })
    expect(result.changed).toBe(true)
  })

  it('does not write the engine default back', () => {
    const result = resolveDraft(declared, { values: { Threads: '1' } }, {})
    expect(result.options).toEqual({})
    expect(result.changed).toBe(false)
  })

  it('keeps a stored value that happens to equal the default, so it can be seen', () => {
    const result = resolveDraft(declared, { values: { Threads: '1' } }, { Threads: 1 })
    expect(result.options).toEqual({ Threads: 1 })
    expect(result.changed).toBe(false)
  })

  it('reports a bad value per field and refuses to build a payload', () => {
    const result = resolveDraft(declared, { values: { Threads: '9000' } }, {})
    expect(result.errors).toEqual({ Threads: 'at most 1024' })
    expect(result.options).toBeUndefined()
  })

  it('flags a stored option the binary no longer declares', () => {
    const result = resolveDraft(declared, { values: { Nonsense: '3' } }, { Nonsense: 3 })
    expect(result.errors.Nonsense).toBe('this engine does not declare that option')
  })

  it('notices a value that was cleared', () => {
    const result = resolveDraft(declared, { values: {} }, { Threads: 8 })
    expect(result.options).toEqual({})
    expect(result.changed).toBe(true)
  })

  it('round-trips what an engine already has stored', () => {
    const stored = { Threads: 8, Syzygy50MoveRule: false }
    const result = resolveDraft(declared, draftFrom(stored), stored)
    expect(result.changed).toBe(false)
    expect(result.options).toEqual(stored)
  })
})
